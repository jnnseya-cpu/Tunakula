/** /v1 endpoints (§25.2). Controllers are thin: parse, authenticate, delegate, shape the response. */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { currencies, currencyFlag, Money } from "@tunakula/ts-money";
import type { PaymentMethodType } from "@tunakula/ts-contracts";
import type { AdminService } from "../app/admin.ts";
import type { AuthService } from "../app/auth.ts";
import type { CatalogueService } from "../app/catalogue.ts";
import type { ConfigService } from "../app/config.ts";
import type { EtaService } from "../app/eta.ts";
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
  async addItem(@Req() req: FastifyRequest, @Param("id") id: string, @Body() body: { names: Record<string, string>; prices: Record<string, string>; tags?: string[]; allergens?: string[] }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    return this.catalogue.addItem(country(req), principal, id, body ?? ({} as never));
  }

  @Post("branches/:id/items/:item/availability")
  @HttpCode(200)
  async availability(@Req() req: FastifyRequest, @Param("id") id: string, @Param("item") item: string, @Body() body: { available: boolean }) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    if (typeof body?.available !== "boolean") throw badRequest("AVAILABLE_REQUIRED", "Send { \"available\": true | false }");
    return this.catalogue.setAvailability(country(req), principal, id, item, body.available);
  }
}

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
    }, key);
    return { order_id: r.orderId, state: r.state, recipient_code: r.recipientCode, quote: serialiseQuote(r.quote) };
  }

  @Get("orders/:id")
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    const principal = await this.db.tx({}, (sql) => loadPrincipal(sql, userId(req, this.tokens)));
    const { order, timeline, branch } = await this.commerce.get(country(req), principal, id);
    return { ...orderView(order), branch, timeline: timeline.map((t) => ({ state: t.state, at: new Date(t.at).toISOString() })) };
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
