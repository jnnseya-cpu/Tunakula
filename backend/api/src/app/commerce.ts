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
import { RIDER_ORDER_TYPES, type Actor, type OrderLine, type OrderSnapshot, type OrderType } from "../modules/ordering/order-types.ts";
import { priceOrder, PricingError, type PriceBreakdown } from "../modules/pricing/pricing.ts";
import { membershipDiscount, type MembershipLookup } from "./membership.ts";
import { getBranch, menuOf, type BranchRow, type MenuItemRow } from "../persistence/catalogue.ts";
import { userById } from "../persistence/identity.ts";
import { postJournal } from "../persistence/ledger.ts";
import { handleOrderCommand, loadOrderEvents, OrderConflictError } from "../persistence/orders.ts";
import { ApiError, badRequest, conflict, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";
import type { RoutingProvider } from "./routing.ts";

export interface LineOptionSelection { readonly group: string; readonly choices: readonly string[] }
export interface QuoteInput {
  readonly branchId: string;
  readonly items: readonly { readonly itemId: string; readonly quantity: number; readonly options?: readonly LineOptionSelection[]; readonly addons?: readonly string[] }[];
  readonly orderType: OrderType;
  readonly delivery?: { readonly lat: number; readonly lng: number; readonly rural?: boolean };
  readonly tip?: string;
  /** When set, the quote applies this customer's live membership benefit (free delivery / service-charge discount). */
  readonly customerId?: string;
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
  readonly lines: readonly { itemId: string; name: string; quantity: number; unit: MoneyJSON; total: MoneyJSON; allergens: string[]; options: string[] }[];
  readonly breakdown: PriceBreakdown;
  readonly distanceMeters?: number;
  /** Present when a member's benefit applies: the discount funded by the platform and the resulting payable total. */
  readonly membership?: {
    readonly planId: string;
    readonly planName: string;
    readonly freeDelivery: boolean;
    readonly discount: MoneyJSON;
    readonly payableTotal: MoneyJSON;
  };
}

/** Default geofence for drop completion; becomes a Country Profile setting with the dispatch context. */
const GEOFENCE_M = 150;
const MAX_QUANTITY = 99;
const COD_SHARE_MIN_SAMPLE = 100n;

/** Order states that notify the customer, and the catalogue event each fires. */
const ORDER_EVENT: Readonly<Record<string, string>> = {
  PLACED: "order.placed", ACCEPTED: "order.accepted", PREPARING: "order.preparing", READY: "order.ready",
  PICKED_UP: "order.picked_up", DELIVERED: "order.delivered", REJECTED: "order.rejected",
  CANCELLED: "order.cancelled", DELIVERY_FAILED: "order.delivery_failed", REFUNDED: "payment.refund_processed",
};

/** What the dispatch engine needs to tell a customer about their order. */
interface OrderNotifier {
  dispatch(input: { country: string; eventKey: string; recipientUserId: string; audience?: string; data?: Record<string, string | number>; dedupeKey?: string }): Promise<unknown>;
}

export class CommerceService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly routing: RoutingProvider;
  private readonly now: () => Date;
  private readonly notifier: OrderNotifier | undefined;
  private membership: MembershipLookup | undefined;

  constructor(db: Db, registry: CountryConfigRegistry, routing: RoutingProvider, now: () => Date = () => new Date(), notifier?: OrderNotifier) {
    this.db = db;
    this.registry = registry;
    this.routing = routing;
    this.now = now;
    this.notifier = notifier;
  }

  /** Wires the membership service after construction (it is built alongside commerce), keeping the constructor stable. */
  useMembership(membership: MembershipLookup): void {
    this.membership = membership;
  }

  /** Tells the customer about an order state change (best-effort, outside the state transaction). */
  async #notifyOrder(country: string, info: { state: string; orderId: string; customerId: string; restaurant?: string | undefined; rider?: string | undefined }): Promise<void> {
    const eventKey = ORDER_EVENT[info.state];
    if (!eventKey || !this.notifier) return;
    const data: Record<string, string> = { order: `#${info.orderId.slice(0, 8)}` };
    if (info.restaurant) data.restaurant = info.restaurant;
    if (info.rider) data.rider = info.rider;
    await this.notifier.dispatch({ country, eventKey, recipientUserId: info.customerId, audience: "customer", data, dedupeKey: `order:${info.orderId}:${info.state}` }).catch(() => undefined);
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
    const lang = profile.country.default_locale.slice(0, 2);
    if (!input.items?.length) throw badRequest("EMPTY_CART", "Add at least one item");
    const branch = await getBranch(sql, input.branchId);
    if (!branch) throw notFound("Branch");
    if (branch.status !== "OPEN") throw unprocessable("BRANCH_CLOSED", `${branch.name} is not taking orders right now`);
    const menu = new Map((await menuOf(sql, branch.id)).map((m) => [m.id, m]));

    let goods = Money.zero(ccy);
    const lines: Quote["lines"][number][] = [];
    for (const lineInput of input.items) {
      const { itemId, quantity } = lineInput;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw badRequest("QUANTITY_INVALID", "Quantities are whole numbers from 1 to 99");
      const item = menu.get(itemId);
      if (!item) throw unprocessable("ITEM_NOT_ON_MENU", `Item ${itemId} is not on ${branch.name}'s menu`);
      if (!item.available) throw unprocessable("ITEM_UNAVAILABLE", `${nameOf(item.names, lang)} is not available right now`, { itemId });
      const price = item.prices[ccy];
      // MR-2: a missing price would be converted by quote; until FX quoting is wired, refuse rather than guess.
      if (price === undefined) throw unprocessable("PRICE_MISSING", `${nameOf(item.names, lang)} has no ${ccy} price`, { itemId });
      const { surcharge, descriptors } = optionSurcharge(item, lineInput, nameOf(item.names, lang));
      const unit = Money.ofMinor(BigInt(price) + surcharge, ccy);
      const total = unit.multiply(BigInt(quantity));
      goods = goods.add(total);
      lines.push({ itemId, name: nameOf(item.names, lang), quantity, unit: unit.toJSON(), total: total.toJSON(), allergens: item.allergens, options: descriptors });
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
      const membership = await this.#memberBenefit(sql, country, input.customerId, breakdown);
      return { branch: { id: branch.id, name: branch.name }, lines, breakdown, ...(distanceMeters !== undefined ? { distanceMeters } : {}), ...(membership ? { membership } : {}) };
    } catch (error) {
      if (error instanceof PricingError) throw unprocessable(error.code, error.message);
      if (error instanceof RangeError) throw badRequest("AMOUNT_INVALID", error.message);
      throw error;
    }
  }

  /** Resolves the customer's live membership benefit against a priced order, if any applies. */
  async #memberBenefit(sql: Sql, country: string, customerId: string | undefined, breakdown: PriceBreakdown): Promise<Quote["membership"] | undefined> {
    if (!customerId || !this.membership) return undefined;
    const benefit = await this.membership.activeBenefit(sql, country, customerId);
    if (!benefit) return undefined;
    const { discount, freeDelivery } = membershipDiscount(benefit, {
      goods: breakdown.goods,
      customerDeliveryFee: breakdown.customerDeliveryFee,
      serviceCharge: breakdown.serviceCharge,
    });
    if (discount.isZero()) return undefined;
    return {
      planId: benefit.planId,
      planName: benefit.planName,
      freeDelivery,
      discount: discount.toJSON(),
      payableTotal: breakdown.total.subtract(discount).toJSON(),
    };
  }

  /** Places an order: re-prices, checks the accepted total, creates the event stream (§11.2). */
  async place(country: string, principal: Principal, input: PlaceOrderInput, idempotencyKey: string): Promise<{ orderId: string; state: string; recipientCode: string; quote: Quote }> {
    const profile = this.profile(country);
    let placedRestaurant: string | undefined;
    const out = await this.db.tx({ country }, async (sql) => {
      const quote = await this.#quote(sql, country, { ...input, customerId: principal.userId });
      // What the customer actually pays: the gross price minus any membership benefit the platform funds.
      const total = quote.membership ? Money.fromJSON(quote.membership.payableTotal) : quote.breakdown.total;
      if (input.expectedTotal?.currency !== total.currency || input.expectedTotal.amount_minor !== total.minor.toString()) {
        throw conflict("PRICE_CHANGED", "The price changed since you last saw it; please confirm the new total", { quote: serialiseQuote(quote) });
      }
      if (input.paymentMode === "CASH_ON_DELIVERY") await this.#assertCodAllowed(sql, profile, principal.userId, total);
      if (input.orderType === "XBO" && !input.recipient) throw badRequest("RECIPIENT_REQUIRED", "Cross-border orders name a recipient");

      const branch = (await getBranch(sql, input.branchId)) as BranchRow;
      placedRestaurant = branch.name;
      const [row] = await sql.query<{ id: string }>("SELECT platform.uuid_v7()::text AS id");
      const orderId = (row as { id: string }).id;
      const recipientCode = String(randomInt(0, 10_000)).padStart(4, "0");
      const menu = new Map((await menuOf(sql, branch.id)).map((m) => [m.id, m]));
      const lines: OrderLine[] = quote.lines.map((l, i) => ({
        id: `l${i + 1}`,
        itemId: l.itemId,
        name: l.name,
        quantity: l.quantity,
        options: l.options,
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
          ...(quote.membership ? { membershipDiscount: quote.membership.discount } : {}),
        },
        paymentMode: input.paymentMode,
        configuredConfirmationModel: configured,
        // AGENT_OPTIMISED is decided per order by the Dispatch Optimiser (A2); until it runs, restaurant-first.
        confirmationModel: configured === "AGENT_OPTIMISED" ? "RESTAURANT_FIRST" : configured,
        highValue: false,
        contactlessRequested: input.contactless === true,
        recipientCodeHash: createHash("sha256").update(recipientCode).digest("hex"),
        ...(input.delivery ? { dropLocation: { lat: input.delivery.lat, lng: input.delivery.lng } } : {}),
        ...(input.address?.landmark?.trim() ? { deliveryNote: input.address.landmark.trim().slice(0, 280) } : {}),
        geofenceRadiusM: GEOFENCE_M,
      };
      const actor: Actor = { kind: "CUSTOMER", id: principal.userId };
      const tenant = { country, brandId: branch.brand_id };
      await this.#run(sql, tenant, orderId, actor, `${idempotencyKey}:draft`, { type: "CREATE_DRAFT", snapshot });
      const next: OrderCommand = input.paymentMode === "PREPAID" ? { type: "START_CHECKOUT" } : { type: "PLACE_CASH_ORDER" };
      const { order } = await this.#run(sql, tenant, orderId, actor, `${idempotencyKey}:${next.type}`, next);
      return { orderId, state: order.state, recipientCode, quote };
    });
    // A cash order is PLACED straight away; a prepaid one becomes PLACED when payment confirms.
    if (out.state === "PLACED") await this.#notifyOrder(country, { state: "PLACED", orderId: out.orderId, customerId: principal.userId, restaurant: placedRestaurant });
    return out;
  }

  async get(country: string, principal: Principal, orderId: string) {
    return this.db.tx({ country }, async (sql) => {
      const { order, resource } = await this.#load(sql, orderId);
      const role = require(principal, "order:read", resource, { activeCountry: country, profile: this.profile(country) });
      // Tracking: when each state was reached, and where the order comes from.
      const timeline = (await loadOrderEvents(sql, orderId))
        .flatMap((e) => (e.type === "STATE_CHANGED" ? [{ state: e.to, at: e.at }] : e.type === "ORDER_DRAFTED" ? [{ state: "DRAFT", at: e.at }] : []));
      const branch = await getBranch(sql, order.snapshot.branchId);
      return { order, role, timeline, branch: branch ? { id: branch.id, name: branch.name, commune: branch.commune, lat: Number(branch.lat), lng: Number(branch.lng) } : null };
    });
  }

  /** GET /v1/me/orders: the signed-in customer's own orders in this market, newest first. */
  async myOrders(country: string, principal: Principal, limit = 30) {
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ order_id: string; state: string; type: string; total_minor: string; currency: string; created_at: Date; branch_id: string; branch_name: string; commune: string | null }>(
        `SELECT o.order_id, o.state, o.type, o.total_minor::text, o.currency, o.created_at, b.id AS branch_id, b.name AS branch_name, b.commune
           FROM ordering.order_view o JOIN catalogue.branch b ON b.id = o.branch_id
          WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT $2`,
        [principal.userId, Math.min(Math.max(limit, 1), 100)],
      );
      return rows.map((r) => ({
        order_id: r.order_id, state: r.state, type: r.type, total: { amount_minor: r.total_minor, currency: r.currency },
        created_at: new Date(r.created_at).toISOString(), branch: { id: r.branch_id, name: r.branch_name, commune: r.commune },
      }));
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
    let notify: { state: string; orderId: string; customerId: string; restaurant?: string | undefined; rider?: string | undefined } | undefined;
    const result = await this.db.tx({ country }, async (sql) => {
      const { order, resource } = await this.#load(sql, orderId);
      // Customers may cancel their own order (the aggregate allows it only before acceptance); staff need order:manage.
      const ownCancel = command.type === "CANCEL" && order.snapshot.customerId === principal.userId;
      // Orders without a rider (takeaway, dine-in) are handed over at the counter by the branch, not delivered by a rider.
      const counterHandover = command.type === "DELIVER" && !RIDER_ORDER_TYPES.includes(order.snapshot.type);
      const action: Action = ownCancel ? "order:read" : counterHandover ? "order:handover" : ACTION_FOR[command.type];
      const amount = command.type === "REFUND" ? order.snapshot.total : undefined;
      const role = require(principal, action, resource, { activeCountry: country, profile, ...(amount ? { amount } : {}) });
      const actor: Actor = { kind: actorKind(role), id: principal.userId };
      const result = await this.#run(sql, { country, brandId: order.snapshot.brandId }, orderId, actor, commandId, command);
      if (result.order.state === "DELIVERED" && order.state !== "DELIVERED" && result.events.length > 0) {
        await this.#settle(sql, result.order.snapshot);
      }
      if (result.order.state !== order.state && ORDER_EVENT[result.order.state]) {
        const branch = await getBranch(sql, result.order.snapshot.branchId);
        const riderId = result.order.riderId;
        const rider = riderId && (result.order.state === "PICKED_UP" || result.order.state === "DELIVERED")
          ? (await userById(sql, riderId))?.display_name ?? undefined
          : undefined;
        notify = { state: result.order.state, orderId, customerId: result.order.snapshot.customerId, restaurant: branch?.name, rider };
      }
      return result;
    });
    if (notify) await this.#notifyOrder(country, notify);
    return result;
  }

  /** Called by payments when the provider confirms or fails (system actor). */
  async systemCommand(sql: Sql, country: string, orderId: string, commandId: string, command: OrderCommand, system = "payments") {
    const { order } = await this.#load(sql, orderId);
    return this.#run(sql, { country, brandId: order.snapshot.brandId }, orderId, { kind: "SYSTEM", id: system }, commandId, command);
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
    // A membership benefit means the customer paid s.total (already net of the discount); the platform
    // funds the discount out of subscription revenue so the merchant and rider are still credited in full.
    const discount = m.membershipDiscount ? Money.fromJSON(m.membershipDiscount) : Money.zero(Money.fromJSON(s.total).currency);
    const entries: LedgerEntry[] = [
      { account: s.paymentMode === "PREPAID" ? "psp_clearing" : "cod_cash_in_transit", country: c, amount: Money.fromJSON(s.total) },
      { account: "subscription_revenue", country: c, amount: discount },
      { account: "restaurant_payable", country: c, amount: neg(m.merchantReceives) },
      { account: "service_charge_revenue", country: c, amount: neg(m.serviceCharge) },
      { account: "rider_payable", country: c, amount: neg(m.riderReceives) },
      { account: "delivery_fee_revenue", country: c, amount: neg(m.platformDeliveryShare) },
    ].filter((e) => !e.amount.isZero()) as LedgerEntry[];
    await postJournal(sql, createJournal({ id: `settle:${s.orderId}`, idempotencyKey: `order:${s.orderId}:settlement`, description: `Order ${s.orderId} settlement`, entries, postedAt: this.now() }));
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

/** The item's name in the market's default language, then English, then any. */
function nameOf(names: Record<string, string>, lang = "en"): string {
  return names[lang] ?? names["en"] ?? names["fr"] ?? Object.values(names)[0] ?? "Item";
}

/**
 * Validates a line's chosen variations and add-ons against what the dish defines, and returns the
 * price delta (settlement-currency minor units) plus human-readable descriptors for the order line.
 * The deltas flow into `goods`, so the service charge and the total reflect the options (§18).
 */
function optionSurcharge(item: MenuItemRow, input: { options?: readonly LineOptionSelection[]; addons?: readonly string[] }, itemName: string): { surcharge: bigint; descriptors: string[] } {
  let surcharge = 0n;
  const descriptors: string[] = [];
  const groups = new Map((item.variations ?? []).map((g) => [g.id, g]));
  const chosen = new Set<string>();
  for (const sel of input.options ?? []) {
    const group = groups.get(sel.group);
    if (!group) throw unprocessable("UNKNOWN_OPTION_GROUP", `${itemName}: no such option "${sel.group}"`);
    chosen.add(group.id);
    const opts = new Map(group.options.map((o) => [o.id, o]));
    const choices = [...new Set(sel.choices ?? [])];
    if (group.type === "SINGLE" && choices.length > 1) throw unprocessable("OPTION_SINGLE", `${itemName} / ${group.name}: choose one`);
    if (choices.length < group.min) throw unprocessable("OPTION_TOO_FEW", `${itemName} / ${group.name}: choose at least ${group.min}`);
    if (choices.length > group.max) throw unprocessable("OPTION_TOO_MANY", `${itemName} / ${group.name}: choose at most ${group.max}`);
    for (const id of choices) {
      const opt = opts.get(id);
      if (!opt) throw unprocessable("UNKNOWN_OPTION", `${itemName} / ${group.name}: no such choice`);
      surcharge += BigInt(opt.price);
      descriptors.push(`${group.name}: ${opt.name}`);
    }
  }
  for (const group of item.variations ?? []) {
    if (group.required && !chosen.has(group.id)) throw unprocessable("OPTION_REQUIRED", `${itemName}: "${group.name}" is required`);
  }
  const addons = new Map((item.addons ?? []).map((a) => [a.id, a]));
  for (const id of [...new Set(input.addons ?? [])]) {
    const addon = addons.get(id);
    if (!addon) throw unprocessable("UNKNOWN_ADDON", `${itemName}: no such add-on`);
    surcharge += BigInt(addon.price);
    descriptors.push(`+ ${addon.name}`);
  }
  return { surcharge, descriptors };
}

export function serialiseQuote(q: Quote) {
  const b = q.breakdown;
  const m = (x: Money) => ({ amount_minor: x.minor.toString(), currency: x.currency });
  return {
    branch: q.branch,
    lines: q.lines.map((l) => ({ item_id: l.itemId, name: l.name, quantity: l.quantity, unit: { amount_minor: l.unit.minor, currency: l.unit.currency }, total: { amount_minor: l.total.minor, currency: l.total.currency }, allergens: l.allergens, options: l.options })),
    price_lines: b.lines.map((l) => ({ code: l.code, amount: m(l.amount) })),
    commission: m(b.commission),
    total: m(b.total),
    ...(q.distanceMeters !== undefined ? { distance_meters: q.distanceMeters } : {}),
    ...(b.delivery ? { delivery: { charged_km: b.delivery.chargedKm, step: b.delivery.step, rider_share: m(b.delivery.riderShare) } } : {}),
    ...(q.membership
      ? {
          membership: {
            plan_id: q.membership.planId,
            plan_name: q.membership.planName,
            free_delivery: q.membership.freeDelivery,
            discount: m(Money.fromJSON(q.membership.discount)),
            payable_total: m(Money.fromJSON(q.membership.payableTotal)),
          },
        }
      : {}),
  };
}

export { ApiError };
