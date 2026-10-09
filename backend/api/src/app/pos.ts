/**
 * Built-in POS (point of sale). Branch staff take a walk-in order at the counter — pick dishes, choose takeaway
 * or dine-in, take cash — and it lands PLACED on the same kitchen board as an online order, stamped with the POS
 * channel and the cashier (staffId). The StackFood free-POS equivalent. Additive: it reuses the cart quote/place
 * path (commerce) with a POS context; nothing in the online flow changes. Counter cash is paid up front, so the
 * on-delivery cash policy is skipped and the order is PLACED at once (no payment intent).
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
interface PosInput {
  branchId?: string;
  items?: QuoteInput["items"];
  orderType?: string;
  tableId?: string;
  deviceId?: string;
  customerPhone?: string;
  customerName?: string;
  kitchenNote?: string;
  expectedTotal?: { amount_minor: string; currency: string };
}

const E164 = /^\+[1-9][0-9]{6,14}$/;
/** One shared, format-valid sentinel account for anonymous counter sales (app_user.phone_e164 is globally unique). */
const WALK_IN_PHONE = "+99900000000";

export class PosService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly commerce: CommerceService;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, commerce: CommerceService, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.commerce = commerce;
    this.now = now;
  }

  #profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  #counterType(t?: string): CounterType {
    const v = String(t ?? "TAKEAWAY").toUpperCase();
    if (v !== "TAKEAWAY" && v !== "DINE_IN") throw badRequest("ORDER_TYPE_INVALID", "A counter order is TAKEAWAY or DINE_IN");
    return v;
  }

  /** The staff member must hold pos:operate at this branch. Returns the branch row. */
  async #authorise(sql: Sql, country: string, principal: Principal, branchId: string) {
    const branch = await getBranch(sql, branchId);
    if (!branch) throw notFound("Branch");
    require(principal, "pos:operate", { type: "order", country, branchId, restaurantGroupId: branch.restaurant_group_id, brandId: branch.brand_id }, { activeCountry: country, profile: this.#profile(country) });
    return branch;
  }

  /** POST /v1/pos/quote — price a counter cart (plain price; membership/coupons are app features). */
  async quote(country: string, principal: Principal, input: PosInput) {
    const orderType = this.#counterType(input.orderType);
    if (!input.branchId) throw badRequest("BRANCH_REQUIRED", "A counter order needs a branch");
    if (!Array.isArray(input.items) || input.items.length === 0) throw badRequest("ITEMS_REQUIRED", "Add at least one item");
    await this.db.tx({ country }, (sql) => this.#authorise(sql, country, principal, input.branchId!));
    return this.commerce.quote(country, { branchId: input.branchId, items: input.items, orderType });
  }

  /** POST /v1/pos/orders — place a cash counter order. It is PLACED at once and shows on the kitchen board. */
  async place(country: string, principal: Principal, input: PosInput, idempotencyKey: string) {
    const orderType = this.#counterType(input.orderType);
    if (!input.branchId) throw badRequest("BRANCH_REQUIRED", "A counter order needs a branch");
    if (!Array.isArray(input.items) || input.items.length === 0) throw badRequest("ITEMS_REQUIRED", "Add at least one item");
    if (!input.expectedTotal) throw badRequest("EXPECTED_TOTAL_REQUIRED", "Send the total the cashier confirmed");
    const phone = input.customerPhone?.trim();
    if (phone && !E164.test(phone)) throw badRequest("PHONE_INVALID", "Give the customer's number in full international format, e.g. +243…");

    const customerId = await this.db.tx({ country }, async (sql) => {
      await this.#authorise(sql, country, principal, input.branchId!);
      return this.#resolveCustomer(sql, country, phone, input.customerName);
    });

    const r = await this.commerce.place(country, principal, {
      branchId: input.branchId,
      items: input.items,
      orderType,
      paymentMode: "CASH_ON_DELIVERY", // counter cash → PLACED at once, no payment intent
      expectedTotal: input.expectedTotal,
      ...(input.kitchenNote?.trim() ? { kitchenNote: input.kitchenNote } : {}),
    }, idempotencyKey, {
      customerId,
      staffId: principal.userId,
      // In-store orders record the till they were taken on; a web terminal defaults to one per cashier.
      deviceId: (input.deviceId?.trim() || `pos-web:${principal.userId}`).slice(0, 64),
      ...(orderType === "DINE_IN" && input.tableId?.trim() ? { tableId: String(input.tableId).trim().slice(0, 16) } : {}),
    });
    return { orderId: r.orderId, state: r.state, recipientCode: r.recipientCode, quote: r.quote, orderType, ...(phone ? { customerPhone: phone } : {}) };
  }

  /**
   * Resolves the customer the order is attributed to: a known customer by phone (found or created so they keep a
   * history and earn loyalty), or the shared anonymous walk-in account. Race-safe via ON CONFLICT on the phone.
   */
  async #resolveCustomer(sql: Sql, country: string, phone?: string, name?: string): Promise<string> {
    if (phone) return this.#findOrCreateUser(sql, phone, name?.trim() || "Guest", country);
    return this.#findOrCreateUser(sql, WALK_IN_PHONE, "Walk-in customer", country);
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
