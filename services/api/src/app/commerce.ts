/**
 * Quotes, orders and custody transitions (§10, §11, §18) over PostgreSQL.
 * Prices come only from the catalogue; the client never supplies a total.
 */
import { createHash, randomInt } from "node:crypto";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal, ResourceContext } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { createJournal, type LedgerEntry } from "../modules/money/journal.ts";
import { evidenceBundle } from "../modules/ordering/evidence.ts";
import { OrderRuleError, replay, type OrderCommand } from "../modules/ordering/order-aggregate.ts";
import type { Actor, OrderLine, OrderSnapshot, OrderType } from "../modules/ordering/order-types.ts";
import { priceOrder, PricingError, type PriceBreakdown } from "../modules/pricing/pricing.ts";
import { getBranch, menuOf, type BranchRow } from "../persistence/catalogue.ts";
import { postJournal } from "../persistence/ledger.ts";
import { handleOrderCommand, loadOrderEvents, OrderConflictError } from "../persistence/orders.ts";
import { ApiError, badRequest, conflict, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";
import type { RoutingProvider } from "./routing.ts";

export interface QuoteInput {
  readonly branchId: string;
  readonly items: readonly { readonly itemId: string; readonly quantity: number }[];
  readonly orderType: OrderType;
  readonly delivery?: { readonly lat: number; readonly lng: number; readonly rural?: boolean };
  readonly tip?: string;
}

export interface PlaceOrderInput extends QuoteInput {
  readonly paymentMode: "PREPAID" | "CASH_ON_DELIVERY";
  /** The total the customer saw and accepted (§11.2 confirm-before-pay). */
  readonly expectedTotal: { readonly amount_minor: string; readonly currency: string };
  readonly address?: { readonly landmark?: string; readonly voiceNoteUrl?: string };
  readonly recipient?: { readonly name: string; readonly phone: string };
  readonly gifted?: boolean;
  readonly contactless?: boolean;
}

export interface Quote {
  readonly branch: { id: string; name: string };
  readonly lines: readonly { itemId: string; name: string; quantity: number; unit: MoneyJSON; total: MoneyJSON; allergens: string[] }[];
  readonly breakdown: PriceBreakdown;
  readonly distanceMeters?: number;
}

/** Default geofence for drop completion; becomes a Country Profile setting with the dispatch context. */
const GEOFENCE_M = 150;
const MAX_QUANTITY = 99;
const COD_SHARE_MIN_SAMPLE = 100n;

export class CommerceService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly routing: RoutingProvider;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, routing: RoutingProvider, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.routing = routing;
    this.now = now;
  }

  profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  async quote(country: string, input: QuoteInput): Promise<Quote> {
    return this.db.tx({ country }, (sql) => this.#quote(sql, country, input));
  }

  async #quote(sql: Sql, country: string, input: QuoteInput): Promise<Quote> {
    const profile = this.profile(country);
    const ccy = profile.money.settlement_currency;
    if (!input.items?.length) throw badRequest("EMPTY_CART", "Add at least one item");
    const branch = await getBranch(sql, input.branchId);
    if (!branch) throw notFound("Branch");
    if (branch.status !== "OPEN") throw unprocessable("BRANCH_CLOSED", `${branch.name} is not taking orders right now`);
    const menu = new Map((await menuOf(sql, branch.id)).map((m) => [m.id, m]));

    let goods = Money.zero(ccy);
    const lines: Quote["lines"][number][] = [];
    for (const { itemId, quantity } of input.items) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw badRequest("QUANTITY_INVALID", "Quantities are whole numbers from 1 to 99");
      const item = menu.get(itemId);
      if (!item) throw unprocessable("ITEM_NOT_ON_MENU", `Item ${itemId} is not on ${branch.name}'s menu`);
      if (!item.available) throw unprocessable("ITEM_UNAVAILABLE", `${nameOf(item.names)} is not available right now`, { itemId });
      const price = item.prices[ccy];
      // MR-2: a missing price would be converted by quote; until FX quoting is wired, refuse rather than guess.
      if (price === undefined) throw unprocessable("PRICE_MISSING", `${nameOf(item.names)} has no ${ccy} price`, { itemId });
      const unit = Money.ofMinor(BigInt(price), ccy);
      const total = unit.multiply(BigInt(quantity));
      goods = goods.add(total);
      lines.push({ itemId, name: nameOf(item.names), quantity, unit: unit.toJSON(), total: total.toJSON(), allergens: item.allergens });
    }

    let distanceMeters: number | undefined;
    const needsRider = ["DELIVERY", "SCHEDULED", "XBO"].includes(input.orderType);
    if (needsRider) {
      if (!input.delivery) throw badRequest("DELIVERY_PIN_REQUIRED", "Drop a pin for delivery");
      distanceMeters = await this.routing.distanceMeters({ lat: Number(branch.lat), lng: Number(branch.lng) }, input.delivery, "MOTO");
    }
    try {
      const breakdown = priceOrder(profile.pricing, {
        goods,
        channel: "ONLINE",
        orderType: input.orderType,
        ...(needsRider ? { delivery: { distanceMeters: distanceMeters as number, rural: input.delivery?.rural === true } } : {}),
        ...(input.tip ? { tip: Money.of(input.tip, ccy) } : {}),
      });
      return { branch: { id: branch.id, name: branch.name }, lines, breakdown, ...(distanceMeters !== undefined ? { distanceMeters } : {}) };
    } catch (error) {
      if (error instanceof PricingError) throw unprocessable(error.code, error.message);
      if (error instanceof RangeError) throw badRequest("AMOUNT_INVALID", error.message);
      throw error;
    }
  }

  /** Places an order: re-prices, checks the accepted total, creates the event stream (§11.2). */
  async place(country: string, principal: Principal, input: PlaceOrderInput, idempotencyKey: string): Promise<{ orderId: string; state: string; recipientCode: string; quote: Quote }> {
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      const quote = await this.#quote(sql, country, input);
      const total = quote.breakdown.total;
      if (input.expectedTotal?.currency !== total.currency || input.expectedTotal.amount_minor !== total.minor.toString()) {
        throw conflict("PRICE_CHANGED", "The price changed since you last saw it; please confirm the new total", { quote: serialiseQuote(quote) });
      }
      if (input.paymentMode === "CASH_ON_DELIVERY") await this.#assertCodAllowed(sql, profile, principal.userId, total);
      if (input.orderType === "XBO" && !input.recipient) throw badRequest("RECIPIENT_REQUIRED", "Cross-border orders name a recipient");

      const branch = (await getBranch(sql, input.branchId)) as BranchRow;
      const [row] = await sql.query<{ id: string }>("SELECT platform.uuid_v7()::text AS id");
      const orderId = (row as { id: string }).id;
      const recipientCode = String(randomInt(0, 10_000)).padStart(4, "0");
      const menu = new Map((await menuOf(sql, branch.id)).map((m) => [m.id, m]));
      const lines: OrderLine[] = quote.lines.map((l, i) => ({
        id: `l${i + 1}`,
        itemId: l.itemId,
        name: l.name,
        quantity: l.quantity,
        options: [],
        allergenFlags: menu.get(l.itemId)?.allergens ?? [],
      }));
      const configured = profile.operations.confirmation_model;
      const b = quote.breakdown;
      const snapshot: OrderSnapshot = {
        orderId,
        type: input.orderType,
        channel: "ONLINE",
        country,
        brandId: branch.brand_id,
        branchId: branch.id,
        customerId: principal.userId,
        ...(input.recipient ? { recipient: input.recipient } : {}),
        gifted: input.gifted === true || input.orderType === "XBO",
        lines,
        total: total.toJSON(),
        currencies: { price: total.currency, order: total.currency, settlement: profile.money.settlement_currency, reporting: "GBP" },
        money: {
          goods: b.goods.toJSON(),
          serviceCharge: b.serviceCharge.toJSON(),
          deliveryFee: (b.delivery?.fee ?? Money.zero(total.currency)).toJSON(),
          merchantDeliveryContribution: b.merchantDeliveryContribution.toJSON(),
          riderShare: (b.delivery?.riderShare ?? Money.zero(total.currency)).toJSON(),
          platformDeliveryShare: (b.delivery?.platformShare ?? Money.zero(total.currency)).toJSON(),
          tip: b.tip.toJSON(),
          merchantReceives: b.merchantReceives.toJSON(),
          riderReceives: b.riderReceives.toJSON(),
          platformReceives: b.platformReceives.toJSON(),
        },
        paymentMode: input.paymentMode,
        configuredConfirmationModel: configured,
        // AGENT_OPTIMISED is decided per order by the Dispatch Optimiser (A2); until it runs, restaurant-first.
        confirmationModel: configured === "AGENT_OPTIMISED" ? "RESTAURANT_FIRST" : configured,
        highValue: false,
        contactlessRequested: input.contactless === true,
        recipientCodeHash: createHash("sha256").update(recipientCode).digest("hex"),
        ...(input.delivery ? { dropLocation: { lat: input.delivery.lat, lng: input.delivery.lng } } : {}),
        geofenceRadiusM: GEOFENCE_M,
      };
      const actor: Actor = { kind: "CUSTOMER", id: principal.userId };
      const tenant = { country, brandId: branch.brand_id };
      await this.#run(sql, tenant, orderId, actor, `${idempotencyKey}:draft`, { type: "CREATE_DRAFT", snapshot });
      const next: OrderCommand = input.paymentMode === "PREPAID" ? { type: "START_CHECKOUT" } : { type: "PLACE_CASH_ORDER" };
      const { order } = await this.#run(sql, tenant, orderId, actor, `${idempotencyKey}:${next.type}`, next);
      return { orderId, state: order.state, recipientCode, quote };
    });
  }

  async get(country: string, principal: Principal, orderId: string) {
    return this.db.tx({ country }, async (sql) => {
      const { order, resource } = await this.#load(sql, orderId);
      const role = require(principal, "order:read", resource, { activeCountry: country, profile: this.profile(country) });
      return { order, role };
    });
  }

  async evidence(country: string, principal: Principal, orderId: string) {
    return this.db.tx({ country }, async (sql) => {
      const { resource } = await this.#load(sql, orderId);
      require(principal, "order:read", resource, { activeCountry: country, profile: this.profile(country) });
      return evidenceBundle(await loadOrderEvents(sql, orderId));
    });
  }

  /** A custody or lifecycle command from staff, a rider, ops or the customer. */
  async transition(country: string, principal: Principal, orderId: string, command: OrderCommand, commandId: string) {
    if (command.type === "CREATE_DRAFT") throw badRequest("COMMAND_NOT_ALLOWED", "Orders are created by placing them");
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      const { order, resource } = await this.#load(sql, orderId);
      // Customers may cancel their own order (the aggregate allows it only before acceptance); staff need order:manage.
      const ownCancel = command.type === "CANCEL" && order.snapshot.customerId === principal.userId;
      const action: Action = ownCancel ? "order:read" : ACTION_FOR[command.type];
      const amount = command.type === "REFUND" ? order.snapshot.total : undefined;
      const role = require(principal, action, resource, { activeCountry: country, profile, ...(amount ? { amount } : {}) });
      const actor: Actor = { kind: actorKind(role), id: principal.userId };
      const result = await this.#run(sql, { country, brandId: order.snapshot.brandId }, orderId, actor, commandId, command);
      if (result.order.state === "DELIVERED" && order.state !== "DELIVERED" && result.events.length > 0) {
        await this.#settle(sql, result.order.snapshot);
      }
      return result;
    });
  }

  /** Called by payments when the provider confirms or fails (system actor). */
  async systemCommand(sql: Sql, country: string, orderId: string, commandId: string, command: OrderCommand) {
    const { order } = await this.#load(sql, orderId);
    return this.#run(sql, { country, brandId: order.snapshot.brandId }, orderId, { kind: "SYSTEM", id: "payments" }, commandId, command);
  }

  async #load(sql: Sql, orderId: string) {
    if (!/^[0-9a-f-]{36}$/.test(orderId)) throw notFound("Order");
    const order = replay(await loadOrderEvents(sql, orderId));
    if (!order) throw notFound("Order");
    const branch = await getBranch(sql, order.snapshot.branchId);
    const resource: ResourceContext = {
      type: "order",
      country: order.snapshot.country,
      brandId: order.snapshot.brandId,
      branchId: order.snapshot.branchId,
      ...(branch ? { restaurantGroupId: branch.restaurant_group_id } : {}),
      ...(branch?.city ? { cityId: branch.city } : {}),
      // Until zones exist (CFG-001), riders are scoped to the branch's commune.
      ...(branch?.commune ? { zoneIds: [branch.commune] } : {}),
      ownerUserId: order.snapshot.customerId,
    };
    return { order, resource };
  }

  async #run(sql: Sql, tenant: { country: string; brandId: string }, orderId: string, actor: Actor, commandId: string, command: OrderCommand) {
    try {
      return await handleOrderCommand(sql, { commandId, orderId, actor, at: this.now(), command }, tenant);
    } catch (error) {
      if (error instanceof OrderRuleError) throw unprocessable(error.code, error.message);
      if (error instanceof OrderConflictError) throw conflict("CONCURRENT_UPDATE", error.message);
      throw error;
    }
  }

  /** PRD §18 / PRC-016: one balanced settlement journal per delivered order, in the same transaction. */
  async #settle(sql: Sql, s: OrderSnapshot): Promise<void> {
    const m = s.money;
    if (!m) return;
    const c = s.country;
    const neg = (j: MoneyJSON) => Money.fromJSON(j).negate();
    const entries: LedgerEntry[] = [
      { account: s.paymentMode === "PREPAID" ? "psp_clearing" : "cod_cash_in_transit", country: c, amount: Money.fromJSON(s.total) },
      { account: "restaurant_payable", country: c, amount: neg(m.merchantReceives) },
      { account: "service_charge_revenue", country: c, amount: neg(m.serviceCharge) },
      { account: "rider_payable", country: c, amount: neg(m.riderReceives) },
      { account: "delivery_fee_revenue", country: c, amount: neg(m.platformDeliveryShare) },
    ].filter((e) => !e.amount.isZero()) as LedgerEntry[];
    await postJournal(sql, createJournal({ id: `settle:${s.orderId}`, idempotencyKey: `order:${s.orderId}:settlement`, description: `Order ${s.orderId} settlement`, entries }));
  }

  /** §20.4 / Appendix A: COD only under a time-boxed CEO exception, within the cash cap, account age and market share. */
  async #assertCodAllowed(sql: Sql, profile: CountryProfile, userId: string, total: Money): Promise<void> {
    const cod = profile.payments.cod_policy;
    const exception = cod.exception;
    const now = this.now();
    const today = now.toISOString().slice(0, 10);
    if (!cod.enabled || !exception || exception.end_date < today) throw unprocessable("COD_UNAVAILABLE", "Cash on delivery is not available in this market");
    const cap = cod.cash_cap?.find((c) => c.currency === total.currency);
    if (cap && total.compare(Money.of(cap.amount, total.currency)) > 0) throw unprocessable("COD_ABOVE_CAP", "This order is above the cash limit; please pay online");
    if (exception.min_account_age_days !== undefined) {
      const [user] = await sql.query<{ created_at: Date }>("SELECT created_at FROM identity.app_user WHERE id = $1", [userId]);
      const ageDays = user ? (now.getTime() - new Date(user.created_at).getTime()) / 86_400_000 : 0;
      if (ageDays < exception.min_account_age_days) {
        throw unprocessable("COD_ACCOUNT_TOO_NEW", `Cash on delivery opens ${exception.min_account_age_days} days after you join; please pay online`);
      }
    }
    if (exception.max_share_bps !== undefined) {
      // Rolling 30 days in this market. The share is only meaningful over a sample, so it binds from COD_SHARE_MIN_SAMPLE orders (ADR 0010).
      const since = new Date(now.getTime() - 30 * 86_400_000);
      const [row] = await sql.query<{ total: string; cod: string }>(
        "SELECT count(*)::text AS total, count(*) FILTER (WHERE payment_mode = 'CASH_ON_DELIVERY')::text AS cod FROM ordering.order_view WHERE country_iso2 = $1 AND created_at >= $2",
        [profile.country.iso2, since],
      );
      const all = BigInt(row?.total ?? "0") + 1n;
      const cash = BigInt(row?.cod ?? "0") + 1n;
      if (all >= COD_SHARE_MIN_SAMPLE && cash * 10_000n > BigInt(exception.max_share_bps) * all) {
        throw unprocessable("COD_SHARE_CAP", "Cash on delivery is at its limit in this market right now; please pay online");
      }
    }
  }
}

const ACTION_FOR: Record<Exclude<OrderCommand["type"], "CREATE_DRAFT">, Action> = {
  START_CHECKOUT: "order:place",
  CONFIRM_PAYMENT: "order:manage",
  FAIL_PAYMENT: "order:manage",
  PLACE_CASH_ORDER: "order:place",
  EXPIRE: "order:manage",
  ASSIGN_RIDER: "dispatch:manage",
  ACCEPT: "order:accept",
  REJECT: "order:accept",
  CANCEL: "order:manage",
  ACKNOWLEDGE_CANCELLATION: "order:accept",
  START_PREPARING: "order:prepare",
  PACK: "order:prepare",
  MARK_READY: "order:prepare",
  PICK_UP: "job:accept",
  DELIVER: "job:accept",
  FAIL_DELIVERY: "job:accept",
  REQUEST_REFUND: "order:read",
  DECLINE_REFUND: "order:manage",
  REFUND: "refund:issue",
};

function actorKind(role: string): Actor["kind"] {
  if (role === "RIDER") return "RIDER";
  if (role === "CUSTOMER") return "CUSTOMER";
  if (["RESTAURANT_OWNER", "BRANCH_MANAGER", "KITCHEN_STAFF"].includes(role) || role.startsWith("profile:")) return "RESTAURANT";
  return "SUPPORT";
}

function nameOf(names: Record<string, string>): string {
  return names["en"] ?? names["fr"] ?? Object.values(names)[0] ?? "Item";
}

export function serialiseQuote(q: Quote) {
  const b = q.breakdown;
  const m = (x: Money) => ({ amount_minor: x.minor.toString(), currency: x.currency });
  return {
    branch: q.branch,
    lines: q.lines.map((l) => ({ item_id: l.itemId, name: l.name, quantity: l.quantity, unit: { amount_minor: l.unit.minor, currency: l.unit.currency }, total: { amount_minor: l.total.minor, currency: l.total.currency }, allergens: l.allergens })),
    price_lines: b.lines.map((l) => ({ code: l.code, amount: m(l.amount) })),
    commission: m(b.commission),
    total: m(b.total),
    ...(q.distanceMeters !== undefined ? { distance_meters: q.distanceMeters } : {}),
    ...(b.delivery ? { delivery: { charged_km: b.delivery.chargedKm, step: b.delivery.step, rider_share: m(b.delivery.riderShare) } } : {}),
  };
}

export { ApiError };
