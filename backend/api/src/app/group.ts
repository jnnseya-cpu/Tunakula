/**
 * Group ordering (shared carts). Several customers build one cart from their own phones via an invite
 * code; the host places it as a single order and everyone sees their share of the bill. Pricing and
 * placement go through the same CommerceService as a solo order, so custody, fees and the ledger are
 * identical. Additive: the solo browser cart is untouched.
 */
import { randomInt } from "node:crypto";
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { getBranch, menuOf } from "../persistence/catalogue.ts";
import { userById } from "../persistence/identity.ts";
import {
  addLine,
  addMember,
  cartById,
  cartByCode,
  createCart,
  isMember,
  linesOf,
  membersOf,
  removeLine,
  setCartStatus,
  type GroupCartRow,
  type GroupLineRow,
} from "../persistence/group.ts";
import type { CommerceService, PlaceOrderInput, Quote } from "./commerce.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alikes
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join("");

export class GroupOrderService {
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

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** Host starts a group cart for a branch. */
  async create(country: string, principal: Principal, input: { branchId: string; orderType?: "DELIVERY" | "TAKEAWAY"; splitMode?: "HOST_PAYS" | "EACH_PAYS"; deadlineMinutes?: number }) {
    const profile = this.profile(country);
    require(principal, "order:place", { type: "group_cart", country }, { activeCountry: country, profile });
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, input.branchId);
      if (!branch || branch.country_iso2 !== country) throw notFound("Branch");
      const deadline = input.deadlineMinutes && input.deadlineMinutes > 0 ? new Date(this.now().getTime() + Math.min(input.deadlineMinutes, 1440) * 60_000) : null;
      let cart: GroupCartRow | undefined;
      for (let i = 0; i < 5 && !cart; i++) {
        try {
          cart = await createCart(sql, { country, branchId: branch.id, hostUserId: principal.userId, code: newCode(), orderType: input.orderType ?? "DELIVERY", splitMode: input.splitMode ?? "HOST_PAYS", deadline });
        } catch (e) {
          if (i === 4) throw e; // keep retrying on a code collision
        }
      }
      const host = await userById(sql, principal.userId);
      await addMember(sql, { country, cartId: cart!.id, userId: principal.userId, name: host?.display_name ?? "Host", host: true });
      return this.#view(sql, country, cart!);
    });
  }

  /** Someone opens the invite link and joins by code. */
  async join(country: string, principal: Principal, code: string) {
    const profile = this.profile(country);
    require(principal, "order:place", { type: "group_cart", country }, { activeCountry: country, profile });
    return this.db.tx({ country }, async (sql) => {
      const cart = await cartByCode(sql, code.toUpperCase().trim());
      if (!cart) throw notFound("Group order");
      if (cart.status !== "OPEN") throw conflict("GROUP_CLOSED", "This group order is no longer open to join");
      const user = await userById(sql, principal.userId);
      await addMember(sql, { country, cartId: cart.id, userId: principal.userId, name: user?.display_name ?? "Guest", host: false });
      return this.#view(sql, country, cart);
    });
  }

  async get(country: string, principal: Principal, cartId: string) {
    return this.db.tx({ country }, async (sql) => {
      const cart = await this.#memberCart(sql, cartId, principal.userId);
      return this.#view(sql, country, cart);
    });
  }

  /** A member adds one of their own lines. */
  async addItem(country: string, principal: Principal, cartId: string, input: { itemId: string; quantity: number; options?: unknown; addons?: unknown }) {
    return this.db.tx({ country }, async (sql) => {
      const cart = await this.#memberCart(sql, cartId, principal.userId);
      if (cart.status !== "OPEN") throw conflict("GROUP_LOCKED", "The group order is locked; the host is checking out");
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw badRequest("QUANTITY_INVALID", "Quantities are whole numbers from 1 to 99");
      const menu = new Map((await menuOf(sql, cart.branch_id)).map((m) => [m.id, m]));
      if (!menu.has(input.itemId)) throw unprocessable("ITEM_NOT_ON_MENU", "That item is not on this menu");
      await addLine(sql, { country, cartId, userId: principal.userId, itemId: input.itemId, quantity: input.quantity, options: input.options, addons: input.addons });
      return this.#view(sql, country, cart);
    });
  }

  async removeItem(country: string, principal: Principal, cartId: string, lineId: string) {
    return this.db.tx({ country }, async (sql) => {
      const cart = await this.#memberCart(sql, cartId, principal.userId);
      if (cart.status !== "OPEN") throw conflict("GROUP_LOCKED", "The group order is locked");
      const ok = await removeLine(sql, cartId, lineId, principal.userId);
      if (!ok) throw notFound("Line"); // not yours, or not there
      return this.#view(sql, country, cart);
    });
  }

  /** The host locks the cart so no one adds more while they check out. */
  async lock(country: string, principal: Principal, cartId: string, locked: boolean) {
    return this.db.tx({ country }, async (sql) => {
      const cart = await this.#hostCart(sql, cartId, principal.userId);
      if (cart.status === "PLACED" || cart.status === "CANCELLED") throw conflict("GROUP_CLOSED", `The group order is ${cart.status}`);
      await setCartStatus(sql, cartId, locked ? "LOCKED" : "OPEN");
      return this.#view(sql, country, { ...cart, status: locked ? "LOCKED" : "OPEN" });
    });
  }

  /** The host places the whole group cart as one order. */
  async place(country: string, principal: Principal, cartId: string, input: { paymentMode: "PREPAID" | "CASH_ON_DELIVERY"; expectedTotal: { amount_minor: string; currency: string }; delivery?: { lat: number; lng: number }; tip?: string; address?: { landmark?: string } }, idempotencyKey: string) {
    const cart = await this.db.tx({ country }, (sql) => this.#hostCart(sql, cartId, principal.userId));
    if (cart.status === "PLACED") throw conflict("ALREADY_PLACED", "This group order was already placed");
    const { items } = await this.db.tx({ country }, (sql) => this.#items(sql, cartId));
    if (!items.length) throw badRequest("EMPTY_GROUP", "No one has added anything yet");
    const placeInput: PlaceOrderInput = {
      branchId: cart.branch_id,
      items: items.map((i) => ({ itemId: i.itemId, quantity: i.quantity, ...(i.options.length ? { options: i.options } : {}), ...(i.addons.length ? { addons: i.addons } : {}) })),
      orderType: cart.order_type,
      paymentMode: input.paymentMode,
      expectedTotal: input.expectedTotal,
      ...(cart.order_type === "DELIVERY" && input.delivery ? { delivery: input.delivery } : {}),
      ...(input.tip ? { tip: input.tip } : {}),
      ...(input.address?.landmark ? { address: { landmark: input.address.landmark } } : {}),
    };
    const result = await this.commerce.place(country, principal, placeInput, `group:${cartId}:${idempotencyKey}`);
    await this.db.tx({ country }, (sql) => setCartStatus(sql, cartId, "PLACED", result.orderId));
    return { order_id: result.orderId, state: result.state, recipient_code: result.recipientCode };
  }

  /** The full breakdown and the per-person split for the current cart. */
  async quote(country: string, principal: Principal, cartId: string, input: { delivery?: { lat: number; lng: number }; tip?: string }) {
    return this.db.tx({ country }, async (sql) => {
      const cart = await this.#memberCart(sql, cartId, principal.userId);
      const { items, memberOf } = await this.#items(sql, cartId);
      if (!items.length) throw badRequest("EMPTY_GROUP", "No one has added anything yet");
      const quote = await this.commerce.quote(country, {
        branchId: cart.branch_id,
        items: items.map((i) => ({ itemId: i.itemId, quantity: i.quantity, ...(i.options.length ? { options: i.options } : {}), ...(i.addons.length ? { addons: i.addons } : {}) })),
        orderType: cart.order_type,
        ...(cart.order_type === "DELIVERY" && input.delivery ? { delivery: input.delivery } : {}),
        ...(input.tip ? { tip: input.tip } : {}),
      });
      const split = this.#split(quote, memberOf, await membersOf(sql, cartId));
      const b = quote.breakdown;
      const w = (m: Money) => ({ amount_minor: m.minor.toString(), currency: m.currency });
      return {
        order_type: cart.order_type,
        breakdown: {
          goods: w(b.goods), service_charge: w(b.serviceCharge),
          delivery_fee: w(b.customerDeliveryFee ?? Money.zero(b.currency)),
          tip: w(b.tip), total: w(b.total),
        },
        split_mode: cart.split_mode,
        split,
      };
    });
  }

  // ── internals ──

  async #memberCart(sql: Sql, cartId: string, userId: string): Promise<GroupCartRow> {
    const cart = await cartById(sql, cartId);
    if (!cart) throw notFound("Group order");
    if (!(await isMember(sql, cartId, userId))) throw forbidden("You are not in this group order");
    return cart;
  }
  async #hostCart(sql: Sql, cartId: string, userId: string): Promise<GroupCartRow> {
    const cart = await cartById(sql, cartId);
    if (!cart) throw notFound("Group order");
    if (cart.host_user_id !== userId) throw forbidden("Only the host can do this");
    return cart;
  }

  /** The cart's lines as pricing items, with a parallel array naming the member each belongs to. */
  async #items(sql: Sql, cartId: string): Promise<{ items: { itemId: string; quantity: number; options: { group: string; choices: string[] }[]; addons: string[] }[]; memberOf: string[] }> {
    const lines = await linesOf(sql, cartId);
    return {
      items: lines.map((l) => ({ itemId: l.item_id, quantity: l.quantity, options: l.options ?? [], addons: l.addons ?? [] })),
      memberOf: lines.map((l) => l.member_user_id),
    };
  }

  /** Each member's fair share: their own food, plus a proportional slice of the service charge, delivery and tip. */
  #split(quote: Quote, memberOf: string[], members: { user_id: string; display_name: string }[]): { user_id: string; name: string; items_minor: string; share_minor: string; currency: string }[] {
    const ccy = quote.breakdown.currency;
    const goodsByMember = new Map<string, Money>();
    quote.lines.forEach((line, i) => {
      const uid = memberOf[i]!;
      goodsByMember.set(uid, (goodsByMember.get(uid) ?? Money.zero(ccy)).add(Money.fromJSON(line.total)));
    });
    const b = quote.breakdown;
    const extras = b.serviceCharge.add(b.customerDeliveryFee ?? Money.zero(ccy)).add(b.tip);
    // Allocate the extras across members by their food weight, exactly (no cents lost).
    const ids = members.map((m) => m.user_id).filter((id) => goodsByMember.has(id));
    const weights = ids.map((id) => Number((goodsByMember.get(id) ?? Money.zero(ccy)).minor));
    const allocated = extras.isZero() || weights.every((w) => w === 0) ? ids.map(() => Money.zero(ccy)) : extras.allocate(weights);
    return ids.map((id, i) => {
      const goods = goodsByMember.get(id) ?? Money.zero(ccy);
      const share = goods.add(allocated[i]!);
      const m = members.find((x) => x.user_id === id)!;
      return { user_id: id, name: m.display_name, items_minor: goods.minor.toString(), share_minor: share.minor.toString(), currency: ccy };
    });
  }

  async #view(sql: Sql, country: string, cart: GroupCartRow) {
    const members = await membersOf(sql, cart.id);
    const lines = await linesOf(sql, cart.id);
    const lang = this.profile(country).country.default_locale.slice(0, 2);
    const menu = new Map((await menuOf(sql, cart.branch_id)).map((m) => [m.id, m]));
    const branch = await getBranch(sql, cart.branch_id);
    const ccy = this.profile(country).money.settlement_currency;
    const lineView = (l: GroupLineRow) => {
      const item = menu.get(l.item_id);
      const name = item ? (item.names[lang] ?? item.names.fr ?? item.names.en ?? Object.values(item.names)[0] ?? "") : "Item";
      const unit = item?.prices[ccy] ?? "0";
      return { id: l.id, member_user_id: l.member_user_id, item_id: l.item_id, name, quantity: l.quantity, options: l.options, addons: l.addons, line_total: { amount_minor: (BigInt(unit) * BigInt(l.quantity)).toString(), currency: ccy } };
    };
    return {
      id: cart.id,
      code: cart.code,
      status: cart.status,
      order_type: cart.order_type,
      split_mode: cart.split_mode,
      host_user_id: cart.host_user_id,
      branch: branch ? { id: branch.id, name: branch.name } : { id: cart.branch_id, name: "" },
      deadline: cart.deadline ? new Date(cart.deadline).toISOString() : null,
      placed_order_id: cart.placed_order_id,
      members: members.map((m) => ({ user_id: m.user_id, name: m.display_name, is_host: m.is_host })),
      lines: lines.map(lineView),
    };
  }
}
