/** /v1 endpoints (§25.2). Controllers are thin: parse, authenticate, delegate, shape the response. */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { currencies, currencyFlag, Money } from "@tunakula/ts-money";
import type { PaymentMethodType } from "@tunakula/ts-contracts";
import type { AdminService } from "../app/admin.ts";
import type { AuthService } from "../app/auth.ts";
import type { CatalogueService } from "../app/catalogue.ts";
import type { ConfigService } from "../app/config.ts";
import type { DispatchService } from "../app/dispatch.ts";
import type { EtaService } from "../app/eta.ts";
import type { OnboardingService } from "../app/onboarding.ts";
import type { MembershipService } from "../app/membership.ts";
import type { GroupOrderService } from "../app/group.ts";
import type { CouponService } from "../app/coupons.ts";
import type { ReviewService } from "../app/reviews.ts";
import type { AddressService } from "../app/addresses.ts";
import type { ReservationService, BookingStatus } from "../app/reservations.ts";
import type { NotificationService } from "../app/comms.ts";
import { serialiseQuote, type CommerceService, type PlaceOrderInput, type QuoteInput } from "../app/commerce.ts";
import { badRequest, notFound } from "../app/errors.ts";
import type { PaymentService } from "../app/payments.ts";
import { loadPrincipal } from "../app/principal.ts";
import type { TokenService } from "../app/tokens.ts";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { OrderAggregate, OrderCommand } from "../modules/ordering/order-aggregate.ts";
import { country, TOKENS, userId, wire, type Req as RawReq } from "./common.ts";

@Controller("v1")
export class PlatformController {
  constructor(@Inject(TOKENS.db) private readonly db: Db, @Inject(TOKENS.registry) private readonly registry: CountryConfigRegistry) {}

  @Get("health")
  async health() {
    await this.db.tx({}, (sql) => sql.query("SELECT 1"));
    return { status: "ok" };
  }

  @Get("countries")
  countries() {
    return { data: this.registry.countries() };
  }

  @Get("countries/:iso2/config")
  config(@Param("iso2") iso2: string) {
    if (!this.registry.published(iso2)) throw notFound(`Market ${iso2}`);
    return this.registry.config(iso2);
  }

  @Get("currencies")
  currencies() {
    return {
      data: currencies.list({ status: "ACTIVE" }).map((c) => ({ code: c.code, name: c.name, minor_units: c.minorUnits, flag: currencyFlag(c.code)?.emoji ?? null })),
    };
  }
}

@Controller("v1/auth/otp")
export class AuthController {
  constructor(@Inject(TOKENS.auth) private readonly auth: AuthService) {}

  @Post("request")
  @HttpCode(202)
  async request(@Body() body: { phone?: string; channel?: "SMS" | "WHATSAPP"; locale?: string }) {
    const { expiresAt } = await this.auth.requestCode(body?.phone ?? "", body?.channel ?? "SMS", body?.locale ?? "fr");
    return { sent: true, expires_at: expiresAt.toISOString() };
  }

  @Post("verify")
  @HttpCode(200)
  async verify(@Body() body: { phone?: string; code?: string; display_name?: string; home_country?: string }) {
    const r = await this.auth.verifyCode(body?.phone ?? "", body?.code ?? "", {
      ...(body?.display_name ? { displayName: body.display_name } : {}),
      ...(body?.home_country ? { homeCountry: body.home_country } : {}),
    });
    return { token: r.token, expires_at: r.expiresAt.toISOString(), user_id: r.userId, new_account: r.created };
  }
}

@Controller("v1")
export class CatalogueController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.catalogue) private readonly catalogue: CatalogueService,
    @Inject(TOKENS.eta) private readonly eta: EtaService,
  ) {}

  /** Storefronts near a point, nearest first, each with road distance in km, delivery time and fee. */
  @Get("branches/nearby")
  nearby(@Req() req: FastifyRequest, @Query("lat") lat: string, @Query("lng") lng: string, @Query("radius_km") radius?: string, @Query("limit") limit?: string) {
    return this.eta.nearby(country(req), { lat: Number(lat), lng: Number(lng) }, {
      ...(radius ? { radiusKm: Number(radius) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Get("branches/:id/eta")
  branchEta(@Req() req: FastifyRequest, @Param("id") id: string, @Query("lat") lat: string, @Query("lng") lng: string) {
    return this.eta.forBranch(country(req), id, { lat: Number(lat), lng: Number(lng) });
  }

  @Get("branches/:id/menu")
  menu(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.catalogue.menu(country(req), id);
  }

  @Post("branches")
  async createBranch(@Req() req: FastifyRequest, @Body() body: { name: string; restaurant_group_id: string; city?: string; commune?: string; lat: number; lng: number }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    const b = await this.catalogue.createBranch(country(req), principal, { name: body?.name, restaurantGroupId: body?.restaurant_group_id, ...(body?.city ? { city: body.city } : {}), ...(body?.commune ? { commune: body.commune } : {}), lat: body?.lat, lng: body?.lng });
    return { id: b.id, name: b.name, city: b.city, commune: b.commune, status: b.status };
  }

  @Post("branches/:id/items")
  async addItem(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: ItemBody) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.catalogue.addItem(country(req), principal, id, body ?? ({} as never));
  }

  @Post("branches/:id/items/:item")
  @HttpCode(200)
  async updateItem(@Req() req: FastifyRequest, @Param("id") id: string, @Param("item") item: string, @Body() body: ItemBody) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.catalogue.updateItem(country(req), principal, id, item, body ?? ({} as never));
  }

  /** Bulk upsert the menu (CSV is parsed client-side into rows). All-or-nothing: errors apply nothing. */
  @Post("branches/:id/menu/import")
  @HttpCode(200)
  async importMenu(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { rows?: (ItemBody & { id?: string; available?: boolean })[] }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.catalogue.importMenu(country(req), principal, id, body?.rows ?? []);
  }

  @Post("branches/:id/items/:item/availability")
  @HttpCode(200)
  async availability(@Req() req: FastifyRequest, @Param("id") id: string, @Param("item") item: string, @Body() body: { available: boolean }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    if (typeof body?.available !== "boolean") throw badRequest("AVAILABLE_REQUIRED", "Send { \"available\": true | false }");
    return this.catalogue.setAvailability(country(req), principal, id, item, body.available);
  }
}

type ItemBody = { names: Record<string, string>; description?: Record<string, string>; prices: Record<string, string>; category?: string | null; veg?: boolean | null; tags?: string[]; allergens?: string[]; recommended?: boolean; variations?: unknown; addons?: unknown };
type QuoteItemBody = { item_id: string; quantity: number; options?: { group: string; choices: string[] }[]; addons?: string[]; note?: string };
type QuoteBody = { branch_id: string; items: QuoteItemBody[]; order_type: QuoteInput["orderType"]; delivery?: { lat: number; lng: number; rural?: boolean }; tip?: string; coupon_code?: string };

const toQuoteInput = (b: QuoteBody): QuoteInput => {
  if (!b || typeof b.branch_id !== "string" || !Array.isArray(b.items)) throw badRequest("BODY_INVALID", "Send branch_id, items and order_type");
  return {
    branchId: b.branch_id,
    items: b.items.map((i) => ({ itemId: i.item_id, quantity: i.quantity, ...(Array.isArray(i.options) ? { options: i.options } : {}), ...(Array.isArray(i.addons) ? { addons: i.addons } : {}), ...(typeof i.note === "string" && i.note.trim() ? { note: i.note } : {}) })),
    orderType: b.order_type ?? "DELIVERY",
    ...(b.delivery ? { delivery: b.delivery } : {}),
    ...(b.tip ? { tip: b.tip } : {}),
    ...(b.coupon_code ? { couponCode: String(b.coupon_code) } : {}),
  };
};

@Controller("v1")
export class OrdersController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.commerce) private readonly commerce: CommerceService,
    @Inject(TOKENS.dispatch) private readonly dispatch: DispatchService,
  ) {}

  @Post("carts/quote")
  @HttpCode(200)
  async quote(@Req() req: FastifyRequest, @Body() body: QuoteBody) {
    // Optional auth: a signed-in customer sees their membership benefit on the quote; a guest sees the plain price.
    let customerId: string | undefined;
    try {
      customerId = userId(req, this.tokens);
    } catch {
      customerId = undefined;
    }
    return serialiseQuote(await this.commerce.quote(country(req), { ...toQuoteInput(body), ...(customerId ? { customerId } : {}) }));
  }

  @Post("orders")
  async place(@Req() req: FastifyRequest, @Body() body: QuoteBody & { payment_mode: PlaceOrderInput["paymentMode"]; expected_total: PlaceOrderInput["expectedTotal"]; recipient?: PlaceOrderInput["recipient"]; gifted?: boolean; contactless?: boolean; age_confirmed?: boolean; kitchen_note?: string; address?: { landmark?: string; voice_note_url?: string } }) {
    const uid = userId(req, this.tokens);
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, uid));
    const key = req.headers["idempotency-key"] as string;
    const r = await this.commerce.place(country(req), principal, {
      ...toQuoteInput(body),
      paymentMode: body.payment_mode ?? "PREPAID",
      expectedTotal: body.expected_total,
      ...(body.recipient ? { recipient: body.recipient } : {}),
      ...(body.gifted ? { gifted: true } : {}),
      ...(body.contactless ? { contactless: true } : {}),
      ...(body.age_confirmed ? { ageConfirmed: true } : {}),
      ...(typeof body.kitchen_note === "string" && body.kitchen_note.trim() ? { kitchenNote: body.kitchen_note } : {}),
      ...(body.address?.landmark ? { address: { landmark: String(body.address.landmark) } } : {}),
    }, key);
    return { order_id: r.orderId, state: r.state, recipient_code: r.recipientCode, quote: serialiseQuote(r.quote) };
  }

  @Get("orders/:id")
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    const c = country(req);
    const { order, timeline, branch } = await this.commerce.get(c, principal, id);
    const rider = order.riderId ? await this.dispatch.riderForCustomer(c, order.riderId, order.state, order.snapshot.dropLocation) : null;
    return { ...orderView(order), branch, rider, drop: order.snapshot.dropLocation ?? null, timeline: timeline.map((t) => ({ state: t.state, at: new Date(t.at).toISOString() })) };
  }

  @Get("me/orders")
  async mine(@Req() req: FastifyRequest, @Query("limit") limit?: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return { data: await this.commerce.myOrders(country(req), principal, limit ? Number(limit) : undefined) };
  }

  @Get("orders/:id/evidence")
  async evidence(@Req() req: FastifyRequest, @Param("id") id: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.commerce.evidence(country(req), principal, id);
  }

  @Post("orders/:id/transitions")
  @HttpCode(200)
  async transition(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { command?: OrderCommand }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    if (!body?.command?.type) throw badRequest("COMMAND_REQUIRED", "Send { \"command\": { \"type\": ... } }");
    const key = req.headers["idempotency-key"] as string;
    const r = await this.commerce.transition(country(req), principal, id, body.command, key);
    return { ...orderView(r.order), events: r.events.map((e) => ({ seq: e.seq, type: e.type, ...("to" in e ? { to: e.to } : {}) })) };
  }
}

@Controller("v1")
export class PaymentsController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.payments) private readonly payments: PaymentService,
  ) {}

  @Get("countries/:iso2/payment-methods")
  methods(@Param("iso2") iso2: string, @Query("amount_minor") amount: string, @Query("currency") currency: string, @Query("payer_country") payer?: string) {
    if (!/^\d+$/.test(amount ?? "") || !/^[A-Z]{3}$/.test(currency ?? "")) throw badRequest("AMOUNT_REQUIRED", "Send amount_minor and currency");
    Money.ofMinor(BigInt(amount), currency);
    return { data: this.payments.methods(iso2, payer ?? iso2, { currency, minor: amount }) };
  }

  @Post("payments/intents")
  async create(@Req() req: FastifyRequest, @Body() body: { order_id: string; method_type: PaymentMethodType; payer_country?: string; payer?: { msisdn?: string; token?: string } }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    const c = country(req);
    if (!body?.order_id || !body.method_type) throw badRequest("BODY_INVALID", "Send order_id and method_type");
    return this.payments.create(c, principal, { orderId: body.order_id, methodType: body.method_type, payerCountry: body.payer_country ?? c, payer: body.payer ?? {} }, req.headers["idempotency-key"] as string);
  }

  @Get("payments/intents/:id")
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.payments.get(country(req), principal, id);
  }
}

@Controller("v1/webhooks")
export class WebhooksController {
  constructor(@Inject(TOKENS.payments) private readonly payments: PaymentService) {}

  @Post("payments/:connector")
  @HttpCode(200)
  webhook(@Req() req: RawReq, @Param("connector") connector: string) {
    const raw = typeof req.rawBody === "string" ? req.rawBody : (req.rawBody?.toString("utf8") ?? "");
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return this.payments.webhook(connector, headers, raw);
  }
}

/** The signed-in person: roles and the console sections they can use in the active market (X-Country optional). */
@Controller("v1/me")
export class MeController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.admin) private readonly admin: AdminService,
  ) {}

  @Get()
  async me(@Req() req: FastifyRequest) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    const c = req.headers["x-country"];
    return this.admin.me(principal, typeof c === "string" && /^[A-Z]{2}$/.test(c) ? c : undefined);
  }
}

/** The rider app: go online, see and answer offers, see jobs and earnings. Pickup and drop use POST /v1/orders/:id/transitions. */
@Controller("v1/rider")
export class RiderController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.dispatch) private readonly dispatch: DispatchService,
  ) {}

  @Post("presence")
  @HttpCode(200)
  async presence(@Req() req: FastifyRequest, @Body() body: { online?: boolean; lat?: number; lng?: number; vehicle?: string }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.presence(principal, country(req), { online: body?.online as boolean, ...(body?.lat !== undefined ? { lat: Number(body.lat) } : {}), ...(body?.lng !== undefined ? { lng: Number(body.lng) } : {}), ...(body?.vehicle ? { vehicle: body.vehicle } : {}) });
  }

  @Get("jobs")
  async jobs(@Req() req: FastifyRequest) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.jobs(principal, country(req));
  }

  @Get("earnings")
  async earnings(@Req() req: FastifyRequest) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.earnings(principal, country(req));
  }

  @Post("cashout")
  @HttpCode(200)
  async cashout(@Req() req: FastifyRequest, @Body() body: { amount_minor?: string }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    const key = req.headers["idempotency-key"] as string;
    return this.dispatch.cashout(principal, country(req), body?.amount_minor, key);
  }

  @Post("sos")
  async sos(@Req() req: FastifyRequest, @Body() body: { kind?: string; lat?: number; lng?: number; note?: string; order_id?: string }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.raiseSos(principal, country(req), { ...(body?.kind ? { kind: body.kind } : {}), ...(body?.lat !== undefined ? { lat: Number(body.lat) } : {}), ...(body?.lng !== undefined ? { lng: Number(body.lng) } : {}), ...(body?.note ? { note: body.note } : {}), ...(body?.order_id ? { orderId: body.order_id } : {}) });
  }

  @Get("quests")
  async quests(@Req() req: FastifyRequest) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.quests(principal, country(req));
  }

  @Post("quests/:id/claim")
  @HttpCode(200)
  async claimQuest(@Req() req: FastifyRequest, @Param("id") id: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.claimQuest(principal, country(req), id);
  }

  @Post("offers/:id/accept")
  @HttpCode(200)
  async accept(@Req() req: FastifyRequest, @Param("id") id: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.respond(principal, country(req), id, true);
  }

  @Post("offers/:id/decline")
  @HttpCode(200)
  async decline(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { reason?: string }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.dispatch.respond(principal, country(req), id, false, body?.reason);
  }
}

/** Operations: the dispatch board, (re)assigning riders, cash hand-ins, refunds and rider applications. */
@Controller("v1/ops")
export class OpsController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.dispatch) private readonly dispatch: DispatchService,
    @Inject(TOKENS.onboarding) private readonly onboarding: OnboardingService,
  ) {}

  #me(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get("dispatch")
  async board(@Req() req: FastifyRequest) {
    return this.dispatch.board(await this.#me(req), country(req));
  }

  @Post("orders/:id/assign")
  @HttpCode(200)
  async assign(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { rider_id?: string; override?: boolean }) {
    return this.dispatch.assign(await this.#me(req), country(req), id, body?.rider_id ?? "", body?.override === true);
  }

  @Post("riders/:id/cash-in")
  @HttpCode(200)
  async cashIn(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { amount_minor?: string; note?: string }) {
    return this.dispatch.cashIn(await this.#me(req), country(req), id, String(body?.amount_minor ?? ""), body?.note);
  }

  @Get("incidents")
  async incidents(@Req() req: FastifyRequest) {
    return this.dispatch.incidents(await this.#me(req), country(req));
  }

  @Get("quests")
  async quests(@Req() req: FastifyRequest) {
    return this.dispatch.listQuests(await this.#me(req), country(req));
  }

  @Post("quests")
  async createQuest(@Req() req: FastifyRequest, @Body() body: { name?: string; target_deliveries?: number; bonus_minor?: string; days?: number }) {
    return this.dispatch.createQuest(await this.#me(req), country(req), body ?? {});
  }

  @Post("incidents/:id")
  @HttpCode(200)
  async updateIncident(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { status?: string }) {
    return this.dispatch.updateIncident(await this.#me(req), country(req), id, body?.status ?? "");
  }

  @Get("rider-applications")
  async applications(@Req() req: FastifyRequest, @Query("status") status?: string) {
    const s = ["PENDING", "APPROVED", "REJECTED", "ALL"].includes(status ?? "") ? (status as string) : "PENDING";
    return this.onboarding.list(await this.#me(req), country(req), s);
  }

  @Post("rider-applications/:id/approve")
  @HttpCode(200)
  async approve(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.onboarding.decide(await this.#me(req), country(req), id, true, body?.note);
  }

  @Post("rider-applications/:id/reject")
  @HttpCode(200)
  async reject(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.onboarding.decide(await this.#me(req), country(req), id, false, body?.note);
  }
}

/** Private images (identity documents, pack and proof photos) and rider applications. */
@Controller("v1")
export class OnboardingController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.onboarding) private readonly onboarding: OnboardingService,
  ) {}

  #me(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Post("media")
  async upload(@Req() req: FastifyRequest, @Body() body: { purpose: string; content_type: string; data_base64: string }) {
    return this.onboarding.upload(await this.#me(req), country(req), body ?? ({} as never));
  }

  @Get("media/:id")
  async media(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.onboarding.read(await this.#me(req), country(req), id);
  }

  @Post("rider-applications")
  async apply(@Req() req: FastifyRequest, @Body() body: Parameters<OnboardingService["apply"]>[2]) {
    return this.onboarding.apply(await this.#me(req), country(req), body ?? ({} as never));
  }

  @Get("rider-applications/mine")
  async mine(@Req() req: FastifyRequest) {
    return this.onboarding.mine(await this.#me(req), country(req));
  }
}

/** Kitchen board: the orders a kitchen is handling, and pausing intake. Order actions use POST /v1/orders/:id/transitions. */
@Controller("v1/kitchen")
export class KitchenController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.admin) private readonly admin: AdminService,
  ) {}

  @Get("orders")
  async orders(@Req() req: FastifyRequest, @Query("branch_id") branchId?: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.admin.kitchen(principal, country(req), branchId || undefined);
  }

  @Post("branches/:id/status")
  @HttpCode(200)
  async status(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { status?: string; reason?: string }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.admin.setBranchStatus(principal, country(req), id, body?.status ?? "", body?.reason);
  }
}

/** Admin console: analytics, orders, branches, team and roles, payments, ledger, audit. All scoped by X-Country. */
@Controller("v1/admin")
export class AdminController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.admin) private readonly admin: AdminService,
  ) {}

  #principal(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get("analytics")
  async analytics(@Req() req: FastifyRequest, @Query("days") days?: string) {
    return this.admin.analytics(await this.#principal(req), country(req), Number(days ?? 30));
  }

  @Get("orders")
  async orders(@Req() req: FastifyRequest, @Query("group") group?: string, @Query("limit") limit?: string, @Query("before") before?: string) {
    return this.admin.orders(await this.#principal(req), country(req), {
      ...(group ? { group } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(before ? { before } : {}),
    });
  }

  @Get("branches")
  async branches(@Req() req: FastifyRequest) {
    return this.admin.branches(await this.#principal(req), country(req));
  }

  @Get("payments")
  async payments(@Req() req: FastifyRequest, @Query("status") status?: string) {
    return this.admin.payments(await this.#principal(req), country(req), status);
  }

  @Get("ledger")
  async ledger(@Req() req: FastifyRequest) {
    return this.admin.ledger(await this.#principal(req), country(req));
  }

  @Get("audit")
  async audit(@Req() req: FastifyRequest, @Query("limit") limit?: string) {
    return this.admin.audit(await this.#principal(req), country(req), Number(limit ?? 100));
  }

  @Get("team")
  async team(@Req() req: FastifyRequest) {
    return this.admin.team(await this.#principal(req), country(req));
  }

  @Get("users")
  async user(@Req() req: FastifyRequest, @Query("phone") phone?: string) {
    if (!phone) throw badRequest("PHONE_REQUIRED", "Search by phone number, e.g. +243810000000");
    return this.admin.findUser(await this.#principal(req), country(req), phone);
  }

  @Post("role-bindings")
  async grant(@Req() req: FastifyRequest, @Body() body: Parameters<AdminService["grant"]>[2]) {
    return this.admin.grant(await this.#principal(req), country(req), body);
  }

  @Delete("role-bindings/:id")
  @HttpCode(200)
  async revoke(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.admin.revoke(await this.#principal(req), country(req), id);
  }

  @Get("scorecards")
  async scorecards(@Req() req: FastifyRequest, @Query("days") days?: string) {
    return this.admin.scorecards(await this.#principal(req), country(req), days ? Number(days) : undefined);
  }

  @Get("branches/:id/hours")
  async getHours(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.admin.branchHours(await this.#principal(req), country(req), id);
  }

  @Post("branches/:id/hours")
  @HttpCode(200)
  async setHours(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { hours?: unknown; special_hours?: unknown }) {
    return this.admin.setBranchHours(await this.#principal(req), country(req), id, body ?? {});
  }
}

/** Country Profile administration (§17): drafts, dual-controlled publishes, rollback, history and diff. */
@Controller("v1/admin/countries")
export class AdminConfigController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.config) private readonly config: ConfigService,
  ) {}

  #principal(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Post("drafts")
  async draft(@Req() req: FastifyRequest, @Body() body: { profile?: unknown }) {
    if (!body?.profile) throw badRequest("PROFILE_REQUIRED", "Send { \"profile\": { ...Country Profile } }");
    return this.config.saveDraft(await this.#principal(req), body.profile);
  }

  @Post(":iso2/versions/:version/publish")
  @HttpCode(200)
  async publish(@Req() req: FastifyRequest, @Param("iso2") iso2: string, @Param("version") version: string, @Body() body: { review?: Record<string, { signed_by?: string }> }) {
    return this.config.publish(await this.#principal(req), iso2, Number(version), body?.review ?? {});
  }

  @Post(":iso2/rollback")
  @HttpCode(200)
  async rollback(@Req() req: FastifyRequest, @Param("iso2") iso2: string) {
    return this.config.rollback(await this.#principal(req), iso2);
  }

  @Get(":iso2/versions")
  async versions(@Req() req: FastifyRequest, @Param("iso2") iso2: string) {
    return { data: this.config.history(await this.#principal(req), iso2) };
  }

  @Get(":iso2/diff")
  async diff(@Req() req: FastifyRequest, @Param("iso2") iso2: string, @Query("from") from: string, @Query("to") to: string) {
    return { data: this.config.diff(await this.#principal(req), iso2, Number(from), Number(to)) };
  }
}

/** The recipient's in-app inbox and their channel opt-outs. */
@Controller("v1/notifications")
export class NotificationsController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.comms) private readonly comms: NotificationService,
  ) {}

  #me(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get()
  async inbox(@Req() req: FastifyRequest, @Query("unread") unread?: string, @Query("limit") limit?: string) {
    return this.comms.inbox(await this.#me(req), country(req), { unreadOnly: unread === "1" || unread === "true", ...(limit ? { limit: Number(limit) } : {}) });
  }

  @Post(":id/read")
  @HttpCode(200)
  async read(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.comms.markRead(await this.#me(req), country(req), id);
  }

  @Get("preferences")
  async prefs(@Req() req: FastifyRequest) {
    return this.comms.preferences(await this.#me(req), country(req));
  }

  @Post("preferences")
  @HttpCode(200)
  async setPrefs(@Req() req: FastifyRequest, @Body() body: { channel?: string; enabled?: boolean }) {
    return this.comms.setPreference(await this.#me(req), country(req), body?.channel ?? "", body?.enabled !== false);
  }
}

/** Operations: the delivery log and a self-test. The catalogue itself is shared code the console reads directly. */
@Controller("v1/comms")
export class CommsController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.comms) private readonly comms: NotificationService,
  ) {}

  #me(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get("deliveries")
  async deliveries(@Req() req: FastifyRequest, @Query("limit") limit?: string) {
    return this.comms.deliveries(await this.#me(req), country(req), limit ? Number(limit) : 50);
  }

  @Post("test")
  @HttpCode(200)
  async test(@Req() req: FastifyRequest, @Body() body: { event_key?: string; data?: Record<string, string | number> }) {
    return this.comms.sendTest(await this.#me(req), country(req), body?.event_key ?? "", body?.data ?? {});
  }
}

/** Paid customer membership — the "Plus" subscription: browse plans, subscribe, view and cancel. */
@Controller("v1")
export class MembershipController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.membership) private readonly membership: MembershipService,
  ) {}

  #principal(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  /** Public: the plans available to subscribe to in this market. */
  @Get("membership/plans")
  async plans(@Req() req: FastifyRequest) {
    return { data: await this.membership.plans(country(req)) };
  }

  /** Customer: the caller's current membership, or null. */
  @Get("me/membership")
  async mine(@Req() req: FastifyRequest) {
    return this.membership.mine(country(req), await this.#principal(req));
  }

  /** Customer: subscribe to a plan. */
  @Post("me/membership")
  async subscribe(@Req() req: FastifyRequest, @Body() body: { plan_id?: string }) {
    if (!body?.plan_id) throw badRequest("PLAN_REQUIRED", "Send { \"plan_id\": ... }");
    const key = req.headers["idempotency-key"] as string;
    return this.membership.subscribe(country(req), await this.#principal(req), body.plan_id, key);
  }

  /** Customer: cancel — stops auto-renewal, benefits last until the period ends. */
  @Delete("me/membership")
  @HttpCode(200)
  async cancel(@Req() req: FastifyRequest) {
    return this.membership.cancel(country(req), await this.#principal(req));
  }

  /** Admin: every plan in this market (including inactive). */
  @Get("admin/membership/plans")
  async adminPlans(@Req() req: FastifyRequest) {
    return { data: await this.membership.allPlans(country(req), await this.#principal(req)) };
  }

  /** Admin: create a plan. */
  @Post("admin/membership/plans")
  async createPlan(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) {
    return this.membership.savePlan(country(req), await this.#principal(req), undefined, body ?? {});
  }

  /** Admin: update a plan. */
  @Post("admin/membership/plans/:id")
  @HttpCode(200)
  async updatePlan(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.membership.savePlan(country(req), await this.#principal(req), id, body ?? {});
  }
}

/** Group ordering — a shared cart several people fill via an invite code; the host places and the bill splits. */
@Controller("v1/group-carts")
export class GroupController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.group) private readonly group: GroupOrderService,
  ) {}

  #p(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Post()
  async create(@Req() req: FastifyRequest, @Body() body: { branch_id?: string; order_type?: "DELIVERY" | "TAKEAWAY"; split_mode?: "HOST_PAYS" | "EACH_PAYS"; deadline_minutes?: number }) {
    if (!body?.branch_id) throw badRequest("BRANCH_REQUIRED", "Send branch_id");
    return this.group.create(country(req), await this.#p(req), { branchId: body.branch_id, ...(body.order_type ? { orderType: body.order_type } : {}), ...(body.split_mode ? { splitMode: body.split_mode } : {}), ...(body.deadline_minutes ? { deadlineMinutes: Number(body.deadline_minutes) } : {}) });
  }

  @Post("join")
  @HttpCode(200)
  async join(@Req() req: FastifyRequest, @Body() body: { code?: string }) {
    if (!body?.code) throw badRequest("CODE_REQUIRED", "Send the invite code");
    return this.group.join(country(req), await this.#p(req), body.code);
  }

  @Get(":id")
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.group.get(country(req), await this.#p(req), id);
  }

  @Post(":id/lines")
  async addItem(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { item_id?: string; quantity?: number; options?: unknown; addons?: unknown }) {
    if (!body?.item_id) throw badRequest("ITEM_REQUIRED", "Send item_id and quantity");
    return this.group.addItem(country(req), await this.#p(req), id, { itemId: body.item_id, quantity: Number(body.quantity ?? 1), options: body.options, addons: body.addons });
  }

  @Delete(":id/lines/:line")
  @HttpCode(200)
  async removeItem(@Req() req: FastifyRequest, @Param("id") id: string, @Param("line") line: string) {
    return this.group.removeItem(country(req), await this.#p(req), id, line);
  }

  @Post(":id/lock")
  @HttpCode(200)
  async lock(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { locked?: boolean }) {
    return this.group.lock(country(req), await this.#p(req), id, body?.locked !== false);
  }

  @Post(":id/quote")
  @HttpCode(200)
  async quote(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { delivery?: { lat: number; lng: number }; tip?: string }) {
    return this.group.quote(country(req), await this.#p(req), id, { ...(body?.delivery ? { delivery: body.delivery } : {}), ...(body?.tip ? { tip: body.tip } : {}) });
  }

  @Post(":id/place")
  async place(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { payment_mode?: "PREPAID" | "CASH_ON_DELIVERY"; expected_total?: { amount_minor: string; currency: string }; delivery?: { lat: number; lng: number }; tip?: string; address?: { landmark?: string } }) {
    if (!body?.expected_total) throw badRequest("EXPECTED_TOTAL_REQUIRED", "Send the total you confirmed");
    const key = req.headers["idempotency-key"] as string;
    return this.group.place(country(req), await this.#p(req), id, {
      paymentMode: body.payment_mode ?? "PREPAID",
      expectedTotal: body.expected_total,
      ...(body.delivery ? { delivery: body.delivery } : {}),
      ...(body.tip ? { tip: body.tip } : {}),
      ...(body.address ? { address: body.address } : {}),
    }, key);
  }
}

/** Coupons / promo codes — admin defines them; customers apply them at checkout via coupon_code. */
@Controller("v1/admin/coupons")
export class CouponController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.coupons) private readonly coupons: CouponService,
  ) {}

  #p(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get()
  async list(@Req() req: FastifyRequest) {
    return this.coupons.list(country(req), await this.#p(req));
  }

  @Post()
  async create(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) {
    return this.coupons.save(country(req), await this.#p(req), undefined, body ?? {});
  }

  @Post(":id")
  @HttpCode(200)
  async update(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.coupons.save(country(req), await this.#p(req), id, body ?? {});
  }
}

/** Saved delivery addresses for the signed-in customer. */
@Controller("v1/me/addresses")
export class AddressController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.addresses) private readonly addresses: AddressService,
  ) {}

  #p(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get()
  async list(@Req() req: FastifyRequest) {
    return this.addresses.list(country(req), await this.#p(req));
  }

  @Post()
  async create(@Req() req: FastifyRequest, @Body() body: { label?: string; lat?: number; lng?: number; landmark?: string; contact_phone?: string; is_default?: boolean }) {
    return this.addresses.create(country(req), await this.#p(req), { label: body?.label, lat: body?.lat, lng: body?.lng, ...(body?.landmark ? { landmark: body.landmark } : {}), ...(body?.contact_phone ? { contactPhone: body.contact_phone } : {}), ...(body?.is_default ? { isDefault: true } : {}) });
  }

  @Post(":id/default")
  @HttpCode(200)
  async setDefault(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.addresses.setDefault(country(req), await this.#p(req), id);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.addresses.remove(country(req), await this.#p(req), id);
  }
}

/** Favourite restaurants for the signed-in customer. */
@Controller("v1/me/favourites")
export class FavouriteController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.addresses) private readonly addresses: AddressService,
  ) {}

  #p(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Get()
  async list(@Req() req: FastifyRequest) {
    return this.addresses.favourites(country(req), await this.#p(req));
  }

  @Post(":branchId")
  @HttpCode(200)
  async toggle(@Req() req: FastifyRequest, @Param("branchId") branchId: string) {
    return this.addresses.toggleFavourite(country(req), await this.#p(req), branchId);
  }
}

/** Reviews & ratings — customers rate a delivered order; restaurants reply; storefronts show the average. */
@Controller("v1")
export class ReviewController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.reviews) private readonly reviews: ReviewService,
  ) {}

  #p(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  @Post("orders/:id/review")
  async submit(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { restaurant_rating?: number; rider_rating?: number; comment?: string }) {
    return this.reviews.submit(country(req), await this.#p(req), id, { restaurantRating: Number(body?.restaurant_rating), ...(body?.rider_rating !== undefined ? { riderRating: Number(body.rider_rating) } : {}), ...(body?.comment ? { comment: body.comment } : {}) });
  }

  @Get("orders/:id/review")
  async forOrder(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.reviews.forOrder(country(req), await this.#p(req), id);
  }

  /** Public: a storefront's rating and recent reviews. */
  @Get("branches/:id/reviews")
  async forBranch(@Req() req: FastifyRequest, @Param("id") id: string, @Query("limit") limit?: string) {
    return this.reviews.forBranch(country(req), id, limit ? Number(limit) : undefined);
  }

  /** Merchant: every review for a branch they manage. */
  @Get("admin/branches/:id/reviews")
  async forMerchant(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.reviews.listForMerchant(country(req), await this.#p(req), id);
  }

  @Post("admin/reviews/:id/reply")
  @HttpCode(200)
  async reply(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { reply?: string }) {
    return this.reviews.reply(country(req), await this.#p(req), id, body?.reply ?? "");
  }
}

/** Table bookings (dine-in reservations). Customers book a table for 1+ people; restaurants confirm, seat and complete. */
@Controller("v1")
export class ReservationController {
  constructor(
    @Inject(TOKENS.db) private readonly db: Db,
    @Inject(TOKENS.tokens) private readonly tokens: TokenService,
    @Inject(TOKENS.reservations) private readonly reservations: ReservationService,
  ) {}

  #p(req: FastifyRequest) {
    return this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
  }

  /** Customer: book a table. */
  @Post("reservations")
  async book(@Req() req: FastifyRequest, @Body() body: { branch_id?: string; party_size?: number; at?: string; duration_min?: number; name?: string; phone?: string; note?: string }) {
    if (!body?.branch_id || !body?.at) throw badRequest("BODY_INVALID", "Send branch_id, party_size and at (seating time)");
    return this.reservations.book(country(req), await this.#p(req), {
      branchId: String(body.branch_id), partySize: Number(body.party_size), at: String(body.at),
      ...(body.duration_min !== undefined ? { durationMin: Number(body.duration_min) } : {}),
      ...(body.name ? { name: String(body.name) } : {}), ...(body.phone ? { phone: String(body.phone) } : {}), ...(body.note ? { note: String(body.note) } : {}),
    });
  }

  /** Customer: their own bookings. */
  @Get("me/reservations")
  async mine(@Req() req: FastifyRequest, @Query("limit") limit?: string) {
    return this.reservations.mine(country(req), await this.#p(req), limit ? Number(limit) : undefined);
  }

  /** Customer: cancel their own booking. */
  @Post("reservations/:id/cancel")
  @HttpCode(200)
  async cancel(@Req() req: FastifyRequest, @Param("id") id: string) {
    return this.reservations.cancelMine(country(req), await this.#p(req), id);
  }

  /** Merchant: bookings for a branch they manage. */
  @Get("admin/branches/:id/reservations")
  async forBranch(@Req() req: FastifyRequest, @Param("id") id: string, @Query("limit") limit?: string) {
    return this.reservations.forBranch(country(req), await this.#p(req), id, limit ? Number(limit) : undefined);
  }

  /** Merchant: confirm, seat, complete, decline or no-show a booking. */
  @Post("admin/reservations/:id/status")
  @HttpCode(200)
  async setStatus(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { status?: string }) {
    return this.reservations.setStatus(country(req), await this.#p(req), id, String(body?.status ?? "") as BookingStatus);
  }
}

function orderView(o: OrderAggregate) {
  const s = o.snapshot;
  return {
    order_id: s.orderId,
    state: o.state,
    type: s.type,
    branch_id: s.branchId,
    total: wire(Money.fromJSON(s.total)),
    payment_mode: s.paymentMode,
    rider_id: o.riderId ?? null,
    lines: s.lines.map((l) => ({ name: l.name, quantity: l.quantity, allergens: l.allergenFlags, options: l.options, ...(l.note ? { note: l.note } : {}) })),
    ...(s.kitchenNote ? { kitchen_note: s.kitchenNote } : {}),
    ...(s.deliveryNote ? { delivery_note: s.deliveryNote } : {}),
    flagged_for_review: o.flaggedForReview,
    version: o.version,
  };
}
