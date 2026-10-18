/**
 * Self-service kiosk (channel HUB). A customer standing in the restaurant orders for themselves on an in-store
 * screen — pick dishes, choose dine-in or takeaway, then either pay now by mobile money or take an order number to
 * the counter to pay. It lands PLACED on the same kitchen / KDS board as every other order, stamped with the HUB
 * (kiosk) channel and no cashier. Same principle as online and POS: 0% commission, the customer service charge,
 * one settlement path. Additive — it reuses the commerce quote/place path with an in-store HUB context.
 *
 * The device is provisioned by the branch (a staff member with pos:operate unlocks kiosk mode on the tablet), the
 * same trust model as the counter POS; individual orders carry no staff attribution.
 */
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { CountryProfile } from "@tunakula/ts-contracts";
import { type Principal } from "../modules/identity/policy.ts";
import { getBranch } from "../persistence/catalogue.ts";
import { require } from "./principal.ts";
import { badRequest, notFound } from "./errors.ts";
import type { CommerceService, QuoteInput } from "./commerce.ts";

type CounterType = "TAKEAWAY" | "DINE_IN";
type PayMethod = "COUNTER" | "MOBILE_MONEY" | "QR";
interface KioskInput {
  branchId?: string;
  items?: QuoteInput["items"];
  orderType?: string;
  tableId?: string;
  deviceId?: string;
  payMethod?: string;
  customerPhone?: string;
  customerName?: string;
  kitchenNote?: string;
  expectedTotal?: { amount_minor: string; currency: string };
}

const E164 = /^\+[1-9][0-9]{6,14}$/;
/** One shared, format-valid sentinel account for anonymous kiosk sales (app_user.phone_e164 is globally unique). */
const KIOSK_WALK_IN_PHONE = "+99900000001";

interface IntentInitiator {
  create(country: string, principal: Principal, input: { orderId: string; methodType: string; payerCountry: string; payer: { msisdn?: string; token?: string } }, idempotencyKey: string, opts?: { trusted?: boolean }): Promise<{ status?: string; next_action?: unknown }>;
}

export class KioskService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly commerce: CommerceService;
  private readonly payments: IntentInitiator;

  constructor(db: Db, registry: CountryConfigRegistry, commerce: CommerceService, payments: IntentInitiator) {
    this.db = db;
    this.registry = registry;
    this.commerce = commerce;
    this.payments = payments;
  }

  #profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  #counterType(t?: string): CounterType {
    const v = String(t ?? "TAKEAWAY").toUpperCase();
    if (v !== "TAKEAWAY" && v !== "DINE_IN") throw badRequest("ORDER_TYPE_INVALID", "A kiosk order is TAKEAWAY or DINE_IN");
    return v;
  }

  #payMethod(m?: string): PayMethod {
    const v = String(m ?? "COUNTER").toUpperCase();
    if (v !== "COUNTER" && v !== "MOBILE_MONEY" && v !== "QR") throw badRequest("PAY_METHOD_INVALID", "Pay at the counter, by mobile money or by QR");
    return v as PayMethod;
  }

  /** The device must be unlocked by staff holding pos:operate at this branch. Returns the branch row. */
  async #authorise(sql: Sql, country: string, principal: Principal, branchId: string) {
    const branch = await getBranch(sql, branchId);
    if (!branch) throw notFound("Branch");
    require(principal, "pos:operate", { type: "order", country, branchId, restaurantGroupId: branch.restaurant_group_id, brandId: branch.brand_id }, { activeCountry: country, profile: this.#profile(country) });
    return branch;
  }

  /** POST /v1/kiosk/quote — price a kiosk cart (plain price; membership/coupons are personal-app features). */
  async quote(country: string, principal: Principal, input: KioskInput) {
    const orderType = this.#counterType(input.orderType);
    if (!input.branchId) throw badRequest("BRANCH_REQUIRED", "A kiosk order needs a branch");
    if (!Array.isArray(input.items) || input.items.length === 0) throw badRequest("ITEMS_REQUIRED", "Add at least one item");
    await this.db.tx({ country }, (sql) => this.#authorise(sql, country, principal, input.branchId!));
    return this.commerce.quote(country, { branchId: input.branchId, items: input.items, orderType });
  }

  /**
   * POST /v1/kiosk/orders — place a self-service kiosk order. "COUNTER" lands PLACED at once (the customer pays at
   * the till); "MOBILE_MONEY" places it PREPAID and the kiosk then raises a payment intent to the customer's phone.
   */
  async place(country: string, principal: Principal, input: KioskInput, idempotencyKey: string) {
    const orderType = this.#counterType(input.orderType);
    const payMethod = this.#payMethod(input.payMethod);
    if (!input.branchId) throw badRequest("BRANCH_REQUIRED", "A kiosk order needs a branch");
    if (!Array.isArray(input.items) || input.items.length === 0) throw badRequest("ITEMS_REQUIRED", "Add at least one item");
    if (!input.expectedTotal) throw badRequest("EXPECTED_TOTAL_REQUIRED", "Send the total the kiosk showed");
    const phone = input.customerPhone?.trim();
    if (phone && !E164.test(phone)) throw badRequest("PHONE_INVALID", "Give the number in full international format, e.g. +243…");
    if (payMethod === "MOBILE_MONEY" && !phone) throw badRequest("PHONE_REQUIRED", "Mobile-money payment needs the payer's number");

    const customerId = await this.db.tx({ country }, async (sql) => {
      await this.#authorise(sql, country, principal, input.branchId!);
      return this.#resolveCustomer(sql, country, phone, input.customerName);
    });

    const r = await this.commerce.place(country, principal, {
      branchId: input.branchId,
      items: input.items,
      orderType,
      // COUNTER = pay at the till on the spot (PLACED at once, like counter cash); MOBILE_MONEY = prepaid + intent.
      paymentMode: payMethod === "COUNTER" ? "CASH_ON_DELIVERY" : "PREPAID",
      expectedTotal: input.expectedTotal,
      ...(input.kitchenNote?.trim() ? { kitchenNote: input.kitchenNote } : {}),
    }, idempotencyKey, {
      customerId,
      channel: "HUB",
      deviceId: (input.deviceId?.trim() || "kiosk-web").slice(0, 64),
      ...(orderType === "DINE_IN" && input.tableId?.trim() ? { tableId: String(input.tableId).trim().slice(0, 16) } : {}),
    });
    // For the electronic methods the order is PENDING_PAYMENT; the kiosk device (trusted, branch-authorised)
    // raises the payment on the walk-in's behalf and hands back the next step (a QR to scan, or a push sent).
    let nextAction: unknown;
    if (payMethod === "QR" || payMethod === "MOBILE_MONEY") {
      const methodType = payMethod === "QR" ? "QR" : "MOBILE_MONEY_PUSH";
      const intent = await this.payments.create(
        country, principal,
        { orderId: r.orderId, methodType, payerCountry: country, payer: payMethod === "MOBILE_MONEY" && phone ? { msisdn: phone } : {} },
        `kiosk-pay:${r.orderId}:${payMethod}`,
        { trusted: true },
      ).catch(() => undefined);
      nextAction = intent?.next_action;
    }
    return { orderId: r.orderId, state: r.state, recipientCode: r.recipientCode, quote: r.quote, orderType, payMethod, ...(phone ? { customerPhone: phone } : {}), ...(nextAction ? { nextAction } : {}) };
  }

  /** Resolves the customer: a known customer by phone (so they keep history and loyalty) or the anonymous kiosk account. */
  async #resolveCustomer(sql: Sql, country: string, phone?: string, name?: string): Promise<string> {
    if (phone) return this.#findOrCreateUser(sql, phone, name?.trim() || "Guest", country);
    return this.#findOrCreateUser(sql, KIOSK_WALK_IN_PHONE, "Kiosk customer", country);
  }

  async #findOrCreateUser(sql: Sql, phone: string, displayName: string, country: string): Promise<string> {
    const [ins] = await sql.query<{ id: string }>(
      "INSERT INTO identity.app_user (phone_e164, display_name, home_country) VALUES ($1,$2,$3) ON CONFLICT (phone_e164) DO NOTHING RETURNING id::text AS id",
      [phone, displayName, country],
    );
    if (ins) return ins.id;
    const [existing] = await sql.query<{ id: string }>("SELECT id::text AS id FROM identity.app_user WHERE phone_e164 = $1", [phone]);
    if (!existing) throw notFound("Customer");
    return existing.id;
  }
}
