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

type ItemBody = { names: Record<string, string>; description?: Record<string, string>; prices: Record<string, string>; category?: string | null; veg?: boolean | null; tags?: string[]; allergens?: string[]; recommended?: boolean };
type QuoteBody = { branch_id: string; items: { item_id: string; quantity: number }[]; order_type: QuoteInput["orderType"]; delivery?: { lat: number; lng: number; rural?: boolean }; tip?: string };

const toQuoteInput = (b: QuoteBody): QuoteInput => {
  if (!b || typeof b.branch_id !== "string" || !Array.isArray(b.items)) throw badRequest("BODY_INVALID", "Send branch_id, items and order_type");
  return {
    branchId: b.branch_id,
    items: b.items.map((i) => ({ itemId: i.item_id, quantity: i.quantity })),
    orderType: b.order_type ?? "DELIVERY",
    ...(b.delivery ? { delivery: b.delivery } : {}),
    ...(b.tip ? { tip: b.tip } : {}),
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
    return serialiseQuote(await this.commerce.quote(country(req), toQuoteInput(body)));
  }

  @Post("orders")
  async place(@Req() req: FastifyRequest, @Body() body: QuoteBody & { payment_mode: PlaceOrderInput["paymentMode"]; expected_total: PlaceOrderInput["expectedTotal"]; recipient?: PlaceOrderInput["recipient"]; gifted?: boolean; contactless?: boolean; address?: { landmark?: string; voice_note_url?: string } }) {
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
    lines: s.lines.map((l) => ({ name: l.name, quantity: l.quantity, allergens: l.allergenFlags })),
    flagged_for_review: o.flaggedForReview,
    version: o.version,
  };
}
