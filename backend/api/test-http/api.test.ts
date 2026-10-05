/**
 * End-to-end: HTTP → NestJS → services → PostgreSQL (RLS, append-only, balanced journals).
 * Needs a PostgreSQL 16 server (TEST_DATABASE_ADMIN_URL); each run creates and drops its own database.
 */
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import type { ConnectorCapability } from "@tunakula/ts-contracts";
import { DevOtpOutbox } from "../src/app/auth.ts";
import { testDatabase } from "../src/db/testing.ts";
import type { Db } from "../src/db/db.ts";
import { createApi } from "../src/http/app.ts";
import { addBinding, verifyAuditChain, type NewBinding } from "../src/persistence/identity.ts";
import { loadVersions, saveVersions } from "../src/persistence/config.ts";
import { CountryConfigRegistry, GROUP_INTERNAL_BRAND, READINESS_AREAS, TUNAKULA_BRAND } from "../src/index.ts";

const profile = (iso: "cd" | "gb" | "sn") => {
  const p = syntheticProfileDocument(iso);
  delete p.synthetic;
  p.country.status = "LIVE";
  if (iso !== "gb") p.compliance.data_residency = "africa-south1";
  return p;
};
const review = () => Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "ceo", at: new Date() }]));
const cap = (): ConnectorCapability => ({
  methodType: "MOBILE_MONEY_PUSH",
  countries: ["CD"],
  currencies: ["USD", "CDF"],
  limits: [],
  flow: "ASYNC",
  refund: "PARTIAL",
  payout: true,
  settlement: { currency: "USD", delayDays: 1 },
  fees: { percentBps: 150 },
});

const KINSHASA = { lat: -4.3125, lng: 15.2847 };
const DROP = { lat: -4.3215, lng: 15.2947 };

let api: NestFastifyApplication;
let db: Db;
let owner: pg.Client;
let drop: () => Promise<void>;
const otp = new DevOtpOutbox();
const primary = new SandboxConnector({ id: "bitripay", capabilities: [cap()], webhookSecret: "whsec-test" });
const fallback = new SandboxConnector({ id: "sandbox", capabilities: [cap()] });

type Res = { status: number; body: any; headers: Record<string, unknown> };
async function call(method: string, url: string, opts: { token?: string; country?: string; key?: string | false; body?: unknown; raw?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.country) headers["x-country"] = opts.country;
  if (method !== "GET" && opts.key !== false) headers["idempotency-key"] = opts.key ?? randomUUID();
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
  const r = await api.inject({ method: method as "GET", url, headers, ...(opts.raw !== undefined ? { payload: opts.raw } : opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, headers: r.headers };
}

async function signIn(phone: string): Promise<{ token: string; userId: string }> {
  assert.equal((await call("POST", "/v1/auth/otp/request", { body: { phone } })).status, 202);
  const code = otp.sent.get(phone) as string;
  const r = await call("POST", "/v1/auth/otp/verify", { body: { phone, code, display_name: phone.slice(-4) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.token, userId: r.body.user_id };
}

/** The owner is subject to FORCE RLS too: inspection queries run inside a country context. */
async function inspect(country: string, text: string, params: unknown[] = []): Promise<any[]> {
  await owner.query("BEGIN");
  try {
    await owner.query("SELECT set_config('app.country', $1, true)", [country]);
    const r = await owner.query(text, params);
    await owner.query("COMMIT");
    return r.rows;
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
}

const grant = (b: NewBinding) => db.tx({}, (sql) => addBinding(sql, b));
/** Accounts opened today are below the COD account-age floor; tests that need COD backdate the account. */
const backdate = (userId: string, days: number) => owner.query("UPDATE identity.app_user SET created_at = now() - make_interval(days => $2) WHERE id = $1", [userId, days]);

let customer: { token: string; userId: string };
let admin: { token: string; userId: string };
let restaurantOwner: { token: string; userId: string };
let kitchen: { token: string; userId: string };
let rider: { token: string; userId: string };
let ops: { token: string; userId: string };
let branchId: string;
let itemId: string;
let pepperSoupId: string;

before(async () => {
  const t = await testDatabase();
  db = t.db;
  drop = t.drop;
  owner = new pg.Client({ connectionString: t.ownerUrl });
  await owner.connect();
  const registry = new CountryConfigRegistry({
    brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
    connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
    apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
  });
  for (const iso of ["cd", "gb"] as const) {
    const draft = registry.saveDraft("country-admin", profile(iso));
    registry.publish("ceo", iso.toUpperCase(), draft.version, review());
  }
  // Config is durable: what the registry holds is saved and comes back on boot.
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  const restored = new CountryConfigRegistry({
    brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
    connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
    apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
  });
  restored.restore(await db.tx({}, loadVersions));
  api = await createApi({ db, registry: restored, connectors: [primary, fallback], tokenSecret: "test-secret-test-secret-test-secret!!", otp, onError: (e) => console.error(e), corsOrigins: ["https://console.tunakula.com"] });

  customer = await signIn("+243810000001");
  admin = await signIn("+243810000002");
  restaurantOwner = await signIn("+243810000003");
  kitchen = await signIn("+243810000004");
  rider = await signIn("+243810000005");
  ops = await signIn("+243810000006");
  await grant({ userId: admin.userId, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "CD" } });
  await grant({ userId: restaurantOwner.userId, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: "rg-chez-maman" } });
  await grant({ userId: rider.userId, role: "RIDER", scope: { type: "ZONE", id: "gombe" } });
  await grant({ userId: ops.userId, role: "CITY_OPS", scope: { type: "CITY", id: "kinshasa" } });
});

after(async () => {
  await api?.close();
  await owner?.end();
  await drop?.();
});

describe("platform", () => {
  test("health checks the database", async () => {
    const r = await call("GET", "/v1/health");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: "ok" });
  });

  test("countries and config come from published, restored profiles", async () => {
    const c = await call("GET", "/v1/countries");
    assert.deepEqual(c.body.data.map((x: { iso2: string }) => x.iso2).sort(), ["CD", "GB"]);
    const cfg = await call("GET", "/v1/countries/CD/config");
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.api_host ?? cfg.body.apiHost, "https://af.api.tunakula.com");
    assert.equal((await call("GET", "/v1/countries/ZZ/config")).status, 404);
  });

  test("Appendix A: every currency carries its flag", async () => {
    const r = await call("GET", "/v1/currencies");
    const usd = r.body.data.find((c: { code: string }) => c.code === "USD");
    const cdf = r.body.data.find((c: { code: string }) => c.code === "CDF");
    assert.equal(usd.flag, "🇺🇸");
    assert.equal(cdf.flag, "🇨🇩");
    assert.equal(cdf.minor_units, 2);
  });

  test("errors are problem+json with a stable code", async () => {
    const r = await api.inject({ method: "GET", url: "/v1/orders/not-an-id", headers: { "x-country": "CD" } });
    assert.equal(r.statusCode, 401);
    assert.match(String(r.headers["content-type"]), /application\/problem\+json/);
    const body = JSON.parse(r.body);
    assert.equal(body.code, "UNAUTHENTICATED");
    assert.equal(body.type, "https://www.tunakula.com/problems/unauthenticated");
  });
});

describe("sign-in (IDN-001)", () => {
  test("wrong codes are refused and attempts are limited", async () => {
    const phone = "+243810000099";
    await call("POST", "/v1/auth/otp/request", { body: { phone } });
    const right = otp.sent.get(phone) as string;
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) assert.equal((await call("POST", "/v1/auth/otp/verify", { body: { phone, code: wrong } })).body.code, "CODE_WRONG");
    // Even the right code fails once the attempts are spent: the counter survives the failed requests.
    const locked = await call("POST", "/v1/auth/otp/verify", { body: { phone, code: right } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.code, "TOO_MANY_ATTEMPTS");
  });

  test("invalid phone numbers are rejected", async () => {
    const r = await call("POST", "/v1/auth/otp/request", { body: { phone: "0810000000" } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "PHONE_INVALID");
  });

  test("the same phone signs into the same global account", async () => {
    const again = await signIn("+243810000001");
    assert.equal(again.userId, customer.userId);
  });
});

describe("§25.1 idempotency", () => {
  test("mutations without an Idempotency-Key are refused", async () => {
    const r = await call("POST", "/v1/carts/quote", { country: "CD", key: false, body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("catalogue (CAT-002/003) under scoped permissions", () => {
  test("customers cannot create branches; a country admin can", async () => {
    const body = { name: "Chez Maman Gombe", restaurant_group_id: "rg-chez-maman", city: "kinshasa", commune: "gombe", ...KINSHASA };
    assert.equal((await call("POST", "/v1/branches", { token: customer.token, country: "CD", body })).status, 403);
    const r = await call("POST", "/v1/branches", { token: admin.token, country: "CD", body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    branchId = r.body.id;
    assert.equal(r.body.city, "kinshasa");
    await grant({ userId: kitchen.userId, role: "KITCHEN_STAFF", scope: { type: "BRANCH", id: branchId } });
  });

  test("the restaurant owner writes the menu; prices are exact minor units", async () => {
    const r = await call("POST", `/v1/branches/${branchId}/items`, {
      token: restaurantOwner.token,
      country: "CD",
      body: { names: { fr: "Poulet à la moambe", en: "Chicken moambe" }, prices: { USD: "12.50", CDF: "35000" }, tags: ["signature"], allergens: ["peanuts"] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    itemId = r.body.id;
    assert.deepEqual(r.body.prices.USD, { amount_minor: "1250", currency: "USD" });
    const soup = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Soupe pili-pili" }, prices: { USD: "4.00" } } });
    pepperSoupId = soup.body.id;
  });

  test("bad prices and currencies are refused", async () => {
    const tooPrecise = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "X" }, prices: { USD: "1.005" } } });
    assert.equal(tooPrecise.status, 400);
    assert.equal(tooPrecise.body.code, "PRICE_INVALID");
    const gbp = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "X" }, prices: { GBP: "1.00", USD: "1.00" } } });
    assert.equal(gbp.body.code, "CURRENCY_NOT_ACCEPTED");
    const noSettlement = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "X" }, prices: { CDF: "1000" } } });
    assert.equal(noSettlement.body.code, "SETTLEMENT_PRICE_REQUIRED");
  });

  test("§9.5 RLS: the branch does not exist from the GB market", async () => {
    assert.equal((await call("GET", `/v1/branches/${branchId}/menu`, { country: "CD" })).status, 200);
    assert.equal((await call("GET", `/v1/branches/${branchId}/menu`, { country: "GB" })).status, 404);
  });

  test("kitchen staff toggle availability; unavailable items cannot be ordered", async () => {
    const off = await call("POST", `/v1/branches/${branchId}/items/${pepperSoupId}/availability`, { token: kitchen.token, country: "CD", body: { available: false } });
    assert.equal(off.status, 403, "KITCHEN_STAFF has no availability:write");
    await call("POST", `/v1/branches/${branchId}/items/${pepperSoupId}/availability`, { token: restaurantOwner.token, country: "CD", body: { available: false } });
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: branchId, items: [{ item_id: pepperSoupId, quantity: 1 }], order_type: "DELIVERY", delivery: DROP } });
    assert.equal(q.body.code, "ITEM_UNAVAILABLE");
  });
});

const cart = () => ({ branch_id: branchId, items: [{ item_id: itemId, quantity: 2 }], order_type: "DELIVERY", delivery: DROP });

describe("§18 quote and place", () => {
  test("the quote is priced by the engine: 0% commission, 10% service charge, distance fee", async () => {
    const r = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.commission, { amount_minor: "0", currency: "USD" });
    const line = (code: string) => r.body.price_lines.find((l: { code: string }) => l.code === code)?.amount.amount_minor;
    assert.equal(line("GOODS") ?? r.body.lines[0].total.amount_minor, "2500");
    assert.equal(line("SERVICE_CHARGE"), "250");
    assert.ok(r.body.distance_meters > 1000);
    assert.ok(r.body.delivery.charged_km >= 1);
    const sum = r.body.price_lines.reduce((s: bigint, l: { amount: { amount_minor: string } }) => s + BigInt(l.amount.amount_minor), 0n);
    assert.equal(sum.toString(), r.body.total.amount_minor);
  });

  test("placing with a stale total returns PRICE_CHANGED and the fresh quote", async () => {
    const r = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", expected_total: { amount_minor: "1", currency: "USD" } } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "PRICE_CHANGED");
    assert.ok(r.body.quote.total.amount_minor);
  });

  test("an Idempotency-Key replays the same order, never a second one", async () => {
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const key = randomUUID();
    const body = { ...cart(), payment_mode: "PREPAID", expected_total: q.body.total };
    const first = await call("POST", "/v1/orders", { token: customer.token, country: "CD", key, body });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const again = await call("POST", "/v1/orders", { token: customer.token, country: "CD", key, body });
    assert.equal(again.status, 201);
    assert.equal(again.headers["idempotent-replay"], "true");
    assert.equal(again.body.order_id, first.body.order_id);
    const reused = await call("POST", "/v1/orders", { token: customer.token, country: "CD", key, body: { ...body, items: [{ item_id: itemId, quantity: 3 }] } });
    assert.equal(reused.status, 422);
    assert.equal(reused.body.code, "IDEMPOTENCY_KEY_REUSED");
  });

  test("§20.4 COD: refused for new accounts, allowed under the exception once the account is old enough", async () => {
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const body = { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total };
    const young = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body });
    assert.equal(young.body.code, "COD_ACCOUNT_TOO_NEW");
    await backdate(customer.userId, 30);
    const ok = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.state, "PLACED");
    const gb = await call("POST", "/v1/carts/quote", { country: "GB", body: cart() });
    assert.equal(gb.status, 404, "a CD branch is invisible from GB");
  });

  test("COD above the cash cap is refused", async () => {
    const big = { ...cart(), items: [{ item_id: itemId, quantity: 13 }] };
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: big });
    const r = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...big, payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total } });
    assert.equal(r.body.code, "COD_ABOVE_CAP");
  });
});

async function placePrepaid(): Promise<{ orderId: string; code: string; total: { amount_minor: string; currency: string } }> {
  const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
  const r = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", expected_total: q.body.total } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.state, "PENDING_PAYMENT");
  return { orderId: r.body.order_id, code: r.body.recipient_code, total: q.body.total };
}

const transition = (who: { token: string }, orderId: string, command: Record<string, unknown>) =>
  call("POST", `/v1/orders/${orderId}/transitions`, { token: who.token, country: "CD", body: { command } });

describe("§20 payments", () => {
  test("payment methods follow the profile order and limits", async () => {
    const r = await call("GET", "/v1/countries/CD/payment-methods?amount_minor=2000&currency=USD&payer_country=CD");
    assert.equal(r.status, 200);
    assert.equal(r.body.data[0], "MOBILE_MONEY_PUSH");
    const over = await call("GET", "/v1/countries/CD/payment-methods?amount_minor=60000&currency=USD&payer_country=CD");
    assert.ok(!over.body.data.includes("MOBILE_MONEY_PUSH"), "above the 500.00 limit");
  });

  test("only the customer can pay; a sync success places the order; the intent is idempotent", async () => {
    const { orderId } = await placePrepaid();
    const stranger = await call("POST", "/v1/payments/intents", { token: rider.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    assert.equal(stranger.status, 403);
    const key = randomUUID();
    const body = { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } };
    const r = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", key, body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, "SUCCEEDED");
    assert.equal(r.body.connector, "bitripay");
    const again = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", key, body });
    assert.equal(again.body.id, r.body.id);
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.state, "PLACED");
    const second = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body });
    assert.equal(second.body.code, "ORDER_NOT_AWAITING_PAYMENT");
  });

  test("ADR 0003: an unreachable primary falls back to the next connector", async () => {
    const { orderId } = await placePrepaid();
    primary.unreachable = true;
    try {
      const r = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
      assert.equal(r.body.status, "SUCCEEDED");
      assert.equal(r.body.connector, "sandbox");
      const [attempts] = await inspect("CD", "SELECT count(*)::int AS n FROM payments.payment_attempt WHERE intent_id = $1", [r.body.id]);
      assert.equal(attempts.n, 2);
    } finally {
      primary.unreachable = false;
    }
  });

  test("a declined payment fails the order", async () => {
    const { orderId } = await placePrepaid();
    primary.defaultOutcome = "INSUFFICIENT_FUNDS";
    try {
      const r = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
      assert.equal(r.body.status, "FAILED");
      assert.equal(r.body.reason_code, "INSUFFICIENT_FUNDS");
    } finally {
      primary.defaultOutcome = "SUCCEED";
    }
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.state, "PAYMENT_FAILED");
  });

  test("async payments complete by signed webhook, routed to the right country and deduplicated", async () => {
    const { orderId } = await placePrepaid();
    primary.defaultOutcome = "ASYNC_SUCCEED";
    let intentId: string;
    try {
      const r = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
      assert.equal(r.body.status, "PENDING_CUSTOMER_ACTION");
      intentId = r.body.id;
    } finally {
      primary.defaultOutcome = "SUCCEED";
    }
    const [row] = await inspect("CD", "SELECT provider_ref FROM payments.payment_intent WHERE id = $1", [intentId]);
    const hook = primary.completeAsync(row.provider_ref);
    const forged = await call("POST", "/v1/webhooks/payments/bitripay", { raw: hook.body, headers: { ...hook.headers, "x-sandbox-signature": "00".repeat(32) } });
    assert.equal(forged.status, 422);
    const ok = await call("POST", "/v1/webhooks/payments/bitripay", { raw: hook.body, headers: hook.headers });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { accepted: true });
    const dup = await call("POST", "/v1/webhooks/payments/bitripay", { raw: hook.body, headers: hook.headers });
    assert.deepEqual(dup.body, { accepted: true, duplicate: true });
    assert.equal((await call("GET", `/v1/payments/intents/${intentId}`, { token: customer.token, country: "CD" })).body.status, "SUCCEEDED");
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.state, "PLACED");
  });
});

describe("§10–§11 custody chain end to end (RIDER_FIRST)", () => {
  test("place → pay → rider → kitchen gates → pickup → verified drop → settlement journal", async () => {
    const { orderId, code, total } = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });

    // RIDER_FIRST: the kitchen cannot accept before a rider is secured.
    const early = await transition(kitchen, orderId, { type: "ACCEPT" });
    assert.equal(early.body.code, "RIDER_FIRST");
    assert.equal((await transition(kitchen, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId })).status, 403);
    const assigned = await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(assigned.body.rider_id, rider.userId);

    assert.equal((await transition(kitchen, orderId, { type: "ACCEPT" })).body.state, "ACCEPTED");
    assert.equal((await transition(kitchen, orderId, { type: "START_PREPARING" })).body.state, "PREPARING");
    const noAck = await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: false });
    assert.equal(noAck.body.code, "ALLERGEN_ACK_REQUIRED", "the dish contains peanuts");
    assert.equal((await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true })).body.state, "PACKED");
    assert.equal((await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "L-1", sealId: "S-1" }], packPhotoRef: "photo://pack" })).body.state, "READY");

    assert.equal((await transition(customer, orderId, { type: "PICK_UP", scannedLabelIds: ["L-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA })).status, 403);
    assert.equal((await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["L-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA })).body.state, "PICKED_UP");

    const deliver = { type: "DELIVER", scannedLabelId: "L-1", location: DROP, sealIntact: true };
    const wrong = await transition(rider, orderId, { ...deliver, verification: { method: "CODE", code: code === "0000" ? "1111" : "0000" } });
    assert.equal(wrong.body.code, "RECIPIENT_CODE_WRONG");
    const done = await transition(rider, orderId, { ...deliver, verification: { method: "CODE", code } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.state, "DELIVERED");

    // PRC-016: one balanced settlement journal, posted in the delivery transaction.
    const entries = (await inspect(
      "CD",
      "SELECT e.account, e.amount_minor::text AS amount FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1 ORDER BY e.line",
      [`order:${orderId}:settlement`],
    )) as { account: string; amount: string }[];
    assert.ok(entries.length >= 4);
    assert.equal(entries.reduce((s, e) => s + BigInt(e.amount), 0n), 0n);
    assert.deepEqual(entries[0], { account: "psp_clearing", amount: total.amount_minor });
    const service = entries.find((e) => e.account === "service_charge_revenue");
    assert.equal(service?.amount, "-250");
    assert.ok(!entries.some((e) => e.account === "commission_revenue"), "§18: 0% commission");

    // Evidence bundle (§11.7) for disputes.
    const ev = await call("GET", `/v1/orders/${orderId}/evidence`, { token: customer.token, country: "CD" });
    assert.equal(ev.status, 200);
    assert.ok(JSON.stringify(ev.body).includes("L-1"));
    // Other customers cannot read it.
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: rider.token, country: "CD" })).status, 403);
    // RLS: from the GB market the order does not exist.
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "GB" })).status, 404);
  });

  test("takeaway: the branch hands over at the counter with the code; no rider is involved", async () => {
    const body = { branch_id: branchId, items: [{ item_id: itemId, quantity: 1 }], order_type: "TAKEAWAY" };
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body });
    assert.equal(q.body.delivery, undefined);
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...body, payment_mode: "PREPAID", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const id = placed.body.order_id;
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: id, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    assert.equal((await transition(kitchen, id, { type: "ACCEPT" })).body.state, "ACCEPTED", "rider-first applies only to rider orders");
    await transition(kitchen, id, { type: "START_PREPARING" });
    await transition(kitchen, id, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, id, { type: "MARK_READY", packages: [{ labelId: "T-1", sealId: "TS-1" }], packPhotoRef: "photo://pack" });
    assert.equal((await transition(rider, id, { type: "DELIVER", verification: { method: "CODE", code: placed.body.recipient_code }, sealIntact: true })).status, 403, "riders do not hand over takeaway");
    const done = await transition(kitchen, id, { type: "DELIVER", verification: { method: "CODE", code: placed.body.recipient_code }, sealIntact: true });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.state, "DELIVERED");
  });

  test("a customer may cancel their own order before acceptance, not someone else's", async () => {
    const { orderId } = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    assert.equal((await transition(rider, orderId, { type: "CANCEL", reasonCode: "CHANGED_MIND" })).status, 403);
    const r = await transition(customer, orderId, { type: "CANCEL", reasonCode: "CHANGED_MIND" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.state, "CANCELLED");
  });
});

describe("§17 Country Profile administration (CFG-001/002, dual control)", () => {
  let superAdmin: { token: string; userId: string };
  let snAdmin: { token: string; userId: string };
  const fullSignOff = () => Object.fromEntries(READINESS_AREAS.map((a) => [a, { signed_by: "readiness-board" }]));
  const draft = (who: { token: string }, p: unknown) => call("POST", "/v1/admin/countries/drafts", { token: who.token, body: { profile: p } });
  const publish = (who: { token: string }, version: number, review: unknown = {}) =>
    call("POST", `/v1/admin/countries/SN/versions/${version}/publish`, { token: who.token, body: { review } });

  before(async () => {
    superAdmin = await signIn("+243810000010");
    snAdmin = await signIn("+221770000011");
    await grant({ userId: superAdmin.userId, role: "SUPER_ADMIN", scope: { type: "GROUP" } });
    await grant({ userId: snAdmin.userId, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "SN" } });
  });

  test("drafts need country_config:write in that country, and must validate", async () => {
    assert.equal((await draft(customer, profile("sn"))).status, 403);
    assert.equal((await draft(admin, profile("sn"))).status, 403, "a CD country admin cannot draft SN");
    const bad = await draft(snAdmin, { ...profile("sn"), money: { currencies: [] } });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.code, "PROFILE_INVALID");
    const ok = await draft(snAdmin, profile("sn"));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { iso2: "SN", version: 1, status: "DRAFT" });
  });

  test("a first publish needs a Super Admin and the §28.10 readiness review", async () => {
    assert.equal((await publish(snAdmin, 1, fullSignOff())).status, 403);
    const unreviewed = await publish(superAdmin, 1);
    assert.equal(unreviewed.status, 422);
    assert.equal(unreviewed.body.code, "CONFIG_REJECTED");
    const ok = await publish(superAdmin, 1, fullSignOff());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const countries = await call("GET", "/v1/countries");
    assert.ok(countries.body.data.some((c: { iso2: string }) => c.iso2 === "SN"));
  });

  test("non-sensitive changes are published by the country admin", async () => {
    const p = profile("sn");
    p.operations.support_hours = "07:00-23:30";
    const d = await draft(snAdmin, p);
    assert.equal(d.body.version, 2);
    const r = await publish(snAdmin, 2);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  test("pricing changes need a second person who is a Super Admin", async () => {
    const p = profile("sn");
    p.operations.support_hours = "07:00-23:30";
    p.pricing.service_charge_bps = 900;
    assert.equal((await draft(snAdmin, p)).body.version, 3);
    const diff = await call("GET", "/v1/admin/countries/SN/diff?from=2&to=3", { token: snAdmin.token });
    assert.deepEqual(diff.body.data, [{ path: "/pricing/service_charge_bps", before: 1000, after: 900 }]);
    const own = await publish(snAdmin, 3);
    assert.equal(own.status, 403);
    assert.match(own.body.detail, /pricing/);
    // The Super Admin cannot approve their own pricing draft either.
    const p4 = { ...p, pricing: { ...p.pricing, service_charge_bps: 800 } };
    assert.equal((await draft(superAdmin, p4)).body.version, 4);
    const self = await publish(superAdmin, 4);
    assert.equal(self.status, 403);
    assert.match(self.body.detail, /Dual control/);
    const approved = await publish(superAdmin, 3);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
  });

  test("rollback republishes the previous version as a new one; history is durable", async () => {
    const r = await call("POST", "/v1/admin/countries/SN/rollback", { token: snAdmin.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const versions = await call("GET", "/v1/admin/countries/SN/versions", { token: snAdmin.token });
    const statuses = versions.body.data.map((v: { version: number; status: string }) => `${v.version}:${v.status}`);
    assert.deepEqual(statuses, ["1:SUPERSEDED", "2:SUPERSEDED", "3:SUPERSEDED", "4:DRAFT", "5:PUBLISHED"]);
    const rows = await db.tx({}, (sql) => sql.query<{ version: number; status: string }>("SELECT version, status FROM config.country_profile WHERE iso2 = 'SN' ORDER BY version"));
    assert.deepEqual(rows.map((x) => `${x.version}:${x.status}`), statuses);
    assert.equal((await call("GET", "/v1/admin/countries/SN/versions", { token: customer.token })).status, 403);
  });
});

describe("admin console API", () => {
  let sa: { token: string; userId: string };
  let financeUser: { token: string; userId: string };
  const get = (who: { token: string }, url: string, c = "CD") => call("GET", url, { token: who.token, country: c });
  const grantVia = (who: { token: string }, body: unknown) => call("POST", "/v1/admin/role-bindings", { token: who.token, country: "CD", body });

  before(async () => {
    sa = await signIn("+243810000020");
    await grant({ userId: sa.userId, role: "SUPER_ADMIN", scope: { type: "GROUP" } });
  });

  test("/v1/me shows each person only the sections their roles allow", async () => {
    const a = await get(admin, "/v1/me");
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.capabilities.markets, true);
    assert.equal(a.body.capabilities.orders, true);
    assert.equal(a.body.capabilities.finance, false);
    assert.ok(a.body.bindings.some((b: { role: string }) => b.role === "COUNTRY_ADMIN"));
    const owner = await get(restaurantOwner, "/v1/me");
    assert.equal(owner.body.capabilities.orders, true);
    assert.equal(owner.body.capabilities.markets, false);
    assert.equal(owner.body.capabilities.payments, false);
    const c = await get(customer, "/v1/me");
    assert.ok(Object.values(c.body.capabilities).every((v) => v === false));
  });

  test("analytics: the whole market for a country admin, with every chart's data", async () => {
    const r = await get(admin, "/v1/admin/analytics?days=30");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.scope.kind, "market");
    assert.equal(r.body.period.currency, "USD");
    assert.equal(r.body.daily.length, 31);
    assert.ok(r.body.kpis.current.orders >= 4);
    assert.ok(r.body.kpis.current.delivered >= 1);
    assert.ok(BigInt(r.body.kpis.current.gmv_minor) > 0n);
    const stage = (s: string) => r.body.funnel.find((f: { stage: string }) => f.stage === s).orders;
    assert.ok(stage("PLACED") >= stage("DELIVERED") && stage("DELIVERED") >= 1);
    assert.ok(r.body.heatmap.length >= 1);
    assert.ok(r.body.top_dishes.some((d: { name: string }) => d.name === "Poulet à la moambe"));
    assert.ok(r.body.riders.some((x: { rider_id: string }) => x.rider_id === rider.userId));
    assert.equal(r.body.delivery_minutes.buckets.length, 6);
    assert.equal(r.body.finance, null, "a country admin does not hold ledger:read");
    assert.equal(r.body.daily.reduce((s: number, d: { orders: number }) => s + d.orders, 0), r.body.kpis.current.orders);
  });

  test("analytics and orders: a restaurant owner sees only their own branches; a customer sees nothing", async () => {
    const r = await get(restaurantOwner, "/v1/admin/analytics?days=7");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.scope.kind, "branches");
    assert.deepEqual(r.body.scope.branches.map((b: { id: string }) => b.id), [branchId]);
    const orders = await get(restaurantOwner, "/v1/admin/orders?group=delivered");
    assert.ok(orders.body.data.length >= 1);
    assert.ok(orders.body.data.every((o: { branch_id: string; state: string }) => o.branch_id === branchId && ["DELIVERED", "REFUND_REQUESTED"].includes(o.state)));
    assert.equal((await get(customer, "/v1/admin/analytics")).status, 403);
    assert.equal((await get(customer, "/v1/admin/orders")).status, 403);
    assert.equal((await get(restaurantOwner, "/v1/admin/payments")).status, 403);
    assert.equal((await get(admin, "/v1/admin/analytics", "GB")).status, 403, "no roles in GB");
  });

  test("role grants: nobody can give out more than they hold", async () => {
    // A country admin manages riders, but cannot create finance or super admins.
    const riderGrant = await grantVia(admin, { phone: "+243810000031", display_name: "Patrick M.", role: "RIDER", scope: { type: "ZONE", id: "gombe" } });
    assert.equal(riderGrant.status, 201, JSON.stringify(riderGrant.body));
    assert.equal((await grantVia(admin, { phone: "+243810000032", role: "COUNTRY_FINANCE", scope: { type: "COUNTRY", id: "CD" } })).status, 403);
    assert.equal((await grantVia(admin, { user_id: admin.userId, role: "SUPER_ADMIN", scope: { type: "GROUP" } })).status, 403);
    assert.equal((await grantVia(admin, { phone: "+243810000033", role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "GB" } })).body.code, "SCOPE_OTHER_MARKET");
    // A restaurant owner hires kitchen staff for their own branch only.
    const k = await grantVia(restaurantOwner, { phone: "+243810000034", role: "KITCHEN_STAFF", scope: { type: "BRANCH", id: branchId } });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    assert.equal((await grantVia(restaurantOwner, { phone: "+243810000035", role: "RIDER", scope: { type: "ZONE", id: "gombe" } })).status, 403);
    assert.equal((await grantVia(restaurantOwner, { phone: "+243810000034", role: "KITCHEN_STAFF", scope: { type: "BRANCH", id: branchId } })).body.code, "ALREADY_GRANTED");
    assert.equal((await grantVia(admin, { phone: "+243810000036", role: "KITCHEN_STAFF", scope: { type: "COUNTRY", id: "CD" } })).body.code, "BINDING_INVALID");
    // Their team view lists what they manage, not the people above them.
    const team = await get(restaurantOwner, "/v1/admin/team");
    // Owners manage branch staff and may add co-owners (they hold every right a co-owner gets); nobody above them is listed.
    assert.ok(team.body.data.every((b: { role: string }) => ["KITCHEN_STAFF", "BRANCH_MANAGER", "RESTAURANT_OWNER"].includes(b.role)));
    assert.ok(!team.body.data.some((b: { role: string }) => ["COUNTRY_ADMIN", "CITY_OPS", "SUPER_ADMIN", "RIDER"].includes(b.role)));
    assert.ok(team.body.data.some((b: { id: string }) => b.id === k.body.id));
    // The super admin creates a finance person, who then sees money.
    const f = await grantVia(sa, { phone: "+243810000037", display_name: "Grace (finance)", role: "COUNTRY_FINANCE", scope: { type: "COUNTRY", id: "CD" } });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    financeUser = await signIn("+243810000037");
    assert.equal(financeUser.userId, f.body.user_id, "the invited phone signs into the account created for it");
  });

  test("finance sees balanced ledgers and money charts", async () => {
    const me = await get(financeUser, "/v1/me");
    assert.equal(me.body.capabilities.finance, true);
    const l = await get(financeUser, "/v1/admin/ledger");
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const usd = l.body.balances.filter((b: { currency: string }) => b.currency === "USD").reduce((s: bigint, b: { balance_minor: string }) => s + BigInt(b.balance_minor), 0n);
    assert.equal(usd, 0n, "the market's books balance");
    assert.ok(l.body.journals.length >= 1);
    const a = await get(financeUser, "/v1/admin/analytics?days=7");
    assert.ok(a.body.finance.balances.some((b: { account: string }) => b.account === "service_charge_revenue"));
    assert.ok(a.body.finance.daily_credits.some((d: { account: string; amount_minor: string }) => d.account === "service_charge_revenue" && BigInt(d.amount_minor) > 0n));
    assert.equal((await get(admin, "/v1/admin/ledger")).status, 403);
  });

  test("revoking: only what you could grant, and never the last Super Admin; all audited", async () => {
    const team = await get(sa, "/v1/admin/team");
    const supers = team.body.data.filter((b: { role: string }) => b.role === "SUPER_ADMIN");
    assert.ok(supers.length >= 2);
    const mine = supers.find((b: { user: { id: string } }) => b.user.id === sa.userId);
    const others = supers.filter((b: { id: string }) => b.id !== mine.id);
    assert.equal((await call("DELETE", `/v1/admin/role-bindings/${mine.id}`, { token: admin.token, country: "CD" })).status, 403);
    for (const o of others) assert.equal((await call("DELETE", `/v1/admin/role-bindings/${o.id}`, { token: sa.token, country: "CD" })).status, 200);
    const last = await call("DELETE", `/v1/admin/role-bindings/${mine.id}`, { token: sa.token, country: "CD" });
    assert.equal(last.body.code, "LAST_SUPER_ADMIN");
    const log = await get(sa, "/v1/admin/audit?limit=50");
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.chain, { ok: true });
    assert.ok(log.body.data.some((e: { action: string }) => e.action === "role.granted"));
    assert.ok(log.body.data.some((e: { action: string }) => e.action === "role.revoked"));
    assert.equal((await get(admin, "/v1/admin/audit")).status, 403);
  });

  test("CORS: only the configured console origin may call the API from a browser", async () => {
    const pre = (origin: string) => api.inject({ method: "OPTIONS", url: "/v1/me", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization,x-country" } });
    const ok = await pre("https://console.tunakula.com");
    assert.equal(ok.headers["access-control-allow-origin"], "https://console.tunakula.com");
    const evil = await pre("https://evil.example");
    assert.equal(evil.headers["access-control-allow-origin"], undefined);
  });
});

describe("database invariants", () => {
  test("order events, ledger entries and attempts are append-only, even for the owner", async () => {
    assert.ok((await inspect("CD", "SELECT 1 FROM ordering.order_event")).length > 0);
    await assert.rejects(inspect("CD", "UPDATE ordering.order_event SET type = 'X'"), /append-only/);
    await assert.rejects(inspect("CD", "DELETE FROM money.ledger_entry"), /append-only/);
    await assert.rejects(inspect("CD", "DELETE FROM identity.audit_log"), /append-only/);
    // The app role does not even hold the privilege.
    await assert.rejects(db.tx({ country: "CD" }, (sql) => sql.query("DELETE FROM ordering.order_event")), /permission denied/);
  });

  test("an unbalanced journal cannot be committed", async () => {
    await db.tx({ country: "CD" }, async (sql) => {
      await assert.rejects(
        (async () => {
          await sql.query("SAVEPOINT s");
          const [j] = await sql.query<{ id: string }>("INSERT INTO money.journal (description, idempotency_key, posted_at) VALUES ('bad', $1, now()) RETURNING id", [randomUUID()]);
          await sql.query("INSERT INTO money.ledger_entry (journal_id, line, account, country_iso2, currency, amount_minor) VALUES ($1, 1, 'psp_clearing', 'CD', 'USD', 100)", [j?.id]);
          await sql.query("SET CONSTRAINTS ALL IMMEDIATE");
        })(),
        /balance/i,
      );
      await sql.query("ROLLBACK TO SAVEPOINT s");
    });
  });

  test("without a country context, the app role sees no tenant rows", async () => {
    const rows = await db.tx({}, (sql) => sql.query("SELECT 1 FROM ordering.order_view"));
    assert.equal(rows.length, 0);
    const cd = await db.tx({ country: "CD" }, (sql) => sql.query("SELECT 1 FROM ordering.order_view"));
    assert.ok(cd.length > 0);
  });

  test("webhook routing reveals only a country and is not directly readable", async () => {
    await assert.rejects(db.tx({}, (sql) => sql.query("SELECT * FROM payments.provider_ref_route")), /permission denied/);
    const [r] = await db.tx({}, (sql) => sql.query<{ c: string | null }>("SELECT payments.country_for_provider_ref('bitripay', 'nope') AS c"));
    assert.equal(r?.c, null);
  });

  test("REM-005: the audit chain verifies", async () => {
    const r = await db.tx({}, verifyAuditChain);
    assert.deepEqual(r, { ok: true });
  });
});

describe("distance in km and delivery time on every storefront", () => {
  test("nearby storefronts carry road distance, an ETA range and the delivery fee", async () => {
    const r = await call("GET", `/v1/branches/nearby?lat=${DROP.lat}&lng=${DROP.lng}`, { country: "CD" });
    assert.equal(r.status, 200);
    const b = r.body.data.find((x: { id: string }) => x.id === branchId);
    assert.ok(b, "the branch is listed");
    assert.match(b.distance_km, /^\d+\.\d$/);
    assert.ok(Number(b.distance_km) > 1 && Number(b.distance_km) < 3, `about 1.9 km by road, got ${b.distance_km}`);
    assert.equal(b.eta.high - b.eta.low, 10);
    assert.equal(b.eta.low % 5, 0);
    assert.ok(b.eta.minutes >= b.eta.low && b.eta.minutes < b.eta.high);
    assert.equal(b.eta.minutes, b.eta.pickup_minutes + b.eta.travel_minutes + 2);
    assert.equal(b.eta.basis, "estimate", "no map key and too few deliveries to learn from");
    assert.equal(b.delivery_fee.currency, "USD");
    assert.match(b.delivery_fee.amount_minor, /^\d+$/);
    assert.equal(r.body.routing, "straight-line-estimate");
  });

  test("the same estimate for one storefront; far-away storefronts are not listed", async () => {
    const one = await call("GET", `/v1/branches/${branchId}/eta?lat=${DROP.lat}&lng=${DROP.lng}`, { country: "CD" });
    assert.equal(one.status, 200);
    assert.equal(one.body.id, branchId);
    const far = await call("GET", "/v1/branches/nearby?lat=-11.66&lng=27.48&radius_km=10", { country: "CD" });
    assert.equal(far.body.data.length, 0, "Lubumbashi is 1,500 km away");
  });

  test("a missing or impossible position is refused", async () => {
    const r = await call("GET", "/v1/branches/nearby?lat=abc&lng=15.3", { country: "CD" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "LOCATION_INVALID");
    const r2 = await call("GET", "/v1/branches/nearby?lat=95&lng=15.3", { country: "CD" });
    assert.equal(r2.status, 400);
  });

  test("§9.5: the Kinshasa storefront does not exist from the GB market", async () => {
    const r = await call("GET", `/v1/branches/nearby?lat=${DROP.lat}&lng=${DROP.lng}`, { country: "GB" });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 0);
  });
});

describe("customer order history and tracking", () => {
  test("a customer sees their own orders, newest first, and nobody else's", async () => {
    const mine = await call("GET", "/v1/me/orders", { token: customer.token, country: "CD" });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.length > 0);
    const first = mine.body.data[0];
    assert.equal(first.branch.id, branchId);
    assert.match(first.total.amount_minor, /^\d+$/);
    const sorted = [...mine.body.data].sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at));
    assert.deepEqual(mine.body.data.map((o: { order_id: string }) => o.order_id), sorted.map((o: { order_id: string }) => o.order_id));
    const other = await call("GET", "/v1/me/orders", { token: kitchen.token, country: "CD" });
    assert.equal(other.body.data.length, 0);
    const anon = await call("GET", "/v1/me/orders", { country: "CD" });
    assert.equal(anon.status, 401);
  });

  test("an order carries its tracking timeline and where it comes from", async () => {
    const mine = await call("GET", "/v1/me/orders", { token: customer.token, country: "CD" });
    const delivered = mine.body.data.find((o: { state: string }) => o.state === "DELIVERED") ?? mine.body.data[0];
    const r = await call("GET", `/v1/orders/${delivered.order_id}`, { token: customer.token, country: "CD" });
    assert.equal(r.status, 200);
    assert.equal(r.body.timeline[0].state, "DRAFT");
    assert.equal(r.body.timeline.at(-1).state, r.body.state);
    assert.ok(r.body.timeline.every((t: { at: string }) => !Number.isNaN(Date.parse(t.at))));
    assert.equal(r.body.branch.id, branchId);
    assert.equal(typeof r.body.branch.lat, "number");
  });
});

describe("kitchen board", () => {
  test("kitchen staff see their branch's orders with lines, times and the next step; customers see nothing", async () => {
    const me = await call("GET", "/v1/me", { token: kitchen.token, country: "CD" });
    assert.equal(me.body.capabilities.kitchen, true);
    assert.equal(me.body.capabilities.overview, false, "kitchen staff have no order:read dashboard");
    const placed = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: placed.orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const r = await call("GET", "/v1/kitchen/orders", { token: kitchen.token, country: "CD" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.branches.map((b: { id: string }) => b.id), [branchId]);
    assert.equal(r.body.branches[0].can_pause, false);
    const o = r.body.orders.find((x: { order_id: string }) => x.order_id === placed.orderId);
    assert.ok(o, "the new order is on the board");
    assert.equal(o.state, "PLACED");
    assert.equal(o.ref.length, 5);
    assert.ok(o.lines.length > 0 && o.lines.every((l: { id: string; quantity: number }) => l.id && l.quantity > 0));
    assert.ok(o.times.PLACED);
    assert.ok(r.body.orders.every((x: { branch_id: string }) => x.branch_id === branchId));
    const anon = await call("GET", "/v1/kitchen/orders", { token: customer.token, country: "CD" });
    assert.equal(anon.status, 403);
    const other = await call("GET", `/v1/kitchen/orders?branch_id=${randomUUID()}`, { token: kitchen.token, country: "CD" });
    assert.equal(other.status, 403);
  });

  test("the owner pauses and resumes intake; a paused kitchen takes no new orders; kitchen staff cannot pause", async () => {
    const staff = await call("POST", `/v1/kitchen/branches/${branchId}/status`, { token: kitchen.token, country: "CD", body: { status: "PAUSED" } });
    assert.equal(staff.status, 403);
    const pause = await call("POST", `/v1/kitchen/branches/${branchId}/status`, { token: restaurantOwner.token, country: "CD", body: { status: "PAUSED", reason: "Out of charcoal" } });
    assert.equal(pause.status, 200);
    assert.equal(pause.body.status, "PAUSED");
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    assert.equal(q.status, 422);
    assert.equal(q.body.code, "BRANCH_CLOSED");
    const near = await call("GET", `/v1/branches/nearby?lat=${DROP.lat}&lng=${DROP.lng}`, { country: "CD" });
    assert.equal(near.body.data.find((b: { id: string }) => b.id === branchId).open, false);
    const resume = await call("POST", `/v1/kitchen/branches/${branchId}/status`, { token: restaurantOwner.token, country: "CD", body: { status: "OPEN" } });
    assert.equal(resume.body.status, "OPEN");
    assert.equal((await call("POST", "/v1/carts/quote", { country: "CD", body: cart() })).status, 200);
    const bad = await call("POST", `/v1/kitchen/branches/${branchId}/status`, { token: restaurantOwner.token, country: "CD", body: { status: "CLOSED_FOREVER" } });
    assert.equal(bad.status, 400);
  });
});
