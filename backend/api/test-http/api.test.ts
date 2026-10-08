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
import { TOKENS } from "../src/http/common.ts";
import { DispatchService, KITCHEN_TIMEOUT_MIN } from "../src/app/dispatch.ts";
import type { CommerceService } from "../src/app/commerce.ts";
import type { PaymentService } from "../src/app/payments.ts";
import { addBinding, verifyAuditChain, type NewBinding } from "../src/persistence/identity.ts";
import { loadVersions, saveVersions } from "../src/persistence/config.ts";
import { CountryConfigRegistry, GROUP_INTERNAL_BRAND, READINESS_AREAS, TUNAKULA_BRAND } from "../src/index.ts";
import { messagingSender } from "../src/app/channels.ts";
import { twilioMessaging } from "../src/modules/messaging/twilio.ts";
import type { HttpReply, HttpRequest } from "../src/modules/messaging/messaging.ts";
import type { NotificationService } from "../src/app/comms.ts";

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

  test("the owner edits a dish: category, veg, recommended and description persist", async () => {
    const body = { names: { fr: "Poulet à la moambe", en: "Chicken moambe" }, description: { fr: "Sauce aux noix de palme" }, prices: { USD: "12.50", CDF: "35000" }, category: "Cuisine Locale", veg: false, recommended: true, tags: ["signature"], allergens: ["peanuts"] };
    const up = await call("POST", `/v1/branches/${branchId}/items/${itemId}`, { token: restaurantOwner.token, country: "CD", body });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.category, "Cuisine Locale");
    assert.equal(up.body.recommended, true);
    assert.equal(up.body.veg, false);
    assert.equal(up.body.description.fr, "Sauce aux noix de palme");
    assert.deepEqual(up.body.prices.USD, { amount_minor: "1250", currency: "USD" }, "price unchanged");
    // A customer cannot edit the menu.
    assert.equal((await call("POST", `/v1/branches/${branchId}/items/${itemId}`, { token: customer.token, country: "CD", body: { names: { fr: "x" }, prices: { USD: "1.00" } } })).status, 403);
    // Editing a dish that is not there is 404.
    assert.equal((await call("POST", `/v1/branches/${branchId}/items/00000000-0000-0000-0000-000000000000`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "x" }, prices: { USD: "1.00" } } })).status, 404);
    // The menu reflects the edit.
    const menu = await call("GET", `/v1/branches/${branchId}/menu`, { country: "CD" });
    const moambe = menu.body.items.find((i: { id: string }) => i.id === itemId) as { category: string; recommended: boolean };
    assert.equal(moambe.category, "Cuisine Locale");
    assert.equal(moambe.recommended, true);
  });

  test("bulk import: adds new dishes, updates by id, and is all-or-nothing on errors", async () => {
    // A fresh owner and group keep this fully off the shared order/branch fixtures.
    const boss = await signIn("+243810000140");
    await grant({ userId: boss.userId, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: "rg-bulk" } });
    const bulk = (await call("POST", "/v1/branches", { token: admin.token, country: "CD", body: { name: "Bulk Kitchen", restaurant_group_id: "rg-bulk", city: "kinshasa", commune: "gombe", ...KINSHASA } })).body.id;
    const imp = (rows: unknown[], who = boss) => call("POST", `/v1/branches/${bulk}/menu/import`, { token: who.token, country: "CD", body: { rows } });

    const first = await imp([
      { names: { fr: "Fumbwa", en: "Fumbwa" }, prices: { USD: "7.00" }, category: "Cuisine Locale", veg: true, tags: ["signature"], allergens: ["peanuts"] },
      { names: { fr: "Jus de gingembre" }, prices: { USD: "2.00" }, category: "Boisson", available: false },
    ]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual([first.body.created, first.body.updated], [2, 0]);
    let menu = (await call("GET", `/v1/branches/${bulk}/menu`, { country: "CD" })).body.items;
    assert.equal(menu.length, 2);
    const jus = menu.find((i: { names: Record<string, string> }) => i.names.fr === "Jus de gingembre");
    assert.equal(jus.available, false, "available:false honoured on add");
    const fumbwa = menu.find((i: { names: Record<string, string> }) => i.names.fr === "Fumbwa");

    // Update by id: raise the price and category; add a brand-new row in the same import.
    const second = await imp([
      { id: fumbwa.id, names: { fr: "Fumbwa ya ngolo" }, prices: { USD: "8.00" }, category: "Cuisine Locale", veg: true, allergens: ["peanuts"], recommended: true },
      { names: { fr: "Chikwangue" }, prices: { USD: "1.50" }, category: "Accompagnements" },
    ]);
    assert.deepEqual([second.body.created, second.body.updated], [1, 1]);
    menu = (await call("GET", `/v1/branches/${bulk}/menu`, { country: "CD" })).body.items;
    assert.equal(menu.length, 3);
    const edited = menu.find((i: { id: string }) => i.id === fumbwa.id);
    assert.equal(edited.names.fr, "Fumbwa ya ngolo");
    assert.deepEqual(edited.prices.USD, { amount_minor: "800", currency: "USD" });
    assert.equal(edited.recommended, true);

    // A bad row rolls the whole import back: nothing is applied.
    const bad = await imp([
      { names: { fr: "Valide" }, prices: { USD: "3.00" } },
      { names: { fr: "Sans prix de règlement" }, prices: { CDF: "1000" } },
    ]);
    assert.equal(bad.status, 422);
    assert.equal(bad.body.code, "IMPORT_INVALID");
    assert.equal(bad.body.errors[0].row, 2);
    assert.equal((await call("GET", `/v1/branches/${bulk}/menu`, { country: "CD" })).body.items.length, 3, "nothing from the failed import");

    // A customer cannot bulk-import.
    assert.equal((await imp([{ names: { fr: "x" }, prices: { USD: "1.00" } }], customer)).status, 403);
  });

  test("variations and add-ons are priced into the quote and the order line", async () => {
    const chef = await signIn("+243810000150");
    await grant({ userId: chef.userId, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: "rg-opts" } });
    const br = (await call("POST", "/v1/branches", { token: admin.token, country: "CD", body: { name: "Pizza Opts", restaurant_group_id: "rg-opts", city: "kinshasa", commune: "gombe", ...KINSHASA } })).body.id;
    const add = await call("POST", `/v1/branches/${br}/items`, { token: chef.token, country: "CD", body: {
      names: { fr: "Pizza" }, prices: { USD: "10.00" },
      variations: [{ name: "Taille", type: "SINGLE", required: true, options: [{ name: "Moyenne", price: "0" }, { name: "Grande", price: "3.00" }] }],
      addons: [{ name: "Fromage", price: "1.50" }, { name: "Piment", price: "0.50" }],
    } });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const dish = add.body.id;
    const size = add.body.variations[0];
    const grande = size.options.find((o: { name: string }) => o.name === "Grande").id;
    const fromage = add.body.addons.find((a: { name: string }) => a.name === "Fromage").id;
    assert.equal(size.options[0].price, "0"); // Moyenne is free (minor units, USD)
    assert.equal(add.body.addons.find((a: { name: string }) => a.name === "Fromage").price, "150");

    // Grande (+3.00) + Fromage (+1.50) on a 10.00 pizza = 14.50 the unit; service charge is 10% of goods.
    const line = { item_id: dish, quantity: 1, options: [{ group: size.id, choices: [grande] }], addons: [fromage] };
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: br, items: [line], order_type: "TAKEAWAY" } });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.lines[0].unit.amount_minor, "1450");
    assert.deepEqual(q.body.lines[0].options, ["Taille: Grande", "+ Fromage"]);
    assert.equal(q.body.price_lines.find((l: { code: string }) => l.code === "GOODS").amount.amount_minor, "1450");
    assert.equal(q.body.price_lines.find((l: { code: string }) => l.code === "SERVICE_CHARGE").amount.amount_minor, "145");

    // A required variation left out is refused; an unknown choice is refused.
    const missing = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: br, items: [{ item_id: dish, quantity: 1, addons: [fromage] }], order_type: "TAKEAWAY" } });
    assert.equal(missing.body.code, "OPTION_REQUIRED");
    const bogus = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: br, items: [{ item_id: dish, quantity: 1, options: [{ group: size.id, choices: ["nope"] }] }], order_type: "TAKEAWAY" } });
    assert.equal(bogus.body.code, "UNKNOWN_OPTION");

    // Placing the order carries the chosen options onto the line and into the total.
    const placed = await call("POST", "/v1/orders", { token: chef.token, country: "CD", body: { branch_id: br, items: [line], order_type: "TAKEAWAY", payment_mode: "PREPAID", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const view = await call("GET", `/v1/orders/${placed.body.order_id}`, { token: chef.token, country: "CD" });
    assert.deepEqual(view.body.lines[0].options, ["Taille: Grande", "+ Fromage"]);
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

describe("dispatch and the rider app", () => {
  const dispatcher = () => api.get<DispatchService>(TOKENS.dispatch);
  const placePaid = async () => {
    const p = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: p.orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    return p;
  };

  test("only riders go online, and only with a position", async () => {
    const notRider = await call("POST", "/v1/rider/presence", { token: customer.token, country: "CD", body: { online: true, lat: KINSHASA.lat, lng: KINSHASA.lng } });
    assert.equal(notRider.status, 403);
    const noPos = await call("POST", "/v1/rider/presence", { token: rider.token, country: "CD", body: { online: true } });
    assert.equal(noPos.status, 400);
    assert.equal(noPos.body.code, "LOCATION_REQUIRED");
    const on = await call("POST", "/v1/rider/presence", { token: rider.token, country: "CD", body: { online: true, lat: KINSHASA.lat, lng: KINSHASA.lng } });
    assert.equal(on.status, 200);
    assert.equal(on.body.online, true);
    assert.ok(on.body.online_since);
  });

  test("an order that needs a rider is offered to the nearest free rider, with distance and earnings up front", async () => {
    // Earlier tests left orders waiting; settle them so this rider is free.
    await db.tx({ country: "CD" }, (sql) => sql.query("UPDATE dispatch.offer SET status = 'WITHDRAWN' WHERE status = 'OFFERED'"));
    const p = await placePaid();
    let offer: any = null;
    for (let i = 0; i < 12 && offer?.job?.order_id !== p.orderId; i++) {
      await dispatcher().tick("CD");
      offer = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.offer;
      if (offer && offer.job.order_id !== p.orderId) await call("POST", `/v1/rider/offers/${offer.id}/decline`, { token: rider.token, country: "CD", body: { reason: "test" } });
    }
    assert.equal(offer?.job.order_id, p.orderId, "the new order is offered");
    assert.ok(offer.seconds_left > 0 && offer.seconds_left <= 30);
    assert.match(offer.pickup_km, /^\d+\.\d$/);
    assert.ok(Number(offer.drop_km) > 0);
    assert.ok(BigInt(offer.earnings.amount_minor) > 0n, "the rider sees what they will earn");
    assert.equal(offer.job.pickup.branch_id, branchId);
    assert.ok(offer.job.drop.lat);
    // The kitchen cannot accept a RIDER_FIRST order before a rider is secured.
    const early = await transition(kitchen, p.orderId, { type: "ACCEPT" });
    assert.equal(early.body.code, "RIDER_FIRST");

    const someoneElse = await call("POST", `/v1/rider/offers/${offer.id}/accept`, { token: customer.token, country: "CD" });
    assert.equal(someoneElse.status, 404, "an offer belongs to one rider");
    const ok = await call("POST", `/v1/rider/offers/${offer.id}/accept`, { token: rider.token, country: "CD" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, "ACCEPTED");
    const again = await call("POST", `/v1/rider/offers/${offer.id}/accept`, { token: rider.token, country: "CD" });
    assert.equal(again.body.code, "OFFER_CLOSED");
    const jobs = await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" });
    assert.ok(jobs.body.active.some((j: { order_id: string }) => j.order_id === p.orderId));
    assert.equal(jobs.body.offer, null, "a busy rider gets no new offer");
    assert.equal((await transition(kitchen, p.orderId, { type: "ACCEPT" })).status, 200, "now the kitchen can accept");

    // The customer sees who is coming and, once picked up, how far away they are.
    const view = await call("GET", `/v1/orders/${p.orderId}`, { token: customer.token, country: "CD" });
    assert.ok(view.body.rider.name);
    assert.ok(view.body.rider.position, "the rider's position is shared while the order is with them");
  });

  test("declined and expired offers move on; nobody is asked twice; going offline withdraws the offer", async () => {
    // Free the rider by finishing their job the quick way (ops reassigns elsewhere is out of scope here).
    const busy = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.active;
    for (const j of busy) await transition(ops, j.order_id, { type: "CANCEL", reasonCode: "TEST_CLEANUP" });
    const p = await placePaid();
    let offer: any = null;
    for (let i = 0; i < 12 && offer?.job?.order_id !== p.orderId; i++) {
      await dispatcher().tick("CD");
      offer = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.offer;
      if (offer && offer.job.order_id !== p.orderId) await call("POST", `/v1/rider/offers/${offer.id}/decline`, { token: rider.token, country: "CD" });
    }
    assert.equal(offer?.job.order_id, p.orderId);
    const no = await call("POST", `/v1/rider/offers/${offer.id}/decline`, { token: rider.token, country: "CD", body: { reason: "Too far" } });
    assert.equal(no.body.status, "DECLINED");
    await dispatcher().tick("CD");
    const after = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.offer;
    assert.notEqual(after?.job.order_id, p.orderId, "a rider who said no is not asked again for the same order");

    // Expiry: an offer past its time is closed by the next pass.
    const p2 = await placePaid();
    let o2: any = null;
    for (let i = 0; i < 12 && o2?.job?.order_id !== p2.orderId; i++) {
      await dispatcher().tick("CD");
      o2 = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.offer;
      if (o2 && o2.job.order_id !== p2.orderId) await call("POST", `/v1/rider/offers/${o2.id}/decline`, { token: rider.token, country: "CD" });
    }
    await db.tx({ country: "CD" }, (sql) => sql.query("UPDATE dispatch.offer SET expires_at = now() - interval '1 second' WHERE id = $1", [o2.id]));
    const late = await call("POST", `/v1/rider/offers/${o2.id}/accept`, { token: rider.token, country: "CD" });
    assert.equal(late.body.code, "OFFER_EXPIRED");

    // Offline: the rider gets nothing, and any open offer is withdrawn.
    await call("POST", "/v1/rider/presence", { token: rider.token, country: "CD", body: { online: false } });
    await dispatcher().tick("CD");
    assert.equal((await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.offer, null);
    const jobs = await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" });
    assert.equal(jobs.body.presence.online, false);
    assert.match(jobs.body.today.earnings.amount_minor, /^\d+$/);
    assert.match(jobs.body.cash_in_hand.amount_minor, /^\d+$/);
  });

  test("an order no kitchen answers in time is cancelled for the customer", async () => {
    const p = await placePaid();
    const later = new DispatchService(db, api.get<CommerceService>(TOKENS.commerce), () => new Date(Date.now() + (KITCHEN_TIMEOUT_MIN + 1) * 60_000));
    const r = await later.tick("CD");
    assert.ok(r.cancelled >= 1);
    const v = await call("GET", `/v1/orders/${p.orderId}`, { token: customer.token, country: "CD" });
    assert.equal(v.body.state, "CANCELLED");
  });
});

describe("operations: dispatch board, reassigning, cash hand-ins, automatic refunds", () => {
  const payments = () => api.get<PaymentService>(TOKENS.payments);

  test("a paid order cancelled before delivery is refunded automatically, once", async () => {
    const p = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: p.orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const cancel = await transition(customer, p.orderId, { type: "CANCEL", reasonCode: "CHANGED_MIND" });
    assert.equal(cancel.status, 200);
    const first = await payments().refundSweep("CD");
    assert.ok(first.refunded >= 1);
    const v = await call("GET", `/v1/orders/${p.orderId}`, { token: customer.token, country: "CD" });
    assert.equal(v.body.state, "REFUNDED");
    const [r] = await inspect("CD", "SELECT status, amount_minor::text, reason_code, refund_ref FROM payments.refund WHERE order_id = $1", [p.orderId]);
    assert.equal(r.status, "SUCCEEDED");
    assert.equal(r.amount_minor, p.total.amount_minor);
    assert.ok(r.refund_ref);
    const again = await payments().refundSweep("CD");
    assert.equal(again.refunded, 0, "never refunded twice");
  });

  test("the dispatch board is for operations; it lists riders and orders", async () => {
    const no = await call("GET", "/v1/ops/dispatch", { token: customer.token, country: "CD" });
    assert.equal(no.status, 403);
    const me = await call("GET", "/v1/me", { token: ops.token, country: "CD" });
    assert.equal(me.body.capabilities.dispatch, true);
    assert.equal(me.body.capabilities.riders, true);
    const b = await call("GET", "/v1/ops/dispatch", { token: ops.token, country: "CD" });
    assert.equal(b.status, 200);
    const r = b.body.riders.find((x: { id: string }) => x.id === rider.userId);
    assert.ok(r, "the rider is on the board");
    assert.ok(["AVAILABLE", "OFFLINE", "BUSY", "OFFERED", "SIGNAL_LOST"].includes(r.status));
    assert.match(r.cash_in_hand.amount_minor, /^-?\d+$/);
  });

  test("ops assigns a cash order to a rider; after delivery the rider holds the cash until it is handed in", async () => {
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order_id as string;
    const before = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.cash_in_hand.amount_minor;

    const notOps = await call("POST", `/v1/ops/orders/${orderId}/assign`, { token: kitchen.token, country: "CD", body: { rider_id: rider.userId } });
    assert.equal(notOps.status, 403);
    const notRider = await call("POST", `/v1/ops/orders/${orderId}/assign`, { token: ops.token, country: "CD", body: { rider_id: customer.userId } });
    assert.equal(notRider.body.code, "NOT_A_RIDER");
    const a = await call("POST", `/v1/ops/orders/${orderId}/assign`, { token: ops.token, country: "CD", body: { rider_id: rider.userId } });
    assert.equal(a.status, 200, JSON.stringify(a.body));

    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    const board = await call("GET", "/v1/kitchen/orders", { token: kitchen.token, country: "CD" });
    const lines = board.body.orders.find((o: { order_id: string }) => o.order_id === orderId).lines.map((l: { id: string }) => l.id);
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: lines, packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "L-CASH-1", sealId: "S-CASH-1" }], packPhotoRef: "sha256:test" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["L-CASH-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "L-CASH-1", location: DROP, verification: { method: "CODE", code: placed.body.recipient_code }, sealIntact: true });
    assert.equal(done.status, 200, JSON.stringify(done.body));

    const held = (await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.cash_in_hand.amount_minor;
    assert.equal(BigInt(held) - BigInt(before), BigInt(q.body.total.amount_minor), "the cash collected at the door is in hand");

    const tooMuch = await call("POST", `/v1/ops/riders/${rider.userId}/cash-in`, { token: ops.token, country: "CD", body: { amount_minor: (BigInt(held) + 1n).toString() } });
    assert.equal(tooMuch.body.code, "MORE_THAN_HELD");
    const bad = await call("POST", `/v1/ops/riders/${rider.userId}/cash-in`, { token: ops.token, country: "CD", body: { amount_minor: "-5" } });
    assert.equal(bad.status, 400);
    const ok = await call("POST", `/v1/ops/riders/${rider.userId}/cash-in`, { token: ops.token, country: "CD", body: { amount_minor: held, note: "Gombe hub" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.cash_in_hand.amount_minor, "0");
    assert.equal((await call("GET", "/v1/rider/jobs", { token: rider.token, country: "CD" })).body.cash_in_hand.amount_minor, "0");
    const [hub] = await inspect("CD", "SELECT sum(amount_minor)::text AS s FROM money.ledger_entry WHERE account = 'hub_cash'");
    assert.ok(BigInt(hub.s) >= BigInt(held), "the hand-in is in the books");
    const [bal] = await inspect("CD", "SELECT currency, sum(amount_minor)::text AS s FROM money.ledger_entry GROUP BY currency");
    assert.equal(bal.s, "0", "the ledger still balances");
  });
});

describe("rider self-registration with ID checks", () => {
  // Tiny but real image headers: the API checks magic bytes, not just the declared type.
  const jpeg = (seed: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, seed), Buffer.from([0xff, 0xd9])]).toString("base64");
  const upload = (who: { token: string }, purpose: string, seed: number) =>
    call("POST", "/v1/media", { token: who.token, country: "CD", body: { purpose, content_type: "image/jpeg", data_base64: jpeg(seed) } });
  let applicant: { token: string; userId: string };
  let appId: string;

  test("photos are checked for what they really are and stay private", async () => {
    applicant = await signIn("+243810000090");
    const fake = await call("POST", "/v1/media", { token: applicant.token, country: "CD", body: { purpose: "RIDER_ID", content_type: "image/jpeg", data_base64: Buffer.from("not an image").toString("base64") } });
    assert.equal(fake.body.code, "IMAGE_MISMATCH");
    const up = await upload(applicant, "RIDER_ID", 1);
    assert.equal(up.status, 201);
    assert.equal(up.body.sha256.length, 64);
    assert.equal((await call("GET", `/v1/media/${up.body.id}`, { token: applicant.token, country: "CD" })).status, 200);
    assert.equal((await call("GET", `/v1/media/${up.body.id}`, { token: customer.token, country: "CD" })).status, 404, "nobody else can open it");
    assert.equal((await call("GET", `/v1/media/${up.body.id}`, { token: ops.token, country: "CD" })).status, 200, "rider reviewers can");
  });

  test("automatic checks: age, ID format, distinct photos, licence for motorbikes", async () => {
    const id = (await upload(applicant, "RIDER_ID", 2)).body.id;
    const selfie = (await upload(applicant, "RIDER_SELFIE", 3)).body.id;
    const base = { full_name: "Jonas Kabeya", date_of_birth: "1996-04-12", zones: ["gombe"], vehicle: "BICYCLE", id_type: "VOTER_CARD", id_number: "1234 5678 90", id_photo: id, selfie };
    const young = await call("POST", "/v1/rider-applications", { token: applicant.token, country: "CD", body: { ...base, date_of_birth: "2012-01-01" } });
    assert.equal(young.body.code, "CHECKS_FAILED");
    const badId = await call("POST", "/v1/rider-applications", { token: applicant.token, country: "CD", body: { ...base, id_number: "AB" } });
    assert.equal(badId.body.code, "CHECKS_FAILED");
    const moto = await call("POST", "/v1/rider-applications", { token: applicant.token, country: "CD", body: { ...base, vehicle: "MOTO" } });
    assert.equal(moto.body.code, "CHECKS_FAILED", "a motorbike needs a licence photo and plate");
    const notMine = await call("POST", "/v1/rider-applications", { token: customer.token, country: "CD", body: base });
    assert.equal(notMine.body.code, "PHOTO_INVALID", "you cannot apply with someone else's documents");
    const zone = await call("POST", "/v1/rider-applications", { token: applicant.token, country: "CD", body: { ...base, zones: ["paris"] } });
    assert.equal(zone.body.code, "ZONES_INVALID");
    const ok = await call("POST", "/v1/rider-applications", { token: applicant.token, country: "CD", body: base });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, "PENDING");
    assert.ok(ok.body.checks.every((c: { ok: boolean }) => c.ok));
    appId = ok.body.id;
    const twice = await call("POST", "/v1/rider-applications", { token: applicant.token, country: "CD", body: base });
    assert.equal(twice.body.code, "APPLICATION_OPEN");
    const presence = await call("POST", "/v1/rider/presence", { token: applicant.token, country: "CD", body: { online: true, lat: KINSHASA.lat, lng: KINSHASA.lng } });
    assert.equal(presence.status, 403, "not a rider until approved");
  });

  test("the same ID on a second person is flagged for a human, who must give a reason to approve", async () => {
    const other = await signIn("+243810000091");
    const id = (await call("POST", "/v1/media", { token: other.token, country: "CD", body: { purpose: "RIDER_ID", content_type: "image/jpeg", data_base64: jpeg(7) } })).body.id;
    const selfie = (await call("POST", "/v1/media", { token: other.token, country: "CD", body: { purpose: "RIDER_SELFIE", content_type: "image/jpeg", data_base64: jpeg(8) } })).body.id;
    const r = await call("POST", "/v1/rider-applications", { token: other.token, country: "CD", body: { full_name: "Paul Mbala", date_of_birth: "1990-02-02", zones: ["gombe"], vehicle: "FOOT", id_type: "VOTER_CARD", id_number: "1234567890", id_photo: id, selfie } });
    assert.equal(r.status, 201);
    assert.equal(r.body.checks.find((c: { code: string }) => c.code === "DUPLICATE_ID").ok, false);
    const noNote = await call("POST", `/v1/ops/rider-applications/${r.body.id}/approve`, { token: ops.token, country: "CD", body: {} });
    assert.equal(noNote.body.code, "NOTE_REQUIRED");
    const noReason = await call("POST", `/v1/ops/rider-applications/${r.body.id}/reject`, { token: ops.token, country: "CD", body: {} });
    assert.equal(noReason.body.code, "REASON_REQUIRED");
    const rej = await call("POST", `/v1/ops/rider-applications/${r.body.id}/reject`, { token: ops.token, country: "CD", body: { note: "This voter card belongs to another applicant" } });
    assert.equal(rej.body.status, "REJECTED");
    const mine = await call("GET", "/v1/rider-applications/mine", { token: other.token, country: "CD" });
    assert.equal(mine.body.data[0].decision_note, "This voter card belongs to another applicant");
  });

  test("approval makes the applicant a rider in the chosen communes; only reviewers decide", async () => {
    const list = await call("GET", "/v1/ops/rider-applications", { token: ops.token, country: "CD" });
    assert.ok(list.body.data.some((a: { id: string }) => a.id === appId));
    assert.equal((await call("GET", "/v1/ops/rider-applications", { token: customer.token, country: "CD" })).status, 403);
    assert.equal((await call("POST", `/v1/ops/rider-applications/${appId}/approve`, { token: kitchen.token, country: "CD", body: {} })).status, 403);
    const ok = await call("POST", `/v1/ops/rider-applications/${appId}/approve`, { token: ops.token, country: "CD", body: {} });
    assert.equal(ok.body.status, "APPROVED");
    const again = await call("POST", `/v1/ops/rider-applications/${appId}/approve`, { token: ops.token, country: "CD", body: {} });
    assert.equal(again.body.code, "ALREADY_DECIDED");
    const online = await call("POST", "/v1/rider/presence", { token: applicant.token, country: "CD", body: { online: true, lat: KINSHASA.lat, lng: KINSHASA.lng } });
    assert.equal(online.status, 200, "the new rider can go online");
    assert.equal((await call("GET", "/v1/rider-applications/mine", { token: applicant.token, country: "CD" })).body.is_rider, true);
  });
});

describe("communication dispatch engine and delivery log", () => {
  const jpeg = (seed: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, seed), Buffer.from([0xff, 0xd9])]).toString("base64");

  test("admin fires a test event to self; it logs per channel and lands in the inbox", async () => {
    const before = (await call("GET", "/v1/notifications", { token: admin.token, country: "CD" })).body.unread;
    const r = await call("POST", "/v1/comms/test", { token: admin.token, country: "CD", body: { event_key: "order.delivered", data: { order: "A-1001" } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.event, "order.delivered");
    const channels = Object.fromEntries(r.body.deliveries.map((d: { channel: string; status: string }) => [d.channel, d.status]));
    assert.equal(channels.inapp, "logged");
    assert.equal(channels.push, "logged");
    assert.equal(channels.whatsapp, "logged");
    // In-app delivery shows up in the inbox (unread) and in the delivery log.
    const inbox = await call("GET", "/v1/notifications", { token: admin.token, country: "CD" });
    assert.equal(inbox.body.unread, before + 1);
    assert.ok(inbox.body.data.some((n: { event_key: string; subject: string }) => n.event_key === "order.delivered" && n.subject.includes("A-1001")));
    const log = await call("GET", "/v1/comms/deliveries", { token: admin.token, country: "CD" });
    assert.ok(log.body.data.some((d: { event_key: string; channel: string }) => d.event_key === "order.delivered" && d.channel === "inapp"));
    const unknown = await call("POST", "/v1/comms/test", { token: admin.token, country: "CD", body: { event_key: "no.such_event" } });
    assert.equal(unknown.body.code, "UNKNOWN_EVENT");
  });

  test("the delivery log and self-test need platform-config authority", async () => {
    assert.equal((await call("GET", "/v1/comms/deliveries", { token: ops.token, country: "CD" })).status, 403);
    assert.equal((await call("POST", "/v1/comms/test", { token: ops.token, country: "CD", body: { event_key: "order.delivered" } })).status, 403);
    assert.equal((await call("GET", "/v1/comms/deliveries", { token: customer.token, country: "CD" })).status, 403);
  });

  test("opt-outs suppress a normal event's channels but a mandatory notice ignores them", async () => {
    assert.equal((await call("POST", "/v1/notifications/preferences", { token: customer.token, country: "CD", body: { channel: "email", enabled: false } })).status, 200);
    const prefs = await call("GET", "/v1/notifications/preferences", { token: customer.token, country: "CD" });
    assert.equal(prefs.body.channels.email, false);
    assert.equal(prefs.body.channels.inapp, true);
    // You cannot turn off in-app.
    assert.equal((await call("POST", "/v1/notifications/preferences", { token: customer.token, country: "CD", body: { channel: "inapp", enabled: false } })).body.code, "INAPP_REQUIRED");

    // Dispatch directly via the service so we can target the opted-out customer.
    const comms = api.get(TOKENS.comms) as import("../src/app/comms.ts").NotificationService;
    const normal = await comms.dispatch({ country: "CD", eventKey: "payment.successful", recipientUserId: customer.userId, data: { amount: "10 000 FC" } });
    const normalByChannel = Object.fromEntries(normal.deliveries.map((d) => [d.channel, d.status]));
    assert.equal(normalByChannel.email, "suppressed", "opted-out email is suppressed on a normal event");
    assert.equal(normalByChannel.inapp, "logged");

    const mandatory = await comms.dispatch({ country: "CD", eventKey: "payment.failed", recipientUserId: customer.userId });
    const mandByChannel = Object.fromEntries(mandatory.deliveries.map((d) => [d.channel, d.status]));
    assert.equal(mandByChannel.email, "logged", "a mandatory notice reaches email despite the opt-out");
    assert.equal(mandByChannel.sms, "logged");
  });

  test("marking an inbox item read lowers the unread count", async () => {
    await call("POST", "/v1/comms/test", { token: admin.token, country: "CD", body: { event_key: "ops.kpi_alert", data: { item: "Delivered rate" } } });
    const inbox = await call("GET", "/v1/notifications", { token: admin.token, country: "CD", headers: {} });
    const unread = inbox.body.unread as number;
    const first = inbox.body.data[0] as { id: string };
    const read = await call("POST", `/v1/notifications/${first.id}/read`, { token: admin.token, country: "CD" });
    assert.equal(read.body.read, true);
    assert.equal((await call("GET", "/v1/notifications?unread=1", { token: admin.token, country: "CD" })).body.unread, unread - 1);
  });

  test("approving a rider notifies the applicant, once (idempotent)", async () => {
    const who = await signIn("+243810000120");
    const idPhoto = (await call("POST", "/v1/media", { token: who.token, country: "CD", body: { purpose: "RIDER_ID", content_type: "image/jpeg", data_base64: jpeg(31) } })).body.id;
    const selfie = (await call("POST", "/v1/media", { token: who.token, country: "CD", body: { purpose: "RIDER_SELFIE", content_type: "image/jpeg", data_base64: jpeg(32) } })).body.id;
    const app = await call("POST", "/v1/rider-applications", { token: who.token, country: "CD", body: { full_name: "Esther Nsimba", date_of_birth: "1994-09-09", zones: ["gombe"], vehicle: "FOOT", id_type: "VOTER_CARD", id_number: "5566 7788 99", id_photo: idPhoto, selfie } });
    assert.equal(app.status, 201, JSON.stringify(app.body));
    const ok = await call("POST", `/v1/ops/rider-applications/${app.body.id}/approve`, { token: admin.token, country: "CD", body: {} });
    assert.equal(ok.body.status, "APPROVED");
    const inbox = await call("GET", "/v1/notifications", { token: who.token, country: "CD" });
    const approvals = inbox.body.data.filter((n: { event_key: string }) => n.event_key === "rider.approved");
    assert.equal(approvals.length, 1, "notified exactly once");
    assert.ok(approvals[0].subject.toLowerCase().includes("livreur"));
  });
});

describe("real SMS/WhatsApp channel adapter", () => {
  test("the engine sends WhatsApp through the messaging provider and records the message id", async () => {
    const calls: HttpRequest[] = [];
    const transport = async (req: HttpRequest): Promise<HttpReply> => { calls.push(req); return { status: 201, body: JSON.stringify({ sid: "SM-LIVE-1" }) }; };
    const reg = new CountryConfigRegistry({
      brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
      connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
      apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
    });
    reg.restore(await db.tx({}, loadVersions));
    const messaging = twilioMessaging({ accountSid: "ACtest", authToken: "tok", smsFrom: "+10000000000", whatsappFrom: "+14155238886", send: transport });
    const app2 = await createApi({ db, registry: reg, connectors: [primary, fallback], tokenSecret: "test-secret-test-secret-test-secret!!", otp, senders: messagingSender(messaging), onError: () => undefined });
    try {
      const comms = app2.get(TOKENS.comms) as NotificationService;
      // order.delivered → inapp (logged) + push (logged) + whatsapp (sent via the provider)
      const r = await comms.dispatch({ country: "CD", eventKey: "order.delivered", recipientUserId: customer.userId, data: { order: "Z-1" } });
      const byChannel = Object.fromEntries(r.deliveries.map((d) => [d.channel, d.status]));
      assert.equal(byChannel.whatsapp, "sent", JSON.stringify(r.deliveries));
      assert.equal(byChannel.inapp, "logged");
      assert.equal(calls.length, 1, "exactly one provider call for the one messaging channel");
      const form = new URLSearchParams(calls[0]!.body);
      assert.equal(form.get("To"), "whatsapp:+243810000001", "addressed to the recipient's phone");
      assert.equal(form.get("From"), "whatsapp:+14155238886");
      assert.ok((form.get("Body") ?? "").includes("Z-1"), "subject rendered with the order token");
      // The delivery log keeps the provider's status.
      const log = await db.tx({ country: "CD" }, (sql) => sql.query<{ status: string; provider_ref: string | null }>("SELECT status, provider_ref FROM comms.delivery WHERE event_key = 'order.delivered' AND channel = 'whatsapp' AND recipient_user_id = $1 ORDER BY created_at DESC LIMIT 1", [customer.userId]));
      assert.equal(log[0]!.status, "sent");
      assert.equal(log[0]!.provider_ref, "SM-LIVE-1");
    } finally {
      await app2.close();
    }
  });

  test("a provider rejection is recorded as a failed delivery, not a crash", async () => {
    const transport = async (): Promise<HttpReply> => ({ status: 400, body: JSON.stringify({ message: "number is not WhatsApp-enabled", code: 63013 }) });
    const reg = new CountryConfigRegistry({
      brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
      connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
      apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
    });
    reg.restore(await db.tx({}, loadVersions));
    const messaging = twilioMessaging({ accountSid: "ACtest", authToken: "tok", whatsappFrom: "+14155238886", send: transport });
    const app2 = await createApi({ db, registry: reg, connectors: [primary, fallback], tokenSecret: "test-secret-test-secret-test-secret!!", otp, senders: messagingSender(messaging), onError: () => undefined });
    try {
      const comms = app2.get(TOKENS.comms) as NotificationService;
      const r = await comms.dispatch({ country: "CD", eventKey: "order.picked_up", recipientUserId: customer.userId, data: { rider: "Benjamin" } });
      assert.equal(Object.fromEntries(r.deliveries.map((d) => [d.channel, d.status])).whatsapp, "failed");
    } finally {
      await app2.close();
    }
  });
});

describe("order lifecycle fires customer notifications", () => {
  test("placing and moving an order notifies the customer at each step", async () => {
    const diner = await signIn("+243810000130");
    await backdate(diner.userId, 60); // COD needs an account older than the floor
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const placed = await call("POST", "/v1/orders", { token: diner.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total } });
    assert.equal(placed.body.state, "PLACED", JSON.stringify(placed.body));
    const orderId = placed.body.order_id as string;
    const code = placed.body.recipient_code as string;

    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    assert.equal((await transition(kitchen, orderId, { type: "ACCEPT" })).body.state, "ACCEPTED");
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "L-1", sealId: "S-1" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["L-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    assert.equal((await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "L-1", location: DROP, sealIntact: true, verification: { method: "CODE", code } })).body.state, "DELIVERED");

    const inbox = await call("GET", "/v1/notifications?limit=100", { token: diner.token, country: "CD" });
    const seen = new Set<string>(inbox.body.data.map((n: { event_key: string }) => n.event_key));
    for (const e of ["order.placed", "order.accepted", "order.preparing", "order.ready", "order.picked_up", "order.delivered"]) {
      assert.ok(seen.has(e), `customer was not notified of ${e}`);
    }
    const delivered = inbox.body.data.find((n: { event_key: string }) => n.event_key === "order.delivered") as { subject: string };
    assert.ok(delivered.subject.includes(`#${orderId.slice(0, 8)}`), "the notification names the order");
    // The pickup notification names the rider.
    const pickedUp = inbox.body.data.find((n: { event_key: string }) => n.event_key === "order.picked_up") as { subject: string };
    assert.ok(pickedUp.subject.length > 0);

    // Each step notified exactly once (deduped), even if a transition is retried.
    const placedCount = inbox.body.data.filter((n: { event_key: string }) => n.event_key === "order.placed").length;
    assert.equal(placedCount, 1);
  });
});
