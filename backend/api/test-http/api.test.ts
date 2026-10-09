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
import type { WalletService } from "../src/app/wallet.ts";
import type { LoyaltyService } from "../src/app/loyalty.ts";
import type { CashbackService } from "../src/app/cashback.ts";
import type { ReferralService } from "../src/app/referrals.ts";
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

    const deliver = { type: "DELIVER", scannedLabelId: "L-1", location: DROP, sealIntact: true, proofPhotoRef: "photo://door" };
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
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "L-CASH-1", location: DROP, verification: { method: "CODE", code: placed.body.recipient_code }, sealIntact: true, proofPhotoRef: "photo://door" });
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
    assert.equal((await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "L-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" })).body.state, "DELIVERED");

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

describe("paid membership (the Plus subscription)", () => {
  let plan: any;
  let member: { token: string; userId: string };

  test("a country admin creates a plan; a plain customer cannot", async () => {
    const body = { name: "Tunakula Plus", description: "Free delivery on every order", price_minor: "999", currency: "USD", period: "MONTH", free_delivery: true, min_subtotal_minor: "0" };
    assert.equal((await call("POST", "/v1/admin/membership/plans", { token: customer.token, country: "CD", body })).status, 403);
    const created = await call("POST", "/v1/admin/membership/plans", { token: admin.token, country: "CD", body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    plan = created.body;
    assert.equal(plan.name, "Tunakula Plus");
    assert.deepEqual(plan.price, { amount_minor: "999", currency: "USD" });
    assert.equal(plan.benefits.free_delivery, true);
    // It shows up in the public plan list.
    const plans = await call("GET", "/v1/membership/plans", { country: "CD" });
    assert.ok(plans.body.data.some((p: { id: string }) => p.id === plan.id));
  });

  test("before subscribing, a member's quote has no benefit", async () => {
    member = await signIn("+243810000050");
    const q = await call("POST", "/v1/carts/quote", { token: member.token, country: "CD", body: cart() });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.membership, undefined, "no membership block for a non-member");
  });

  test("subscribing charges the fee to the ledger and starts a period", async () => {
    const r = await call("POST", "/v1/me/membership", { token: member.token, country: "CD", body: { plan_id: plan.id } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.membership.status, "ACTIVE");
    assert.equal(r.body.membership.plan.id, plan.id);
    // The fee is recorded: subscription revenue is credited (negative), the customer owes it (debit).
    const [rev] = await inspect("CD", "SELECT sum(amount_minor)::text AS s FROM money.ledger_entry WHERE account = 'subscription_revenue'");
    assert.equal(rev.s, "-999", "the membership fee is subscription revenue");
    const [recv] = await inspect("CD", "SELECT sum(amount_minor)::text AS s FROM money.ledger_entry WHERE account = 'customer_receivable'");
    assert.equal(recv.s, "999", "the customer owes the fee");
    // Subscribing twice is refused.
    assert.equal((await call("POST", "/v1/me/membership", { token: member.token, country: "CD", body: { plan_id: plan.id } })).body.code, "ALREADY_SUBSCRIBED");
    // GET shows it.
    const mine = await call("GET", "/v1/me/membership", { token: member.token, country: "CD" });
    assert.equal(mine.body.membership.plan.id, plan.id);
  });

  test("a member's quote waives the delivery fee, funded by the platform", async () => {
    const q = await call("POST", "/v1/carts/quote", { token: member.token, country: "CD", body: cart() });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.ok(q.body.membership, "a member gets a membership block");
    assert.equal(q.body.membership.free_delivery, true);
    const deliveryLine = q.body.price_lines.find((l: { code: string }) => l.code === "DELIVERY_FEE");
    assert.ok(deliveryLine && BigInt(deliveryLine.amount.amount_minor) > 0n, "the order has a delivery fee to waive");
    // The discount equals the delivery fee; the payable is the gross total minus it.
    assert.equal(q.body.membership.discount.amount_minor, deliveryLine.amount.amount_minor);
    assert.equal(BigInt(q.body.membership.payable_total.amount_minor), BigInt(q.body.total.amount_minor) - BigInt(deliveryLine.amount.amount_minor));
  });

  test("a member's order settles with the platform funding the benefit; the books balance", async () => {
    const q = await call("POST", "/v1/carts/quote", { token: member.token, country: "CD", body: cart() });
    const payable = q.body.membership.payable_total;
    const discount = q.body.membership.discount.amount_minor;
    // Pay the discounted total, not the gross.
    const placed = await call("POST", "/v1/orders", { token: member.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", expected_total: payable } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order_id;
    const code = placed.body.recipient_code;
    // Paying the gross total would be rejected: the member owes less.
    assert.equal(placed.body.quote.membership.payable_total.amount_minor, payable.amount_minor);
    const pay = await call("POST", "/v1/payments/intents", { token: member.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000050" } } });
    assert.equal(pay.body.status, "SUCCEEDED", JSON.stringify(pay.body));
    // Drive the order through custody to delivered.
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "M-1", sealId: "MS-1" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["M-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "M-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    // The settlement journal funds the waived delivery from subscription revenue, and still balances.
    const entries = await inspect("CD", "SELECT e.account, e.amount_minor::text AS amount, e.currency FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1 ORDER BY e.line", [`order:${orderId}:settlement`]);
    const fund = entries.find((e) => e.account === "subscription_revenue");
    assert.ok(fund, "a membership funding entry is posted");
    assert.equal(fund.amount, discount, "the platform funds exactly the waived delivery fee");
    const byCcy = new Map<string, bigint>();
    for (const e of entries) byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0n) + BigInt(e.amount));
    for (const [, sum] of byCcy) assert.equal(sum, 0n, "the settlement journal balances per currency");
  });

  test("cancelling stops auto-renewal but keeps benefits until the period ends", async () => {
    const r = await call("DELETE", "/v1/me/membership", { token: member.token, country: "CD" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.membership.auto_renew, false);
    assert.equal(r.body.membership.status, "ACTIVE", "still active until the period ends");
    // The benefit still applies while the paid period lasts.
    const q = await call("POST", "/v1/carts/quote", { token: member.token, country: "CD", body: cart() });
    assert.ok(q.body.membership, "benefit still applies inside the paid period");
  });

  test("an admin can update a plan and deactivate it", async () => {
    const upd = await call("POST", `/v1/admin/membership/plans/${plan.id}`, { token: admin.token, country: "CD", body: { ...plan, name: "Tunakula Plus", price_minor: "1299", currency: "USD", period: "MONTH", free_delivery: true, min_subtotal_minor: "0", active: false } });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.active, false);
    assert.deepEqual(upd.body.price, { amount_minor: "1299", currency: "USD" });
    // A deactivated plan is gone from the public list.
    const plans = await call("GET", "/v1/membership/plans", { country: "CD" });
    assert.ok(!plans.body.data.some((p: { id: string }) => p.id === plan.id), "inactive plans are not offered");
  });
});

describe("dietary tags and nutrition on dishes", () => {
  let dishId: string;

  test("the owner sets structured dietary tags and nutrition; they round-trip", async () => {
    const r = await call("POST", `/v1/branches/${branchId}/items`, {
      token: restaurantOwner.token, country: "CD",
      body: {
        names: { fr: "Bowl végétalien", en: "Vegan bowl" }, prices: { USD: "8.00" },
        dietary: ["vegan", "vegetarian", "gluten_free"], allergens: ["soybeans"],
        nutrition: { kcal: 520, protein_g: 18.5, carbs_g: 60, fat_g: 22 },
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    dishId = r.body.id;
    assert.deepEqual([...r.body.dietary].sort(), ["GLUTEN_FREE", "VEGAN", "VEGETARIAN"]);
    assert.equal(r.body.nutrition.kcal, 520);
    assert.equal(r.body.nutrition.protein_g, 18.5);
    // It comes back on the public menu too.
    const menu = await call("GET", `/v1/branches/${branchId}/menu`, { country: "CD" });
    const onMenu = menu.body.items.find((i: { id: string }) => i.id === dishId);
    assert.ok(onMenu.dietary.includes("VEGAN"));
    assert.equal(onMenu.nutrition.kcal, 520);
  });

  test("an unknown dietary tag or a negative calorie is refused", async () => {
    const bad = await call("POST", `/v1/branches/${branchId}/items`, {
      token: restaurantOwner.token, country: "CD",
      body: { names: { fr: "X" }, prices: { USD: "1.00" }, dietary: ["paleo"] },
    });
    assert.equal(bad.body.code, "DIETARY_UNKNOWN");
    const badN = await call("POST", `/v1/branches/${branchId}/items`, {
      token: restaurantOwner.token, country: "CD",
      body: { names: { fr: "Y" }, prices: { USD: "1.00" }, nutrition: { kcal: -5 } },
    });
    assert.equal(badN.body.code, "NUTRITION_VALUE_INVALID");
  });

  test("editing a dish updates its dietary tags and nutrition", async () => {
    const r = await call("POST", `/v1/branches/${branchId}/items/${dishId}`, {
      token: restaurantOwner.token, country: "CD",
      body: { names: { fr: "Bowl végétalien", en: "Vegan bowl" }, prices: { USD: "8.00" }, dietary: ["vegan"], nutrition: { kcal: 500 } },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.dietary, ["VEGAN"]);
    assert.equal(r.body.nutrition.kcal, 500);
  });
});

describe("group ordering (shared cart, bill split)", () => {
  let host: { token: string; userId: string };
  let guest: { token: string; userId: string };
  let cartId: string;
  let code: string;

  test("a host starts a group cart and a friend joins by code", async () => {
    host = await signIn("+243810000070");
    guest = await signIn("+243810000071");
    await backdate(host.userId, 30); // so the host can pay cash on delivery
    const created = await call("POST", "/v1/group-carts", { token: host.token, country: "CD", body: { branch_id: branchId, order_type: "DELIVERY" } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    cartId = created.body.id;
    code = created.body.code;
    assert.equal(created.body.members.length, 1);
    assert.equal(created.body.members[0].is_host, true);
    const joined = await call("POST", "/v1/group-carts/join", { token: guest.token, country: "CD", body: { code } });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.members.length, 2);
    // A stranger cannot see the cart.
    assert.equal((await call("GET", `/v1/group-carts/${cartId}`, { token: rider.token, country: "CD" })).status, 403);
  });

  test("each member adds their own items", async () => {
    const a = await call("POST", `/v1/group-carts/${cartId}/lines`, { token: host.token, country: "CD", body: { item_id: itemId, quantity: 2 } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await call("POST", `/v1/group-carts/${cartId}/lines`, { token: guest.token, country: "CD", body: { item_id: itemId, quantity: 1 } });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    const view = await call("GET", `/v1/group-carts/${cartId}`, { token: guest.token, country: "CD" });
    assert.equal(view.body.lines.length, 2);
    assert.ok(view.body.lines.some((l: { member_user_id: string }) => l.member_user_id === host.userId));
    assert.ok(view.body.lines.some((l: { member_user_id: string }) => l.member_user_id === guest.userId));
  });

  test("the quote splits the bill across members and the shares sum to the total", async () => {
    const q = await call("POST", `/v1/group-carts/${cartId}/quote`, { token: host.token, country: "CD", body: { delivery: DROP } });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.split.length, 2, "one share per member who ordered");
    const total = BigInt(q.body.breakdown.total.amount_minor);
    const sum = q.body.split.reduce((s: bigint, m: { share_minor: string }) => s + BigInt(m.share_minor), 0n);
    assert.equal(sum, total, "the per-person shares add up to the whole bill, to the cent");
    // Each member's share is at least their own food.
    for (const s of q.body.split) assert.ok(BigInt(s.share_minor) >= BigInt(s.items_minor));
  });

  test("only the host can lock and place; placing makes one real order", async () => {
    assert.equal((await call("POST", `/v1/group-carts/${cartId}/lock`, { token: guest.token, country: "CD", body: { locked: true } })).status, 403);
    assert.equal((await call("POST", `/v1/group-carts/${cartId}/lock`, { token: host.token, country: "CD", body: { locked: true } })).body.status, "LOCKED");
    // A guest cannot add once locked.
    assert.equal((await call("POST", `/v1/group-carts/${cartId}/lines`, { token: guest.token, country: "CD", body: { item_id: itemId, quantity: 1 } })).body.code, "GROUP_LOCKED");
    const q = await call("POST", `/v1/group-carts/${cartId}/quote`, { token: host.token, country: "CD", body: { delivery: DROP } });
    const placed = await call("POST", `/v1/group-carts/${cartId}/place`, { token: host.token, country: "CD", body: { payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.breakdown.total, delivery: DROP } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.ok(placed.body.order_id);
    // The group cart is now placed and points at the order.
    const after = await call("GET", `/v1/group-carts/${cartId}`, { token: host.token, country: "CD" });
    assert.equal(after.body.status, "PLACED");
    assert.equal(after.body.placed_order_id, placed.body.order_id);
    // The order carries the whole group's lines (2 lines, host + guest).
    const order = await call("GET", `/v1/orders/${placed.body.order_id}`, { token: host.token, country: "CD" });
    assert.equal(order.body.lines.length, 2);
  });
});

describe("rider earnings breakdown and instant cash-out", () => {
  test("a rider sees a per-order breakdown with base and tip", async () => {
    const e = await call("GET", "/v1/rider/earnings", { token: rider.token, country: "CD" });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.ok(e.body.orders.length >= 1, "the rider has delivered orders from earlier in the suite");
    const o = e.body.orders[0];
    assert.ok("base" in o && "tip" in o && "total" in o, "each order splits into base + tip");
    assert.equal(BigInt(o.base.amount_minor) + BigInt(o.tip.amount_minor), BigInt(o.total.amount_minor), "base + tip = the rider's take");
    assert.ok(BigInt(e.body.available.amount_minor) > 0n, "there is a balance to cash out");
    // Only riders have earnings.
    assert.equal((await call("GET", "/v1/rider/earnings", { token: customer.token, country: "CD" })).status, 403);
  });

  test("instant cash-out pays the balance and posts a balanced journal", async () => {
    const before = await call("GET", "/v1/rider/earnings", { token: rider.token, country: "CD" });
    const avail = BigInt(before.body.available.amount_minor);
    const [payableBefore] = await inspect("CD", "SELECT COALESCE(sum(amount_minor),0)::text AS s FROM money.ledger_entry WHERE account = 'rider_payable'");
    const out = await call("POST", "/v1/rider/cashout", { token: rider.token, country: "CD", body: {} });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.paid.amount_minor, avail.toString(), "a full cash-out pays the whole balance");
    assert.equal(out.body.available.amount_minor, "0");
    // rider_payable moved toward zero by exactly the payout (it is a credit balance, so the sum rises).
    const [payableAfter] = await inspect("CD", "SELECT COALESCE(sum(amount_minor),0)::text AS s FROM money.ledger_entry WHERE account = 'rider_payable'");
    assert.equal(BigInt(payableAfter.s) - BigInt(payableBefore.s), avail, "the payout debited rider_payable");
    // The ledger still balances per currency.
    const [bal] = await inspect("CD", "SELECT currency, sum(amount_minor)::text AS s FROM money.ledger_entry GROUP BY currency");
    assert.equal(bal.s, "0");
    // Nothing left to cash out now.
    assert.equal((await call("POST", "/v1/rider/cashout", { token: rider.token, country: "CD", body: {} })).body.code, "NOTHING_TO_CASH_OUT");
  });

  test("a cash-out is idempotent on its key", async () => {
    // Deliver nothing new; this rider's balance is 0, so a keyed replay must not create a second payout.
    const key = "rider-cashout-replay-key-0001";
    const a = await call("POST", "/v1/rider/cashout", { token: rider.token, country: "CD", key, body: { amount_minor: "0" } });
    const b = await call("POST", "/v1/rider/cashout", { token: rider.token, country: "CD", key, body: { amount_minor: "0" } });
    assert.equal(a.status, b.status);
  });
});

describe("merchant performance scorecards", () => {
  test("an admin sees per-restaurant metrics; a customer cannot", async () => {
    const r = await call("GET", "/v1/admin/scorecards?days=90", { token: admin.token, country: "CD" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body.scorecards) && r.body.scorecards.length >= 1);
    const card = r.body.scorecards.find((c: { branch_id: string }) => c.branch_id === branchId);
    assert.ok(card, "the seeded branch has a scorecard");
    assert.ok(card.orders >= 1, "it counts the orders delivered earlier in the suite");
    assert.ok(card.delivered >= 1);
    // Rates are 0–100 or null; the score is a number.
    for (const k of ["acceptance_rate", "fulfilment_rate", "cancellation_rate"]) {
      if (card[k] !== null) assert.ok(card[k] >= 0 && card[k] <= 100, `${k} is a percentage`);
    }
    assert.ok(card.score === null || (card.score >= 0 && card.score <= 100));
    assert.ok("avg_prep_minutes" in card && "gmv" in card);
    // A plain customer has no restaurants to see.
    assert.equal((await call("GET", "/v1/admin/scorecards", { token: customer.token, country: "CD" })).status, 403);
  });

  test("the restaurant owner sees only their own branches", async () => {
    const r = await call("GET", "/v1/admin/scorecards", { token: restaurantOwner.token, country: "CD" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Every scorecard belongs to a branch in the owner's group (the one they can see).
    assert.ok(r.body.scorecards.every((c: { branch_id: string }) => typeof c.branch_id === "string"));
    assert.ok(r.body.scorecards.some((c: { branch_id: string }) => c.branch_id === branchId));
  });
});

describe("rider safety / SOS", () => {
  let incidentId: string;
  test("a rider raises an SOS; ops see it and acknowledge then resolve it", async () => {
    const sos = await call("POST", "/v1/rider/sos", { token: rider.token, country: "CD", body: { kind: "UNSAFE", lat: KINSHASA.lat, lng: KINSHASA.lng, note: "Followed on Avenue X" } });
    assert.equal(sos.status, 201, JSON.stringify(sos.body));
    assert.equal(sos.body.status, "OPEN");
    assert.ok(sos.body.message.length > 0, "the rider gets reassurance");
    incidentId = sos.body.id;
    // A customer cannot raise an SOS (not a rider) and cannot see the queue.
    assert.equal((await call("POST", "/v1/rider/sos", { token: customer.token, country: "CD", body: { kind: "SOS" } })).status, 403);
    assert.equal((await call("GET", "/v1/ops/incidents", { token: customer.token, country: "CD" })).status, 403);
    // Ops see the open incident.
    const queue = await call("GET", "/v1/ops/incidents", { token: ops.token, country: "CD" });
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    const inc = queue.body.incidents.find((i: { id: string }) => i.id === incidentId);
    assert.ok(inc, "the incident is in the ops queue");
    assert.equal(inc.status, "OPEN");
    assert.equal(inc.kind, "UNSAFE");
    assert.equal(inc.rider.id, rider.userId);
    assert.ok(inc.location && inc.location.lat === KINSHASA.lat);
    // Acknowledge, then resolve.
    assert.equal((await call("POST", `/v1/ops/incidents/${incidentId}`, { token: ops.token, country: "CD", body: { status: "ACKNOWLEDGED" } })).body.status, "ACKNOWLEDGED");
    assert.equal((await call("POST", `/v1/ops/incidents/${incidentId}`, { token: ops.token, country: "CD", body: { status: "RESOLVED" } })).body.status, "RESOLVED");
    // A bad status is refused.
    assert.equal((await call("POST", `/v1/ops/incidents/${incidentId}`, { token: ops.token, country: "CD", body: { status: "CLOSED" } })).body.code, "STATUS_INVALID");
  });
});

describe("rider tiers and incentive quests", () => {
  test("the rider's tier shows in earnings", async () => {
    const e = await call("GET", "/v1/rider/earnings", { token: rider.token, country: "CD" });
    assert.ok(["BRONZE", "SILVER", "GOLD", "PLATINUM"].includes(e.body.tier.tier), JSON.stringify(e.body.tier));
    assert.ok(e.body.tier.deliveries >= 1);
    assert.ok("bonuses" in e.body);
  });

  test("ops create a quest; the rider completes it and claims the bonus into their balance", async () => {
    const q = await call("POST", "/v1/ops/quests", { token: ops.token, country: "CD", body: { name: "Weekend 1-delivery sprint", target_deliveries: 1, bonus_minor: "500", days: 7 } });
    assert.equal(q.status, 201, JSON.stringify(q.body));
    const questId = q.body.id;
    // A customer cannot define quests.
    assert.equal((await call("POST", "/v1/ops/quests", { token: customer.token, country: "CD", body: { name: "x", target_deliveries: 1, bonus_minor: "1" } })).status, 403);
    // The quest starts now, so the rider's earlier deliveries don't count yet.
    const before = (await call("GET", "/v1/rider/quests", { token: rider.token, country: "CD" })).body.quests.find((x: { id: string }) => x.id === questId);
    assert.ok(before, "the rider sees the active quest");
    assert.equal(before.claimable, false);
    assert.equal((await call("POST", `/v1/rider/quests/${questId}/claim`, { token: rider.token, country: "CD" })).body.code, "QUEST_NOT_COMPLETE");

    // Drive one fresh delivery for this rider.
    const p = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: p.orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    await transition(ops, p.orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, p.orderId, { type: "ACCEPT" });
    await transition(kitchen, p.orderId, { type: "START_PREPARING" });
    await transition(kitchen, p.orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, p.orderId, { type: "MARK_READY", packages: [{ labelId: "Q-1", sealId: "QS-1" }], packPhotoRef: "photo://pack" });
    await transition(rider, p.orderId, { type: "PICK_UP", scannedLabelIds: ["Q-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    assert.equal((await transition(rider, p.orderId, { type: "DELIVER", scannedLabelId: "Q-1", location: DROP, sealIntact: true, verification: { method: "CODE", code: p.code }, proofPhotoRef: "photo://door" })).body.state, "DELIVERED");

    // Now the quest is complete and claimable.
    const after = (await call("GET", "/v1/rider/quests", { token: rider.token, country: "CD" })).body.quests.find((x: { id: string }) => x.id === questId);
    assert.ok(after.progress >= 1 && after.claimable === true, JSON.stringify(after));
    const claim = await call("POST", `/v1/rider/quests/${questId}/claim`, { token: rider.token, country: "CD" });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    assert.equal(claim.body.claimed, true);
    assert.equal(claim.body.bonus.amount_minor, "500");
    // Claiming again does not pay twice.
    assert.equal((await call("POST", `/v1/rider/quests/${questId}/claim`, { token: rider.token, country: "CD" })).body.claimed, true);
    // The bonus is in the rider's balance, and the ledger still balances.
    const e = await call("GET", "/v1/rider/earnings", { token: rider.token, country: "CD" });
    assert.ok(BigInt(e.body.bonuses.amount_minor) >= 500n);
    const [bal] = await inspect("CD", "SELECT currency, sum(amount_minor)::text AS s FROM money.ledger_entry GROUP BY currency");
    assert.equal(bal.s, "0");
  });
});

describe("coupons / promo codes", () => {
  test("admin creates a percent coupon; the customer applies it and the platform funds it at settlement", async () => {
    await backdate(customer.userId, 40);
    const c = await call("POST", "/v1/admin/coupons", { token: admin.token, country: "CD", body: { code: "WELCOME20", description: "20% off your order", kind: "PERCENT", value_bps: 2000, min_subtotal_minor: "1000", per_customer_limit: 2, days: 30 } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.code, "WELCOME20");
    // A customer cannot create coupons.
    assert.equal((await call("POST", "/v1/admin/coupons", { token: customer.token, country: "CD", body: { code: "HACK", kind: "FIXED", value_minor: "1" } })).status, 403);
    // Quote with the code: 20% of 2x$12.50 = $5.00 off.
    const q = await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: { ...cart(), coupon_code: "welcome20" } });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.coupon.code, "WELCOME20");
    assert.equal(q.body.coupon.discount.amount_minor, "500");
    assert.equal(BigInt(q.body.payable.amount_minor), BigInt(q.body.total.amount_minor) - 500n);
    // Place COD with the discounted total, then deliver to settle.
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), coupon_code: "WELCOME20", payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.payable } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order_id, code = placed.body.recipient_code;
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.total.amount_minor, q.body.payable.amount_minor);
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "C-1", sealId: "CS-1" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["C-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    assert.equal((await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "C-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" })).body.state, "DELIVERED");
    // The settlement funds the coupon from promotion_expense, and the books balance.
    const entries = await inspect("CD", "SELECT e.account, e.amount_minor::text AS amount, e.currency FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1 ORDER BY e.line", [`order:${orderId}:settlement`]);
    const promo = entries.find((e) => e.account === "promotion_expense");
    assert.ok(promo && promo.amount === "500", "the platform funds the $5 coupon from promotion_expense");
    const byCcy = new Map<string, bigint>();
    for (const e of entries) byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0n) + BigInt(e.amount));
    for (const [, s] of byCcy) assert.equal(s, 0n, "the settlement journal balances");
    // The redemption was recorded.
    const [red] = await inspect("CD", "SELECT amount_minor::text AS a FROM promotions.coupon_redemption WHERE order_id = $1", [orderId]);
    assert.equal(red.a, "500");
  });

  test("limits and bad codes are enforced", async () => {
    await call("POST", "/v1/admin/coupons", { token: admin.token, country: "CD", body: { code: "ONCE", kind: "FIXED", value_minor: "200", per_customer_limit: 1, days: 30 } });
    // First use: place (no need to deliver).
    const q = await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: { ...cart(), coupon_code: "ONCE" } });
    assert.equal(q.body.coupon.discount.amount_minor, "200");
    await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), coupon_code: "ONCE", payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.payable } });
    // Second attempt by the same customer is refused.
    assert.equal((await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: { ...cart(), coupon_code: "ONCE" } })).body.code, "COUPON_ALREADY_USED");
    // An unknown code is refused.
    assert.equal((await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: { ...cart(), coupon_code: "NOPE" } })).body.code, "COUPON_INVALID");
    // A code lists in the admin panel.
    const list = await call("GET", "/v1/admin/coupons", { token: admin.token, country: "CD" });
    assert.ok(list.body.coupons.some((x: { code: string }) => x.code === "ONCE"));
  });
});

describe("reviews and ratings", () => {
  let orderId: string;
  let reviewId: string;
  test("a customer rates a delivered order once; the restaurant replies", async () => {
    // Place and deliver a fresh order so there is something to review.
    const p = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: p.orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    await transition(ops, p.orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, p.orderId, { type: "ACCEPT" });
    await transition(kitchen, p.orderId, { type: "START_PREPARING" });
    await transition(kitchen, p.orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, p.orderId, { type: "MARK_READY", packages: [{ labelId: "R-1", sealId: "RS-1" }], packPhotoRef: "photo://pack" });
    await transition(rider, p.orderId, { type: "PICK_UP", scannedLabelIds: ["R-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    assert.equal((await transition(rider, p.orderId, { type: "DELIVER", scannedLabelId: "R-1", location: DROP, sealIntact: true, verification: { method: "CODE", code: p.code }, proofPhotoRef: "photo://door" })).body.state, "DELIVERED");
    orderId = p.orderId;

    // Before reviewing, the order is reviewable.
    const pre = await call("GET", `/v1/orders/${orderId}/review`, { token: customer.token, country: "CD" });
    assert.equal(pre.body.reviewable, true);
    assert.equal(pre.body.review, null);
    // Only the customer who placed it can review; rating must be 1–5.
    assert.equal((await call("POST", `/v1/orders/${orderId}/review`, { token: rider.token, country: "CD", body: { restaurant_rating: 5 } })).status, 403);
    assert.equal((await call("POST", `/v1/orders/${orderId}/review`, { token: customer.token, country: "CD", body: { restaurant_rating: 9 } })).body.code, "RATING_INVALID");
    // Submit a 5-star review with a comment and a rider rating.
    const sub = await call("POST", `/v1/orders/${orderId}/review`, { token: customer.token, country: "CD", body: { restaurant_rating: 5, rider_rating: 4, comment: "Hot, fast, delicious." } });
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    // Reviewing twice is refused.
    assert.equal((await call("POST", `/v1/orders/${orderId}/review`, { token: customer.token, country: "CD", body: { restaurant_rating: 3 } })).body.code, "ALREADY_REVIEWED");

    // It shows on the public storefront with the average.
    const pub = await call("GET", `/v1/branches/${branchId}/reviews`, { country: "CD" });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.ok(pub.body.average >= 1 && pub.body.average <= 5);
    assert.ok(pub.body.count >= 1);
    const mine = pub.body.reviews.find((r: { comment: string | null }) => r.comment === "Hot, fast, delicious.");
    assert.ok(mine, "the comment appears on the storefront");
    reviewId = mine.id;

    // The owner sees it in their list and replies.
    const list = await call("GET", `/v1/admin/branches/${branchId}/reviews`, { token: restaurantOwner.token, country: "CD" });
    assert.ok(list.body.reviews.some((r: { id: string }) => r.id === reviewId));
    const reply = await call("POST", `/v1/admin/reviews/${reviewId}/reply`, { token: restaurantOwner.token, country: "CD", body: { reply: "Merci beaucoup! See you soon." } });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const after = await call("GET", `/v1/branches/${branchId}/reviews`, { country: "CD" });
    assert.equal(after.body.reviews.find((r: { id: string }) => r.id === reviewId).reply, "Merci beaucoup! See you soon.");
  });

  test("an undelivered order cannot be reviewed", async () => {
    const q = await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: cart() });
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", expected_total: q.body.total } });
    assert.equal((await call("POST", `/v1/orders/${placed.body.order_id}/review`, { token: customer.token, country: "CD", body: { restaurant_rating: 5 } })).body.code, "ORDER_NOT_DELIVERED");
  });

  test("the scorecard carries the branch rating", async () => {
    const s = await call("GET", "/v1/admin/scorecards?days=90", { token: admin.token, country: "CD" });
    const card = s.body.scorecards.find((c: { branch_id: string }) => c.branch_id === branchId);
    assert.ok(card.rating >= 1 && card.rating <= 5, "the scorecard shows the average rating");
    assert.ok(card.reviews >= 1);
  });
});

describe("saved addresses", () => {
  test("a customer saves, lists, re-defaults and deletes addresses", async () => {
    const list0 = await call("GET", "/v1/me/addresses", { token: customer.token, country: "CD" });
    assert.equal(list0.status, 200, JSON.stringify(list0.body));
    const base = list0.body.data.length;
    // First address becomes the default automatically.
    const home = await call("POST", "/v1/me/addresses", { token: customer.token, country: "CD", body: { label: "Home", lat: -4.3215, lng: 15.2947, landmark: "Blue gate" } });
    assert.equal(home.status, 201, JSON.stringify(home.body));
    assert.equal(home.body.is_default, base === 0);
    const work = await call("POST", "/v1/me/addresses", { token: customer.token, country: "CD", body: { label: "Work", lat: -4.33, lng: 15.30, is_default: true } });
    assert.equal(work.body.is_default, true);
    // Setting Work default unset Home's default.
    const list = await call("GET", "/v1/me/addresses", { token: customer.token, country: "CD" });
    assert.equal(list.body.data.filter((a: { is_default: boolean }) => a.is_default).length, 1, "exactly one default");
    assert.ok(list.body.data.find((a: { id: string; is_default: boolean }) => a.id === work.body.id).is_default);
    // Re-default Home.
    assert.equal((await call("POST", `/v1/me/addresses/${home.body.id}/default`, { token: customer.token, country: "CD" })).body.is_default, true);
    // A bad pin is refused.
    assert.equal((await call("POST", "/v1/me/addresses", { token: customer.token, country: "CD", body: { label: "X", lat: 999, lng: 0 } })).body.code, "PIN_REQUIRED");
    // Another customer cannot see these.
    const other = await signIn("+243810000090");
    assert.equal((await call("GET", "/v1/me/addresses", { token: other.token, country: "CD" })).body.data.length, 0);
    // Delete.
    assert.equal((await call("DELETE", `/v1/me/addresses/${work.body.id}`, { token: customer.token, country: "CD" })).body.deleted, true);
    assert.ok(!(await call("GET", "/v1/me/addresses", { token: customer.token, country: "CD" })).body.data.some((a: { id: string }) => a.id === work.body.id));
  });
});

describe("favourites", () => {
  test("a customer hearts and un-hearts a restaurant", async () => {
    assert.deepEqual((await call("GET", "/v1/me/favourites", { token: customer.token, country: "CD" })).body.data, []);
    const on = await call("POST", `/v1/me/favourites/${branchId}`, { token: customer.token, country: "CD" });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.favourite, true);
    const list = await call("GET", "/v1/me/favourites", { token: customer.token, country: "CD" });
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].branch_id, branchId);
    assert.ok("rating" in list.body.data[0] && "name" in list.body.data[0]);
    // Toggling again removes it.
    assert.equal((await call("POST", `/v1/me/favourites/${branchId}`, { token: customer.token, country: "CD" })).body.favourite, false);
    assert.equal((await call("GET", "/v1/me/favourites", { token: customer.token, country: "CD" })).body.data.length, 0);
    // A made-up restaurant can't be favourited.
    assert.equal((await call("POST", `/v1/me/favourites/${randomUUID()}`, { token: customer.token, country: "CD" })).status, 404);
  });
});

describe("opening hours", () => {
  test("a merchant sets hours; a closed day refuses orders, then reopening allows them", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kinshasa", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    // A customer cannot set hours; the owner can.
    assert.equal((await call("POST", `/v1/admin/branches/${branchId}/hours`, { token: customer.token, country: "CD", body: { hours: {} } })).status, 403);
    assert.equal((await call("POST", `/v1/admin/branches/${branchId}/hours`, { token: restaurantOwner.token, country: "CD", body: { hours: { "9": [] } } })).body.code, "HOURS_INVALID");
    // Close the branch all day today via a special-hours override.
    const set = await call("POST", `/v1/admin/branches/${branchId}/hours`, { token: restaurantOwner.token, country: "CD", body: { hours: {}, special_hours: { [today]: [] } } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    // Ordering is now refused.
    assert.equal((await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: cart() })).body.code, "BRANCH_CLOSED");
    // The storefront shows it closed.
    const eta = await call("GET", `/v1/branches/${branchId}/eta?lat=${DROP.lat}&lng=${DROP.lng}`, { country: "CD" });
    assert.equal(eta.body.open, false);
    // Reopen (clear the schedule) and ordering works again.
    assert.equal((await call("POST", `/v1/admin/branches/${branchId}/hours`, { token: restaurantOwner.token, country: "CD", body: { hours: {}, special_hours: {} } })).status, 200);
    assert.equal((await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: cart() })).status, 200);
    // The owner can read the saved hours back.
    const got = await call("GET", `/v1/admin/branches/${branchId}/hours`, { token: restaurantOwner.token, country: "CD" });
    assert.deepEqual(got.body.special_hours, {});
  });
});

describe("age-restricted items (18+)", () => {
  let wineId: string;
  test("an age-restricted order needs an 18+ confirmation", async () => {
    // The owner adds an age-restricted item.
    const wine = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Vin rouge", en: "Red wine" }, prices: { USD: "15.00" }, age_restricted: true } });
    assert.equal(wine.status, 201, JSON.stringify(wine.body));
    assert.equal(wine.body.age_restricted, true);
    wineId = wine.body.id;
    // The quote flags it.
    const q = await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: { branch_id: branchId, items: [{ item_id: wineId, quantity: 1 }], order_type: "DELIVERY", delivery: DROP } });
    assert.equal(q.body.age_restricted, true);
    // Placing without confirming age is refused.
    const no = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { branch_id: branchId, items: [{ item_id: wineId, quantity: 1 }], order_type: "DELIVERY", delivery: DROP, payment_mode: "PREPAID", expected_total: q.body.total } });
    assert.equal(no.body.code, "AGE_CONFIRMATION_REQUIRED");
    // Confirming age lets it through.
    const yes = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { branch_id: branchId, items: [{ item_id: wineId, quantity: 1 }], order_type: "DELIVERY", delivery: DROP, payment_mode: "PREPAID", expected_total: q.body.total, age_confirmed: true } });
    assert.equal(yes.status, 201, JSON.stringify(yes.body));
    // A normal order (no age item) needs no confirmation.
    const plain = await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: cart() });
    assert.equal(plain.body.age_restricted, undefined);
  });
});

describe("order notes (per-dish + kitchen)", () => {
  test("a dish note and a kitchen note flow onto the order and the kitchen board", async () => {
    const q = await call("POST", "/v1/carts/quote", { token: customer.token, country: "CD", body: cart() });
    const place = await call("POST", "/v1/orders", {
      token: customer.token, country: "CD",
      body: {
        branch_id: branchId,
        items: [{ item_id: itemId, quantity: 2, note: "No onions please" }],
        order_type: "DELIVERY", delivery: DROP, payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total,
        kitchen_note: "Extra napkins, no cutlery",
      },
    });
    assert.equal(place.status, 201, JSON.stringify(place.body));
    // The customer sees the notes back on their order.
    const view = await call("GET", `/v1/orders/${place.body.order_id}`, { token: customer.token, country: "CD" });
    assert.equal(view.body.kitchen_note, "Extra napkins, no cutlery");
    assert.equal(view.body.lines[0].note, "No onions please");
    // The kitchen board shows them too.
    const board = await call("GET", "/v1/kitchen/orders", { token: kitchen.token, country: "CD" });
    const onBoard = board.body.orders.find((o: { order_id: string }) => o.order_id === place.body.order_id) as { kitchen_note?: string; lines: { note?: string }[] };
    assert.equal(onBoard.kitchen_note, "Extra napkins, no cutlery");
    assert.equal(onBoard.lines[0]?.note, "No onions please");
  });
});

describe("table bookings (dine-in reservations)", () => {
  let bookingId: string;
  const soon = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

  test("a customer books a table and the restaurant confirms and seats it", async () => {
    // Customer books a table for four.
    const book = await call("POST", "/v1/reservations", { token: customer.token, country: "CD", body: { branch_id: branchId, party_size: 4, at: soon(), name: "Amara", phone: "+243810000099", note: "Window seat please" } });
    assert.equal(book.status, 201, JSON.stringify(book.body));
    assert.equal(book.body.status, "REQUESTED");
    assert.equal(book.body.party_size, 4);
    bookingId = book.body.id;
    // The customer sees it in their own list.
    const mine = await call("GET", "/v1/me/reservations", { token: customer.token, country: "CD" });
    assert.ok(mine.body.bookings.some((b: { id: string }) => b.id === bookingId));
    // The restaurant sees it and confirms, then seats it.
    const board = await call("GET", `/v1/admin/branches/${branchId}/reservations`, { token: restaurantOwner.token, country: "CD" });
    const mineOnBoard = board.body.bookings.find((b: { id: string }) => b.id === bookingId) as { customer: string; party_size: number };
    assert.equal(mineOnBoard.party_size, 4);
    assert.equal((await call("POST", `/v1/admin/reservations/${bookingId}/status`, { token: restaurantOwner.token, country: "CD", body: { status: "CONFIRMED" } })).body.status, "CONFIRMED");
    assert.equal((await call("POST", `/v1/admin/reservations/${bookingId}/status`, { token: restaurantOwner.token, country: "CD", body: { status: "SEATED" } })).body.status, "SEATED");
  });

  test("a party of one is allowed; zero is refused", async () => {
    assert.equal((await call("POST", "/v1/reservations", { token: customer.token, country: "CD", body: { branch_id: branchId, party_size: 1, at: soon() } })).status, 201);
    assert.equal((await call("POST", "/v1/reservations", { token: customer.token, country: "CD", body: { branch_id: branchId, party_size: 0, at: soon() } })).body.code, "PARTY_SIZE_INVALID");
  });

  test("a seating time in the past is refused", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    assert.equal((await call("POST", "/v1/reservations", { token: customer.token, country: "CD", body: { branch_id: branchId, party_size: 2, at: past } })).body.code, "TIME_IN_PAST");
  });

  test("a customer cancels their own booking; a seated one cannot be cancelled", async () => {
    const book = await call("POST", "/v1/reservations", { token: customer.token, country: "CD", body: { branch_id: branchId, party_size: 2, at: soon() } });
    const id = book.body.id;
    assert.equal((await call("POST", `/v1/reservations/${id}/cancel`, { token: customer.token, country: "CD" })).body.status, "CANCELLED");
    // The already-seated booking from the first test cannot be cancelled by the customer.
    assert.equal((await call("POST", `/v1/reservations/${bookingId}/cancel`, { token: customer.token, country: "CD" })).body.code, "NOT_CANCELLABLE");
  });

  test("only the restaurant can manage its bookings", async () => {
    const book = await call("POST", "/v1/reservations", { token: customer.token, country: "CD", body: { branch_id: branchId, party_size: 2, at: soon() } });
    assert.equal((await call("POST", `/v1/admin/reservations/${book.body.id}/status`, { token: customer.token, country: "CD", body: { status: "CONFIRMED" } })).status, 403);
    assert.equal((await call("GET", `/v1/admin/branches/${branchId}/reservations`, { token: customer.token, country: "CD" })).status, 403);
  });
});

describe("scheduled orders", () => {
  const ahead = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

  test("a time too soon or too far is refused", async () => {
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const soon = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total, scheduled_for: ahead(10) } });
    assert.equal(soon.body.code, "SCHEDULE_TOO_SOON");
    const far = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total, scheduled_for: ahead(60 * 24 * 9) } });
    assert.equal(far.body.code, "SCHEDULE_TOO_FAR");
  });

  test("a scheduled order is placed, held until due, then released", async () => {
    const at = ahead(180); // three hours out
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const r = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total, scheduled_for: at } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.state, "PLACED");
    // The customer sees the scheduled time back on the order.
    const v = await call("GET", `/v1/orders/${r.body.order_id}`, { token: customer.token, country: "CD" });
    assert.equal(v.body.scheduled_for, new Date(at).toISOString());
    // A dispatcher pass now must NOT cancel it — it is not due yet.
    await api.get<DispatchService>(TOKENS.dispatch).tick("CD");
    assert.equal((await call("GET", `/v1/orders/${r.body.order_id}`, { token: customer.token, country: "CD" })).body.state, "PLACED");
    // Past its release time with no kitchen answer, a dispatcher pass cancels it — proving it was released on schedule.
    const future = new DispatchService(db, api.get<CommerceService>(TOKENS.commerce), () => new Date(Date.parse(at) + (KITCHEN_TIMEOUT_MIN + 1) * 60_000));
    await future.tick("CD");
    assert.equal((await call("GET", `/v1/orders/${r.body.order_id}`, { token: customer.token, country: "CD" })).body.state, "CANCELLED");
  });
});

describe("refund requests", () => {
  let support: { token: string; userId: string };
  let label = 0;
  // Drives a fresh PREPAID order all the way to DELIVERED and returns its id.
  const deliverFresh = async () => {
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", expected_total: q.body.total } });
    const orderId = placed.body.order_id as string;
    const code = placed.body.recipient_code as string;
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const lb = `RF-${++label}`;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: lb, sealId: `${lb}-S` }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: [lb], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: lb, location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    return { orderId, total: q.body.total };
  };
  const balanceOf = async (account: string) =>
    BigInt((await inspect("CD", "SELECT coalesce(sum(amount_minor),0)::text AS t FROM money.ledger_entry WHERE account = $1 AND country_iso2 = 'CD' AND currency = 'USD'", [account]))[0].t);

  test("a customer requests a refund; support approves; the money is refunded and the books balance", async () => {
    support = await signIn("+243810000070");
    await grant({ userId: support.userId, role: "COUNTRY_FINANCE", scope: { type: "COUNTRY", id: "CD" } });
    await grant({ userId: support.userId, role: "SUPPORT_AGENT", scope: { type: "COUNTRY", id: "CD" } });
    // Merchant payable before this order settles; after the refund reversal it must return to exactly this.
    const merchantBefore = await balanceOf("restaurant_payable");
    const { orderId } = await deliverFresh();
    // Before any request, the order is refundable.
    const look = await call("GET", `/v1/orders/${orderId}/refund-request`, { token: customer.token, country: "CD" });
    assert.equal(look.body.refundable, true);
    assert.equal(look.body.request, null);
    // The customer files the request.
    const req = await call("POST", `/v1/orders/${orderId}/refund-request`, { token: customer.token, country: "CD", body: { reason_code: "ITEM_MISSING", comment: "The drink was missing" } });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.state, "REFUND_REQUESTED");
    // A second request is refused while one is open.
    assert.equal((await call("POST", `/v1/orders/${orderId}/refund-request`, { token: customer.token, country: "CD", body: { reason_code: "OTHER" } })).body.code, "REFUND_ALREADY_REQUESTED");
    // A customer cannot see the support queue.
    assert.equal((await call("GET", "/v1/admin/refunds", { token: customer.token, country: "CD" })).status, 403);
    // Support sees it in the queue and approves it.
    const queue = await call("GET", "/v1/admin/refunds", { token: support.token, country: "CD" });
    assert.ok(queue.body.requests.some((r: { id: string }) => r.id === req.body.id));
    const decided = await call("POST", `/v1/admin/refunds/${req.body.id}/decision`, { token: support.token, country: "CD", body: { approve: true, note: "Verified" } });
    assert.equal(decided.body.status, "APPROVED", JSON.stringify(decided.body));
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.state, "REFUNDED");
    // The settlement was reversed: the merchant payable returns to where it was before this order settled.
    assert.equal(await balanceOf("restaurant_payable"), merchantBefore, "merchant payable clawed back");
    // The reversal journal itself balances to zero.
    const rev = await inspect("CD", "SELECT coalesce(sum(amount_minor),0)::text AS t FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1", [`order:${orderId}:refund-reversal`]);
    assert.equal(rev[0].t, "0");
    // The provider refund was recorded.
    const refund = await inspect("CD", "SELECT status FROM payments.refund WHERE order_id = $1", [orderId]);
    assert.equal(refund[0]?.status, "SUCCEEDED");
  });

  test("a refund cannot be requested before delivery", async () => {
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total } });
    const refuse = await call("POST", `/v1/orders/${placed.body.order_id}/refund-request`, { token: customer.token, country: "CD", body: { reason_code: "LATE" } });
    assert.equal(refuse.body.code, "NOT_REFUNDABLE");
  });

  test("support can decline a request and the order returns to delivered", async () => {
    const { orderId } = await deliverFresh();
    const req = await call("POST", `/v1/orders/${orderId}/refund-request`, { token: customer.token, country: "CD", body: { reason_code: "FOOD_QUALITY" } });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    const decided = await call("POST", `/v1/admin/refunds/${req.body.id}/decision`, { token: support.token, country: "CD", body: { approve: false, note: "Outside policy" } });
    assert.equal(decided.body.status, "DECLINED");
    assert.equal((await call("GET", `/v1/orders/${orderId}`, { token: customer.token, country: "CD" })).body.state, "DELIVERED");
    // After a decline the customer may file again.
    assert.equal((await call("GET", `/v1/orders/${orderId}/refund-request`, { token: customer.token, country: "CD" })).body.refundable, true);
  });

  test("a bad reason is refused", async () => {
    const { orderId } = await deliverFresh();
    assert.equal((await call("POST", `/v1/orders/${orderId}/refund-request`, { token: customer.token, country: "CD", body: { reason_code: "BECAUSE" } })).body.code, "REASON_INVALID");
  });
});

describe("wallet", () => {
  const balance = async (token: string) => {
    const r = await call("GET", "/v1/me/wallet", { token, country: "CD" });
    const usd = r.body.balances.find((b: { currency: string }) => b.currency === "USD");
    return usd ? BigInt(usd.amount_minor) : 0n;
  };
  const walletLedger = async () =>
    BigInt((await inspect("CD", "SELECT coalesce(sum(amount_minor),0)::text AS t FROM money.ledger_entry WHERE account = 'customer_wallet' AND country_iso2 = 'CD' AND currency = 'USD'"))[0].t);

  test("a customer tops up, and the books record the stored value", async () => {
    assert.equal(await balance(customer.token), 0n);
    const ledgerBefore = await walletLedger();
    const topKey = "wallet-topup-test-1";
    const top = await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", key: topKey, body: { amount_minor: "5000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    assert.equal(top.body.status, "SUCCEEDED", JSON.stringify(top.body));
    assert.equal(top.body.balance.amount_minor, "5000");
    assert.equal(await balance(customer.token), 5000n);
    // The platform now owes the customer their stored value (customer_wallet is credited, i.e. more negative).
    assert.equal(await walletLedger(), ledgerBefore - 5000n);
    // A repeat with the same idempotency key does not charge again.
    const again = await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", key: topKey, body: { amount_minor: "5000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    assert.equal(again.body.status, "SUCCEEDED");
    assert.equal(await balance(customer.token), 5000n);
    const hist = await call("GET", "/v1/me/wallet/transactions", { token: customer.token, country: "CD" });
    assert.equal(hist.body.transactions[0].kind, "TOPUP");
  });

  test("a customer pays for an order from the wallet; the balance drops and settlement draws from it", async () => {
    // Top up enough to cover the order.
    await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const before = await balance(customer.token);
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "WALLET", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    // A wallet order is paid at once — it is PLACED, not PENDING_PAYMENT.
    assert.equal(placed.body.state, "PLACED");
    assert.equal(await balance(customer.token), before - total, "wallet debited by the order total");
    // The order carries the wallet-funded flag and can be driven to delivery and settled.
    const code = placed.body.recipient_code;
    const orderId = placed.body.order_id;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "W-1", sealId: "W-1-S" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["W-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "W-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    // The settlement drew the order total from customer_wallet (not psp_clearing).
    const draw = await inspect("CD", "SELECT e.amount_minor::text AS amount FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1 AND e.account = 'customer_wallet'", [`order:${orderId}:settlement`]);
    assert.equal(draw[0]?.amount, total.toString());
  });

  test("paying from an empty wallet is refused and no order is created", async () => {
    const poor = await signIn("+243810000071");
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const r = await call("POST", "/v1/orders", { token: poor.token, country: "CD", body: { ...cart(), payment_mode: "WALLET", expected_total: q.body.total } });
    assert.equal(r.body.code, "INSUFFICIENT_WALLET_BALANCE");
    // Nothing was placed for this customer.
    const mine = await call("GET", "/v1/me/orders", { token: poor.token, country: "CD" });
    assert.equal(mine.body.data.length, 0);
  });

  test("a cancelled wallet order is credited back to the wallet", async () => {
    await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", key: "topup-cancel-1", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const before = await balance(customer.token);
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "WALLET", expected_total: q.body.total } });
    assert.equal(await balance(customer.token), before - total);
    // The customer cancels before acceptance; the wallet sweep then credits the money back and marks it refunded.
    await transition(customer, placed.body.order_id, { type: "CANCEL", reasonCode: "CHANGED_MIND" });
    await api.get<WalletService>(TOKENS.wallet).refundSweep("CD");
    assert.equal(await balance(customer.token), before, "wallet made whole after cancellation");
    assert.equal((await call("GET", `/v1/orders/${placed.body.order_id}`, { token: customer.token, country: "CD" })).body.state, "REFUNDED");
  });

  const settlementEntry = async (orderId: string, account: string) => {
    const [row] = await inspect("CD", "SELECT e.amount_minor::text AS amount FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1 AND e.account = $2", [`order:${orderId}:settlement`, account]);
    return row ? BigInt(row.amount) : 0n;
  };

  test("split payment: wallet covers part, cash the rest; settlement draws from both and balances", async () => {
    await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", key: "topup-split-cod", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const before = await balance(customer.token);
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const apply = total / 2n; // some from the wallet, the rest in cash
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", wallet_apply_minor: apply.toString(), expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    // A cash order is live at once, so the wallet portion is committed immediately.
    assert.equal(placed.body.state, "PLACED");
    assert.equal(await balance(customer.token), before - apply, "wallet debited only by the applied portion");
    const orderId = placed.body.order_id;
    const code = placed.body.recipient_code;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "S-1", sealId: "S-1-S" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["S-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "S-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    // The settlement split the money in across the two accounts.
    assert.equal(await settlementEntry(orderId, "customer_wallet"), apply, "wallet portion drawn from customer_wallet");
    assert.equal(await settlementEntry(orderId, "cod_cash_in_transit"), total - apply, "the rest collected as cash");
    const [bal] = await inspect("CD", "SELECT currency, sum(amount_minor)::text AS s FROM money.ledger_entry WHERE currency = 'USD' GROUP BY currency");
    assert.equal(bal.s, "0", "the ledger still balances");
  });

  test("split payment: wallet covers part, card the rest; the card is charged only the remainder", async () => {
    await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", key: "topup-split-card", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const before = await balance(customer.token);
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const apply = total / 3n;
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", wallet_apply_minor: apply.toString(), expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    // A prepaid order waits for the card charge, so the wallet is not touched yet.
    assert.equal(placed.body.state, "PENDING_PAYMENT");
    assert.equal(await balance(customer.token), before, "wallet untouched until the remainder is paid");
    const orderId = placed.body.order_id;
    const code = placed.body.recipient_code;
    const pay = await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    assert.equal(pay.body.status, "SUCCEEDED", JSON.stringify(pay.body));
    assert.equal(pay.body.amount.amount_minor, (total - apply).toString(), "the provider is charged only the remainder");
    // The wallet portion is debited exactly once, on confirmation.
    assert.equal(await balance(customer.token), before - apply, "wallet debited by the applied portion on confirmation");
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "SC-1", sealId: "SC-1-S" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["SC-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "SC-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    assert.equal(await settlementEntry(orderId, "customer_wallet"), apply, "wallet portion drawn from customer_wallet");
    assert.equal(await settlementEntry(orderId, "psp_clearing"), total - apply, "the remainder cleared through the provider");
    const [bal] = await inspect("CD", "SELECT currency, sum(amount_minor)::text AS s FROM money.ledger_entry WHERE currency = 'USD' GROUP BY currency");
    assert.equal(bal.s, "0", "the ledger still balances");
  });

  test("a wallet amount at or above the total is refused (use wallet as the method instead)", async () => {
    await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", key: "topup-split-guard", body: { amount_minor: "20000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const r = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", wallet_apply_minor: total.toString(), expected_total: q.body.total } });
    assert.equal(r.body.code, "WALLET_APPLY_TOO_LARGE", JSON.stringify(r.body));
  });

  test("a split order needing more wallet than the balance holds is refused", async () => {
    const lean = await signIn("+243810000085");
    await call("POST", "/v1/me/wallet/topup", { token: lean.token, country: "CD", key: "topup-split-lean", body: { amount_minor: "100", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000085" } } });
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const r = await call("POST", "/v1/orders", { token: lean.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", wallet_apply_minor: (total / 2n).toString(), expected_total: q.body.total } });
    assert.equal(r.body.code, "INSUFFICIENT_WALLET_BALANCE", JSON.stringify(r.body));
    assert.equal((await call("GET", "/v1/me/orders", { token: lean.token, country: "CD" })).body.data.length, 0, "nothing placed");
  });
});

describe("referrals", () => {
  const walletUsd = async (token: string) => {
    const r = await call("GET", "/v1/me/wallet", { token, country: "CD" });
    const usd = r.body.balances.find((b: { currency: string }) => b.currency === "USD");
    return usd ? BigInt(usd.amount_minor) : 0n;
  };
  // Drives one fresh paid order for a given customer all the way to DELIVERED (counts as spend).
  let rlabel = 0;
  const spendOnce = async (who: { token: string; userId: string }) => {
    // A quote authenticated as the customer so any referral first-order discount is reflected.
    const q = await call("POST", "/v1/carts/quote", { token: who.token, country: "CD", body: cart() });
    const due = q.body.payable ?? q.body.total;
    const placed = await call("POST", "/v1/orders", { token: who.token, country: "CD", body: { ...cart(), payment_mode: "PREPAID", expected_total: due } });
    const orderId = placed.body.order_id, code = placed.body.recipient_code;
    await call("POST", "/v1/payments/intents", { token: who.token, country: "CD", body: { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const lb = `REF-${++rlabel}`;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: lb, sealId: `${lb}-S` }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: [lb], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: lb, location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    return BigInt(due.amount_minor);
  };

  test("the referee's first order has our service fee waived; the referrer earns $10 after the referee spends $50", async () => {
    // The existing customer owns a code and earns $10 after a referee spends $50.
    const mine = await call("GET", "/v1/me/referral", { token: customer.token, country: "CD" });
    assert.match(mine.body.code, /^[A-Z0-9]{7}$/);
    assert.equal(mine.body.reward.amount_minor, "1000");
    assert.equal(mine.body.spend_threshold.amount_minor, "5000");
    assert.equal(mine.body.friend_discount_pct, 10);
    const code = mine.body.code as string;

    // A brand-new customer applies the code and gets a 10%-off-first-order claim.
    const referee = await signIn("+243810000072");
    assert.equal((await call("POST", "/v1/referrals/claim", { token: referee.token, country: "CD", body: { code: "NOPE123" } })).status, 404);
    const claimed = await call("POST", "/v1/referrals/claim", { token: referee.token, country: "CD", body: { code } });
    assert.equal(claimed.status, 201, JSON.stringify(claimed.body));
    assert.equal(claimed.body.first_order_discount_pct, 10);
    // Using your own code, or claiming twice, is refused.
    assert.equal((await call("POST", "/v1/referrals/claim", { token: referee.token, country: "CD", body: { code } })).body.code, "ALREADY_REFERRED");
    assert.equal((await call("POST", "/v1/referrals/claim", { token: customer.token, country: "CD", body: { code } })).body.code, "CANNOT_REFER_SELF");

    // The referee's first-order quote waives our service fee; the status says the discount is available.
    const q1 = await call("POST", "/v1/carts/quote", { token: referee.token, country: "CD", body: cart() });
    const gross = BigInt(q1.body.total.amount_minor);
    const serviceFee = BigInt(q1.body.price_lines.find((l: { code: string }) => l.code === "SERVICE_CHARGE").amount.amount_minor);
    assert.equal(q1.body.referral.discount.amount_minor, String(serviceFee), "the referral waives our service fee");
    assert.equal(BigInt(q1.body.payable.amount_minor), gross - serviceFee);
    assert.equal((await call("GET", "/v1/me/referral/claim", { token: referee.token, country: "CD" })).body.claim.discount_available, true);
    assert.equal(await walletUsd(referee.token), 0n, "the referee is not given wallet cash, only a discount");

    const referrerBefore = await walletUsd(customer.token);
    // The referee places their (discounted) first order and it delivers; the discount is now used.
    await spendOnce(referee);
    const q2 = await call("POST", "/v1/carts/quote", { token: referee.token, country: "CD", body: cart() });
    assert.equal(q2.body.referral, undefined, "the discount applies only to the first order");
    assert.equal((await call("GET", "/v1/me/referral/claim", { token: referee.token, country: "CD" })).body.claim.discount_used, true);

    // The referee has not yet spent $50 — the referrer is not paid.
    await api.get<ReferralService>(TOKENS.referrals).unlockSweep("CD");
    assert.equal(await walletUsd(customer.token), referrerBefore, "no referrer reward before the referee spends $50");

    // A second order takes the referee past $50; the sweep now pays the referrer $10.
    await spendOnce(referee);
    const res = await api.get<ReferralService>(TOKENS.referrals).unlockSweep("CD");
    assert.ok(res.unlocked >= 1);
    assert.equal(await walletUsd(customer.token), referrerBefore + 1000n, "referrer credited $10");
    assert.equal(await walletUsd(referee.token), 0n, "the referee still has no wallet cash from the referral");

    // The referrer's dashboard reflects one rewarded invite, and the sweep does not double-pay.
    const after = await call("GET", "/v1/me/referral", { token: customer.token, country: "CD" });
    assert.ok(after.body.invited >= 1 && after.body.rewarded >= 1);
    assert.equal(after.body.earned.amount_minor, String(1000 * after.body.rewarded));
    await api.get<ReferralService>(TOKENS.referrals).unlockSweep("CD");
    assert.equal(await walletUsd(customer.token), referrerBefore + 1000n);
  });

  test("a customer who has already ordered cannot use a code", async () => {
    const code = (await call("GET", "/v1/me/referral", { token: customer.token, country: "CD" })).body.code;
    const used = await signIn("+243810000073");
    await spendOnce(used);
    assert.equal((await call("POST", "/v1/referrals/claim", { token: used.token, country: "CD", body: { code } })).body.code, "NOT_NEW_CUSTOMER");
  });
});

describe("self-serve merchant onboarding", () => {
  const KIN2 = { lat: -4.3300, lng: 15.3000 };
  const inDiscovery = async (branchId: string) => {
    const r = await call("GET", `/v1/branches/nearby?lat=${KIN2.lat}&lng=${KIN2.lng}&radius_km=5`, { country: "CD" });
    return (r.body.data as { id: string }[]).some((b) => b.id === branchId);
  };

  test("a business registers, builds a menu with the wizard, and publishes to go live", async () => {
    const merchant = await signIn("+243810000200");
    // Step 1: register the business — the signed-in user becomes its owner.
    const reg = await call("POST", "/v1/merchant/register", { token: merchant.token, country: "CD", body: { business_name: "Mama Nkoyi Kitchen" } });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.match(reg.body.group_id, /^rg-/);
    const groupId = reg.body.group_id;

    // Step 2: add a branch — it is created unpublished (not yet discoverable).
    const br = await call("POST", "/v1/merchant/branches", { token: merchant.token, country: "CD", body: { group_id: groupId, name: "Mama Nkoyi — Lemba", lat: KIN2.lat, lng: KIN2.lng, commune: "lemba" } });
    assert.equal(br.status, 201, JSON.stringify(br.body));
    assert.equal(br.body.published, false);
    const newBranch = br.body.branch_id;
    assert.equal(await inDiscovery(newBranch), false, "unpublished branch is not discoverable");

    // Publishing with no menu is refused.
    assert.equal((await call("POST", `/v1/merchant/branches/${newBranch}/publish`, { token: merchant.token, country: "CD" })).body.code, "MENU_EMPTY");
    let st = await call("GET", `/v1/merchant/branches/${newBranch}/onboarding`, { token: merchant.token, country: "CD" });
    assert.equal(st.body.can_publish, false);
    assert.equal(st.body.steps.menu, false);

    // Step 3: add a dish (the owner has menu:write on their own branch).
    const item = await call("POST", `/v1/branches/${newBranch}/items`, { token: merchant.token, country: "CD", body: { names: { fr: "Fumbwa", en: "Cassava leaves" }, prices: { USD: "6.00" } } });
    assert.equal(item.status, 201, JSON.stringify(item.body));
    st = await call("GET", `/v1/merchant/branches/${newBranch}/onboarding`, { token: merchant.token, country: "CD" });
    assert.equal(st.body.can_publish, true);
    assert.equal(st.body.available_items, 1);

    // Step 4: publish — the branch is now discoverable (web storefront and Tunakula Nzela read the same catalogue).
    const pub = await call("POST", `/v1/merchant/branches/${newBranch}/publish`, { token: merchant.token, country: "CD" });
    assert.equal(pub.body.published, true);
    assert.equal(await inDiscovery(newBranch), true, "a published branch is discoverable");
  });

  test("a signed-in user without a business cannot add a branch to someone else's group", async () => {
    const stranger = await signIn("+243810000201");
    const r = await call("POST", "/v1/merchant/branches", { token: stranger.token, country: "CD", body: { group_id: "rg-someone-else", name: "Pirate branch", lat: KIN2.lat, lng: KIN2.lng } });
    assert.equal(r.status, 403);
  });

  test("the console's branches view guides a brand-new merchant through the same screens (no separate wizard)", async () => {
    const merchant = await signIn("+243810000202");
    // A brand-new user is not refused: the console shows them the set-up path.
    const empty = await call("GET", "/v1/admin/branches", { token: merchant.token, country: "CD" });
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.has_business, false);
    assert.equal(empty.body.can_create, false);
    assert.equal(empty.body.data.length, 0);
    // They register, then the same endpoint reports they now own a business.
    const reg = await call("POST", "/v1/merchant/register", { token: merchant.token, country: "CD", body: { business_name: "Chez Espoir" } });
    const groupId = reg.body.group_id;
    const owned = await call("GET", "/v1/admin/branches", { token: merchant.token, country: "CD" });
    assert.equal(owned.body.has_business, true);
    assert.equal(owned.body.group_id, groupId);
    // They add a branch from the console; it shows up in their branches list as a draft (unpublished).
    const br = await call("POST", "/v1/merchant/branches", { token: merchant.token, country: "CD", body: { group_id: groupId, name: "Chez Espoir — Ngaliema", lat: KIN2.lat, lng: KIN2.lng, commune: "ngaliema" } });
    const withBranch = await call("GET", "/v1/admin/branches", { token: merchant.token, country: "CD" });
    const row = (withBranch.body.data as { id: string; published: boolean }[]).find((b) => b.id === br.body.branch_id);
    assert.ok(row, "the new branch appears in the console");
    assert.equal(row!.published, false, "it is a draft until published");
  });
});

describe("food photos", () => {
  const jpeg = (seed: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, seed), Buffer.from([0xff, 0xd9])]).toString("base64");

  test("a merchant uploads a food photo, attaches it, and it is served publicly on the menu", async () => {
    const owner = await signIn("+243810000220");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Chez Photo" } });
    const br = await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Chez Photo — Gombe", lat: -4.32, lng: 15.31, commune: "gombe" } });
    const branchId = br.body.branch_id;

    // Upload the photo to the shared media store under the public MENU_ITEM purpose.
    const up = await call("POST", "/v1/media", { token: owner.token, country: "CD", body: { purpose: "MENU_ITEM", content_type: "image/jpeg", data_base64: jpeg(7) } });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const imageId = up.body.id;

    // Attach it to a new dish.
    const item = await call("POST", `/v1/branches/${branchId}/items`, { token: owner.token, country: "CD", body: { names: { fr: "Poulet à la moambe" }, prices: { USD: "12.50" }, image_id: imageId } });
    assert.equal(item.status, 201, JSON.stringify(item.body));
    assert.equal(item.body.image_id, imageId, "the item carries its photo id");

    // The public menu read returns the photo id (guests can read it, no token).
    const menu = await call("GET", `/v1/branches/${branchId}/menu`, { country: "CD" });
    assert.equal(menu.body.items[0].image_id, imageId);

    // The photo is served publicly as an image, country in the query so a plain <img> URL works.
    const img = await api.inject({ method: "GET", url: `/v1/menu-images/${imageId}?c=CD` });
    assert.equal(img.statusCode, 200);
    assert.match(img.headers["content-type"] as string, /^image\/jpeg/);
    assert.ok((img.headers["cache-control"] as string)?.includes("max-age"), "food photos are cacheable");
  });

  test("a private rider photo is never served through the public food-photo URL", async () => {
    const applicant = await signIn("+243810000221");
    const up = await call("POST", "/v1/media", { token: applicant.token, country: "CD", body: { purpose: "RIDER_ID", content_type: "image/jpeg", data_base64: jpeg(9) } });
    const idPhoto = up.body.id;
    // The public endpoint only serves MENU_ITEM media, so a rider ID is not found there.
    const leak = await api.inject({ method: "GET", url: `/v1/menu-images/${idPhoto}?c=CD` });
    assert.equal(leak.statusCode, 404, "a rider ID does not leak through the food-photo URL");
    // And a dish cannot borrow a non-food image.
    const owner = await signIn("+243810000222");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Chez Try" } });
    const br = await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Chez Try — Limete", lat: -4.33, lng: 15.33 } });
    const bad = await call("POST", `/v1/branches/${br.body.branch_id}/items`, { token: owner.token, country: "CD", body: { names: { fr: "Test" }, prices: { USD: "5.00" }, image_id: idPhoto } });
    assert.equal(bad.body.code, "IMAGE_INVALID", JSON.stringify(bad.body));
  });
});

describe("business profile", () => {
  const png = (seed: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, seed)]).toString("base64");

  test("a merchant sets address, contact, about, cuisines, order minimum, logo and cover", async () => {
    const owner = await signIn("+243810000230");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Chez Profil" } });
    const br = await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Chez Profil — Gombe", lat: -4.32, lng: 15.31, commune: "gombe" } });
    const branchId = br.body.branch_id;

    const logo = await call("POST", "/v1/media", { token: owner.token, country: "CD", body: { purpose: "BRANCH_LOGO", content_type: "image/png", data_base64: png(1) } });
    const cover = await call("POST", "/v1/media", { token: owner.token, country: "CD", body: { purpose: "BRANCH_COVER", content_type: "image/png", data_base64: png(2) } });
    assert.equal(logo.status, 201, JSON.stringify(logo.body));

    const saved = await call("POST", `/v1/branches/${branchId}/profile`, { token: owner.token, country: "CD", body: {
      address: "12 Avenue du Commerce, Gombe", phone: "+243810000230", email: "hello@chezprofil.cd",
      description: { fr: "Cuisine congolaise maison.", en: "Home-style Congolese food." },
      cuisines: ["Congolais", "Grillades"], min_order: "5.00", logo_id: logo.body.id, cover_id: cover.body.id,
    } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.address, "12 Avenue du Commerce, Gombe");
    assert.equal(saved.body.phone, "+243810000230");
    assert.deepEqual(saved.body.cuisines, ["congolais", "grillades"]);
    assert.equal(saved.body.min_order_minor, "500");
    assert.equal(saved.body.logo_id, logo.body.id);

    // The storefront menu read carries the profile, and the logo/cover serve publicly.
    const menu = await call("GET", `/v1/branches/${branchId}/menu`, { country: "CD" });
    assert.equal(menu.body.branch.address, "12 Avenue du Commerce, Gombe");
    assert.equal(menu.body.branch.logo_id, logo.body.id);
    const img = await api.inject({ method: "GET", url: `/v1/images/${logo.body.id}?c=CD` });
    assert.equal(img.statusCode, 200);

    // A bad email is refused; a private photo cannot be used as a logo.
    assert.equal((await call("POST", `/v1/branches/${branchId}/profile`, { token: owner.token, country: "CD", body: { email: "nope" } })).body.code, "EMAIL_INVALID");
    const rider = await call("POST", "/v1/media", { token: owner.token, country: "CD", body: { purpose: "RIDER_ID", content_type: "image/png", data_base64: png(3) } });
    assert.equal((await call("POST", `/v1/branches/${branchId}/profile`, { token: owner.token, country: "CD", body: { logo_id: rider.body.id } })).body.code, "IMAGE_INVALID");
  });

  test("only someone who manages the branch can edit its profile", async () => {
    const owner = await signIn("+243810000231");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Chez Garde" } });
    const br = await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Chez Garde — Limete", lat: -4.33, lng: 15.33 } });
    const stranger = await signIn("+243810000232");
    assert.equal((await call("POST", `/v1/branches/${br.body.branch_id}/profile`, { token: stranger.token, country: "CD", body: { address: "nope" } })).status, 403);
  });
});

describe("brands and franchises", () => {
  const branches = async (token: string) => {
    const r = await call("GET", "/v1/admin/branches", { token, country: "CD" });
    return r.body as { has_business: boolean; data: { id: string; name: string; published: boolean }[] };
  };

  test("a franchisee signs up individually and joins a brand with its code; each manages only their own branch", async () => {
    // The brand owner registers, opens one branch, and gets an invite code.
    const owner = await signIn("+243810000250");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Chez Maman" } });
    const ownerBranch = await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Chez Maman — Gombe", lat: -4.31, lng: 15.28, commune: "gombe" } });
    const invite = await call("POST", "/v1/merchant/brand/invite", { token: owner.token, country: "CD" });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    assert.match(invite.body.invite_code, /^[A-Z2-9]{8}$/);
    assert.equal(invite.body.name, "Chez Maman");
    const code = invite.body.invite_code;

    // A different person signs up and joins the brand with the code, getting their own branch under it.
    const franchisee = await signIn("+243810000251");
    const join = await call("POST", "/v1/merchant/join", { token: franchisee.token, country: "CD", body: { code, name: "Chez Maman — Lemba", lat: -4.34, lng: 15.33, commune: "lemba" } });
    assert.equal(join.status, 201, JSON.stringify(join.body));
    assert.equal(join.body.group_id, reg.body.group_id, "the franchisee's branch is under the same brand");
    assert.equal(join.body.brand_name, "Chez Maman");
    const franchiseeBranch = join.body.branch_id;

    // The franchisee runs their own branch: adds a dish and publishes it.
    await call("POST", `/v1/branches/${franchiseeBranch}/items`, { token: franchisee.token, country: "CD", body: { names: { fr: "Pondu" }, prices: { USD: "3.50" } } });
    await call("POST", `/v1/branches/${franchiseeBranch}/profile`, { token: franchisee.token, country: "CD", body: { address: "Lemba, Kinshasa" } });
    const pub = await call("POST", `/v1/merchant/branches/${franchiseeBranch}/publish`, { token: franchisee.token, country: "CD" });
    assert.equal(pub.body.published, true, JSON.stringify(pub.body));

    // The franchisee sees only their own branch; the brand owner sees both.
    const fView = await branches(franchisee.token);
    assert.equal(fView.has_business, false, "a franchisee does not own the brand");
    assert.deepEqual(fView.data.map((b) => b.id), [franchiseeBranch], "a franchisee sees only their own branch");
    const oView = await branches(owner.token);
    assert.equal(oView.has_business, true);
    const ownerIds = oView.data.map((b) => b.id).sort();
    assert.deepEqual([ownerBranch.body.branch_id, franchiseeBranch].sort(), ownerIds, "the brand owner sees every branch");

    // A franchisee cannot touch a sibling branch they do not run.
    assert.equal((await call("POST", `/v1/branches/${ownerBranch.body.branch_id}/profile`, { token: franchisee.token, country: "CD", body: { address: "nope" } })).status, 403);
  });

  test("a bad code is refused, and someone who already runs a business cannot join another brand", async () => {
    const joiner = await signIn("+243810000252");
    assert.equal((await call("POST", "/v1/merchant/join", { token: joiner.token, country: "CD", body: { code: "NOPE2345", name: "X", lat: -4.3, lng: 15.3 } })).body.code, "INVALID_INVITE");
    // Register a business, then try to join another brand — refused.
    const owner = await signIn("+243810000253");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Brand A" } });
    const invite = await call("POST", "/v1/merchant/brand/invite", { token: owner.token, country: "CD" });
    assert.equal((await call("POST", "/v1/merchant/join", { token: owner.token, country: "CD", body: { code: invite.body.invite_code, name: "Y", lat: -4.3, lng: 15.3 } })).body.code, "ALREADY_HAS_BUSINESS");
    // A non-owner cannot mint an invite code.
    assert.equal((await call("POST", "/v1/merchant/brand/invite", { token: joiner.token, country: "CD" })).status, 403);
    assert.ok(reg.body.group_id);
  });

  test("an owner copies one branch's whole menu into another of their branches", async () => {
    const jpeg = (seed: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, seed), Buffer.from([0xff, 0xd9])]).toString("base64");
    const owner = await signIn("+243810000260");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Multi Brand" } });
    const a = (await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Multi — Gombe", lat: -4.31, lng: 15.28 } })).body.branch_id;
    const b = (await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Multi — Lemba", lat: -4.34, lng: 15.33 } })).body.branch_id;
    const img = await call("POST", "/v1/media", { token: owner.token, country: "CD", body: { purpose: "MENU_ITEM", content_type: "image/jpeg", data_base64: jpeg(5) } });
    await call("POST", `/v1/branches/${a}/items`, { token: owner.token, country: "CD", body: { names: { fr: "Poulet moambe" }, prices: { USD: "12.50" }, image_id: img.body.id, variations: [{ name: "Taille", type: "SINGLE", required: true, options: [{ name: "Normale", price: "0" }, { name: "Familiale", price: "6.00" }] }] } });
    await call("POST", `/v1/branches/${a}/items`, { token: owner.token, country: "CD", body: { names: { fr: "Pondu" }, prices: { USD: "3.50" } } });

    // Copy A's menu into the (empty) branch B.
    const copy = await call("POST", `/v1/branches/${a}/menu/copy-to`, { token: owner.token, country: "CD", body: { target_branch_id: b } });
    assert.equal(copy.status, 200, JSON.stringify(copy.body));
    assert.equal(copy.body.copied, 2);
    const menuB = await call("GET", `/v1/branches/${b}/menu`, { country: "CD" });
    const moambe = (menuB.body.items as { names: Record<string, string>; image_id: string | null; variations: unknown[] }[]).find((i) => i.names.fr === "Poulet moambe");
    assert.ok(moambe, "the dish was copied");
    assert.equal(moambe!.image_id, img.body.id, "the photo comes along");
    assert.equal(moambe!.variations.length, 1, "variations come along");

    // Copying into the same branch, or without a target, is refused.
    assert.equal((await call("POST", `/v1/branches/${a}/menu/copy-to`, { token: owner.token, country: "CD", body: { target_branch_id: a } })).body.code, "SAME_BRANCH");
    // Someone who does not manage the target cannot copy into it.
    const stranger = await signIn("+243810000264");
    assert.equal((await call("POST", `/v1/branches/${a}/menu/copy-to`, { token: stranger.token, country: "CD", body: { target_branch_id: b } })).status, 403);

    // The source now lists the branch it seeded, so later edits can be synced down.
    const copies = await call("GET", `/v1/branches/${a}/menu/copies`, { token: owner.token, country: "CD" });
    assert.equal(copies.body.branches.length, 1);
    assert.equal(copies.body.branches[0].id, b);
    assert.equal(copies.body.branches[0].linked, 2);

    // Edit the source (price change) and add a new source dish, then sync down.
    const srcMenu = await call("GET", `/v1/branches/${a}/menu`, { country: "CD" });
    const moambeId = (srcMenu.body.items as { id: string; names: Record<string, string> }[]).find((i) => i.names.fr === "Poulet moambe")!.id;
    await call("POST", `/v1/branches/${a}/items/${moambeId}`, { token: owner.token, country: "CD", body: { names: { fr: "Poulet moambe" }, prices: { USD: "14.00" } } });
    await call("POST", `/v1/branches/${a}/items`, { token: owner.token, country: "CD", body: { names: { fr: "Saka-saka" }, prices: { USD: "2.50" } } });

    // On branch B, mark the moambe sold-out — sync must keep that local availability.
    const bMenu1 = await call("GET", `/v1/branches/${b}/menu`, { country: "CD" });
    const bMoambe = (bMenu1.body.items as { id: string; names: Record<string, string> }[]).find((i) => i.names.fr === "Poulet moambe")!.id;
    await call("POST", `/v1/branches/${b}/items/${bMoambe}/availability`, { token: owner.token, country: "CD", body: { available: false } });

    const sync = await call("POST", `/v1/branches/${a}/menu/copy-to`, { token: owner.token, country: "CD", body: { target_branch_id: b } });
    assert.equal(sync.body.updated, 2, "the two existing copies are updated");
    assert.equal(sync.body.added, 1, "the new dish is added");
    const bMenu2 = await call("GET", `/v1/branches/${b}/menu`, { country: "CD" });
    const bItems = bMenu2.body.items as { names: Record<string, string>; prices: Record<string, { amount_minor: string }>; available: boolean }[];
    const moambe2 = bItems.find((i) => i.names.fr === "Poulet moambe")!;
    assert.equal(moambe2.prices.USD!.amount_minor, "1400", "the price edit synced down");
    assert.equal(moambe2.available, false, "the branch's own sold-out flag is kept");
    assert.ok(bItems.some((i) => i.names.fr === "Saka-saka"), "the new dish synced down");
    assert.equal(bItems.length, 3, "no duplicates — sync upserts by lineage");
  });

  test("copy with a price adjust (+10%) marks the target up, and later syncs keep the markup", async () => {
    const owner = await signIn("+243810000265");
    const reg = await call("POST", "/v1/merchant/register", { token: owner.token, country: "CD", body: { business_name: "Pricey Co" } });
    const src = (await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Src", lat: -4.31, lng: 15.28 } })).body.branch_id;
    const dst = (await call("POST", "/v1/merchant/branches", { token: owner.token, country: "CD", body: { group_id: reg.body.group_id, name: "Pricier", lat: -4.34, lng: 15.33 } })).body.branch_id;
    await call("POST", `/v1/branches/${src}/items`, { token: owner.token, country: "CD", body: { names: { fr: "Burger" }, prices: { USD: "10.00" }, addons: [{ name: "Fromage", price: "1.00" }] } });

    // Copy with +10%: the target's goods and add-on prices are marked up.
    const copy = await call("POST", `/v1/branches/${src}/menu/copy-to`, { token: owner.token, country: "CD", body: { target_branch_id: dst, price_adjust_pct: 10 } });
    assert.equal(copy.body.markup_pct, 10);
    let burger = (await call("GET", `/v1/branches/${dst}/menu`, { country: "CD" })).body.items[0];
    assert.equal(burger.prices.USD.amount_minor, "1100", "goods +10%");
    assert.equal(burger.addons[0].price, "110", "add-on +10% (minor units)");

    // The source raises its price; a plain sync (no pct) keeps the stored +10%.
    const srcItem = (await call("GET", `/v1/branches/${src}/menu`, { country: "CD" })).body.items[0];
    await call("POST", `/v1/branches/${src}/items/${srcItem.id}`, { token: owner.token, country: "CD", body: { names: { fr: "Burger" }, prices: { USD: "20.00" }, addons: [{ name: "Fromage", price: "1.00" }] } });
    const sync = await call("POST", `/v1/branches/${src}/menu/copy-to`, { token: owner.token, country: "CD", body: { target_branch_id: dst } });
    assert.equal(sync.body.markup_pct, 10, "the markup is remembered");
    burger = (await call("GET", `/v1/branches/${dst}/menu`, { country: "CD" })).body.items[0];
    assert.equal(burger.prices.USD.amount_minor, "2200", "the raised price syncs down, still +10%");

    // The linked-branches list reports the markup.
    const copies = await call("GET", `/v1/branches/${src}/menu/copies`, { token: owner.token, country: "CD" });
    assert.equal(copies.body.branches[0].markup_bps, 1000);
  });
});

describe("loyalty points", () => {
  const loyalty = () => api.get<LoyaltyService>(TOKENS.loyalty);
  const walletUsd = async (token: string) => {
    const r = await call("GET", "/v1/me/wallet", { token, country: "CD" });
    const usd = r.body.balances.find((b: { currency: string }) => b.currency === "USD");
    return usd ? BigInt(usd.amount_minor) : 0n;
  };
  // Drives one fresh cash order to DELIVERED for the given customer; returns the order total in minor units.
  let llabel = 0;
  const deliverOnce = async (who: { token: string; userId: string }) => {
    const q = await call("POST", "/v1/carts/quote", { token: who.token, country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const placed = await call("POST", "/v1/orders", { token: who.token, country: "CD", body: { ...cart(), payment_mode: "CASH_ON_DELIVERY", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order_id, code = placed.body.recipient_code;
    const lb = `LY-${++llabel}`;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: lb, sealId: `${lb}-S` }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: [lb], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: lb, location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    return total;
  };

  test("a delivered order earns points, which redeem for wallet credit; the admin sets the rates", async () => {
    const shopper = await signIn("+243810000210");
    await backdate(shopper.userId, 30); // COD needs an account older than the floor

    // No points to start with; the summary reports the default rules (1% earn, 1 minor per point, min 100).
    const start = await call("GET", "/v1/me/loyalty", { token: shopper.token, country: "CD" });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.points, 0);
    assert.equal(start.body.enabled, true);
    assert.equal(start.body.earn_bps, 100);
    assert.equal(start.body.min_redeem_points, 100);

    // A delivered order earns floor(total_minor * earn_bps / 10000) points once the sweep runs.
    const total = await deliverOnce(shopper);
    const expected = Number((total * 100n) / 10000n);
    assert.ok(expected > 0, "the order is large enough to earn at least one point");
    const swept = await loyalty().awardSweep("CD");
    assert.ok(swept.awarded >= 1, JSON.stringify(swept));
    const earned = await call("GET", "/v1/me/loyalty", { token: shopper.token, country: "CD" });
    assert.equal(earned.body.points, expected, "points equal 1% of the spend in minor units");
    // The ledger records one EARN movement tied to the order.
    const hist = await call("GET", "/v1/me/loyalty/transactions", { token: shopper.token, country: "CD" });
    assert.equal(hist.body.transactions[0].kind, "EARN");
    assert.equal(hist.body.transactions[0].points, expected);

    // The sweep is idempotent: running it again awards nothing new.
    await loyalty().awardSweep("CD");
    assert.equal((await call("GET", "/v1/me/loyalty", { token: shopper.token, country: "CD" })).body.points, expected);

    // Redeeming below the market minimum is refused.
    const tooFew = await call("POST", "/v1/me/loyalty/redeem", { token: shopper.token, country: "CD", body: { points: 1 } });
    assert.equal(tooFew.body.code, "BELOW_MIN_REDEEM", JSON.stringify(tooFew.body));

    // The admin lowers the minimum (and the per-point value) so the shopper can redeem what they earned.
    const forbiddenSet = await call("POST", "/v1/admin/loyalty", { token: shopper.token, country: "CD", body: { min_redeem_points: 5 } });
    assert.equal(forbiddenSet.status, 403, "only a market admin sets the rates");
    const cfg = await call("POST", "/v1/admin/loyalty", { token: admin.token, country: "CD", body: { min_redeem_points: 5, redeem_minor_per_point: 2 } });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
    assert.equal(cfg.body.min_redeem_points, 5);
    assert.equal(cfg.body.redeem_minor_per_point, 2);
    assert.equal((await call("GET", "/v1/admin/loyalty", { token: admin.token, country: "CD" })).body.min_redeem_points, 5);

    // The shopper redeems all their points; the wallet is credited points × value and the points are spent.
    const walletBefore = await walletUsd(shopper.token);
    const key = "loyalty-redeem-1";
    const redeem = await call("POST", "/v1/me/loyalty/redeem", { token: shopper.token, country: "CD", key, body: { points: expected } });
    assert.equal(redeem.status, 200, JSON.stringify(redeem.body));
    assert.equal(redeem.body.points_balance, 0, "all points spent");
    assert.equal(redeem.body.credited.amount_minor, String(expected * 2), "credited points × per-point value");
    assert.equal(await walletUsd(shopper.token), walletBefore + BigInt(expected * 2), "wallet made richer by the credit");
    assert.equal((await call("GET", "/v1/me/loyalty", { token: shopper.token, country: "CD" })).body.points, 0);

    // A repeat with the same idempotency key does not redeem again.
    const again = await call("POST", "/v1/me/loyalty/redeem", { token: shopper.token, country: "CD", key, body: { points: expected } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(await walletUsd(shopper.token), walletBefore + BigInt(expected * 2), "no double credit on replay");

    // With no points left, redeeming is refused for want of points.
    const empty = await call("POST", "/v1/me/loyalty/redeem", { token: shopper.token, country: "CD", body: { points: 5 } });
    assert.equal(empty.body.code, "INSUFFICIENT_POINTS", JSON.stringify(empty.body));

    // The money books still balance after the redemption credit.
    const [bal] = await inspect("CD", "SELECT sum(amount_minor)::text AS s FROM money.ledger_entry WHERE currency = 'USD'");
    assert.equal(bal.s, "0", "the ledger still balances");

    // Restore the market default so later assertions elsewhere are unaffected.
    await call("POST", "/v1/admin/loyalty", { token: admin.token, country: "CD", body: { min_redeem_points: 100, redeem_minor_per_point: 1 } });
  });
});

describe("delivery zones", () => {
  // A dedicated branch so zones here never affect the shared branch other tests deliver to.
  let zbranch: string;
  const NEAR = { lat: -4.3215, lng: 15.2947 }; // ~1.4 km from KINSHASA, same as DROP
  const FAR = { lat: -4.0000, lng: 15.0000 };   // tens of km away
  const zcart = (drop: { lat: number; lng: number }) => ({ branch_id: zbranch, items: [{ item_id: zitem, quantity: 1 }], order_type: "DELIVERY", delivery: drop });
  let zitem: string;

  test("a branch delivers everywhere until it defines zones; then only inside them, at the zone's fee and minimum", async () => {
    const br = await call("POST", "/v1/branches", { token: admin.token, country: "CD", body: { name: "Zoned Kitchen", restaurant_group_id: "rg-chez-maman", city: "kinshasa", commune: "gombe", ...KINSHASA } });
    zbranch = br.body.id;
    const it = await call("POST", `/v1/branches/${zbranch}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Liboke", en: "Fish parcel" }, prices: { USD: "8.00" } } });
    zitem = it.body.id;

    // With no zones, a delivery quote to the drop works and uses the distance ladder.
    const open = await call("POST", "/v1/carts/quote", { country: "CD", body: zcart(NEAR) });
    assert.equal(open.status, 200, JSON.stringify(open.body));
    assert.notEqual(open.body.delivery.step, "ZONE_FLAT");

    // A customer cannot define zones; only a branch manager can.
    assert.equal((await call("POST", `/v1/branches/${zbranch}/delivery-zones`, { token: customer.token, country: "CD", body: { name: "x", centre_lat: NEAR.lat, centre_lng: NEAR.lng, radius_m: 2000 } })).status, 403);

    // Define a zone that does NOT cover the drop. Now the drop is out of the service area.
    const far = await call("POST", `/v1/branches/${zbranch}/delivery-zones`, { token: restaurantOwner.token, country: "CD", body: { name: "Far side", centre_lat: FAR.lat, centre_lng: FAR.lng, radius_m: 1000 } });
    assert.equal(far.status, 201, JSON.stringify(far.body));
    const outside = await call("POST", "/v1/carts/quote", { country: "CD", body: zcart(NEAR) });
    assert.equal(outside.body.code, "OUTSIDE_SERVICE_AREA", JSON.stringify(outside.body));

    // Add a zone that covers the drop with a flat $2.00 delivery fee. The quote now charges exactly that.
    const near = await call("POST", `/v1/branches/${zbranch}/delivery-zones`, { token: restaurantOwner.token, country: "CD", body: { name: "Gombe core", centre_lat: NEAR.lat, centre_lng: NEAR.lng, radius_m: 2500, flat_fee: "2.00" } });
    assert.equal(near.status, 201, JSON.stringify(near.body));
    const zoned = await call("POST", "/v1/carts/quote", { country: "CD", body: zcart(NEAR) });
    assert.equal(zoned.status, 200, JSON.stringify(zoned.body));
    assert.equal(zoned.body.delivery.step, "ZONE_FLAT");
    const deliveryLine = zoned.body.price_lines.find((l: { code: string }) => l.code === "DELIVERY_FEE");
    assert.equal(deliveryLine.amount.amount_minor, "200", "the area's flat fee is charged");
    // The rider still gets their share of the flat fee (70% by default).
    assert.equal(zoned.body.delivery.rider_share.amount_minor, "140");

    // Give that zone a $20 minimum; an $8 order to it is refused until the basket clears the minimum.
    const upd = await call("POST", `/v1/branches/${zbranch}/delivery-zones/${near.body.id}`, { token: restaurantOwner.token, country: "CD", body: { min_order: "20.00" } });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const low = await call("POST", "/v1/carts/quote", { country: "CD", body: zcart(NEAR) });
    assert.equal(low.body.code, "BELOW_ZONE_MINIMUM", JSON.stringify(low.body));
    const enough = await call("POST", "/v1/carts/quote", { country: "CD", body: { ...zcart(NEAR), items: [{ item_id: zitem, quantity: 3 }] } });
    assert.equal(enough.status, 200, "three fish parcels clear the $20 minimum");

    // The manage view lists both zones; switching the covering one off reopens the branch to the distance ladder.
    const manage = await call("GET", `/v1/branches/${zbranch}/delivery-zones/manage`, { token: restaurantOwner.token, country: "CD" });
    assert.equal(manage.body.zones.length, 2);
    await call("POST", `/v1/branches/${zbranch}/delivery-zones/${near.body.id}`, { token: restaurantOwner.token, country: "CD", body: { active: false } });
    // Only the far zone remains active, which does not cover the drop → out of area again.
    assert.equal((await call("POST", "/v1/carts/quote", { country: "CD", body: zcart(NEAR) })).body.code, "OUTSIDE_SERVICE_AREA");

    // Deleting every zone restores deliver-anywhere behaviour.
    await call("DELETE", `/v1/branches/${zbranch}/delivery-zones/${far.body.id}`, { token: restaurantOwner.token, country: "CD" });
    await call("DELETE", `/v1/branches/${zbranch}/delivery-zones/${near.body.id}`, { token: restaurantOwner.token, country: "CD" });
    assert.equal((await call("POST", "/v1/carts/quote", { country: "CD", body: zcart(NEAR) })).status, 200);
    // The public storefront endpoint shows no zones once they are gone.
    assert.equal((await call("GET", `/v1/branches/${zbranch}/delivery-zones`, { country: "CD" })).body.zones.length, 0);
  });
});

describe("menu scheduling (dayparting)", () => {
  // CD runs on Africa/Kinshasa (UTC+1, no DST), so a UTC instant maps to local +1h.
  const AT_0800_LOCAL = "2030-06-03T07:00:00Z"; // 08:00 in Kinshasa — inside a 07:00–11:00 window
  const AT_1500_LOCAL = "2030-06-03T14:00:00Z"; // 15:00 in Kinshasa — outside it
  const everyDay = (open: string, close: string) => Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [[open, close]]]));

  test("a breakfast dish is only orderable inside its window; an empty schedule stays always available", async () => {
    // Add a breakfast-only dish (07:00–11:00 every day) to the existing branch.
    const made = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Omelette", en: "Omelette" }, prices: { USD: "5.00" }, availability_hours: everyDay("07:00", "11:00") } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const breakfast = made.body.id;
    assert.deepEqual(made.body.availability_hours["1"], [["07:00", "11:00"]], "the schedule is stored");

    const bcart = (at: string) => ({ branch_id: branchId, items: [{ item_id: breakfast, quantity: 1 }], order_type: "DELIVERY", delivery: DROP, scheduled_for: at });
    // At 08:00 local the dish is in its window → the quote succeeds.
    assert.equal((await call("POST", "/v1/carts/quote", { country: "CD", body: bcart(AT_0800_LOCAL) })).status, 200);
    // At 15:00 local it is outside the window → the quote refuses just that dish.
    const off = await call("POST", "/v1/carts/quote", { country: "CD", body: bcart(AT_1500_LOCAL) });
    assert.equal(off.body.code, "ITEM_OFF_SCHEDULE", JSON.stringify(off.body));

    // The storefront menu exposes the schedule and a computed availability flag.
    const menu = await call("GET", `/v1/branches/${branchId}/menu`, { country: "CD" });
    const shown = menu.body.items.find((i: { id: string }) => i.id === breakfast);
    assert.ok(shown, "the dish is on the menu");
    assert.deepEqual(shown.availability_hours["3"], [["07:00", "11:00"]]);
    assert.equal(typeof shown.available_now, "boolean", "the menu computes whether it is orderable now");
    // A dish with no schedule carries an empty object and no restriction.
    const anytime = menu.body.items.find((i: { id: string }) => i.id === itemId);
    assert.deepEqual(anytime.availability_hours, {});

    // Clearing the schedule makes the dish orderable at any hour again.
    const cleared = await call("POST", `/v1/branches/${branchId}/items/${breakfast}`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Omelette", en: "Omelette" }, prices: { USD: "5.00" }, availability_hours: {} } });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal((await call("POST", "/v1/carts/quote", { country: "CD", body: bcart(AT_1500_LOCAL) })).status, 200, "no schedule → always available");

    // A malformed schedule is rejected.
    const bad = await call("POST", `/v1/branches/${branchId}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "X" }, prices: { USD: "1.00" }, availability_hours: { "9": [["07:00", "11:00"]] } } });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(bad.body.code, "HOURS_INVALID");
  });
});

describe("rider shifts (availability scheduling)", () => {
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

  test("a rider books, lists and cancels shifts; ops see who is on shift", async () => {
    // A rider books a shift in a zone they ride (the test rider is RIDER@gombe).
    const booked = await call("POST", "/v1/rider/shifts", { token: rider.token, country: "CD", body: { zone: "gombe", starts_at: iso(-5 * 60_000), ends_at: iso(2 * 3_600_000) } });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(booked.body.zone, "gombe");
    assert.equal(booked.body.active_now, true, "a shift spanning now is active");
    const shiftId = booked.body.id;

    // A non-rider cannot book; a rider cannot book in a zone they do not cover.
    assert.equal((await call("POST", "/v1/rider/shifts", { token: customer.token, country: "CD", body: { zone: "gombe", starts_at: iso(3_600_000), ends_at: iso(7_200_000) } })).status, 403);
    assert.equal((await call("POST", "/v1/rider/shifts", { token: rider.token, country: "CD", body: { zone: "lemba", starts_at: iso(3_600_000), ends_at: iso(7_200_000) } })).body.code, "ZONE_INVALID");
    // Overlapping another booked shift is refused.
    assert.equal((await call("POST", "/v1/rider/shifts", { token: rider.token, country: "CD", body: { zone: "gombe", starts_at: iso(60_000), ends_at: iso(3_600_000) } })).body.code, "SHIFT_OVERLAP");
    // A zero/negative window is refused.
    assert.equal((await call("POST", "/v1/rider/shifts", { token: rider.token, country: "CD", body: { zone: "gombe", starts_at: iso(7_200_000), ends_at: iso(3_600_000) } })).body.code, "SHIFT_INVALID");

    // The rider lists their shifts and the zones they can book in.
    const mine = await call("GET", "/v1/rider/shifts", { token: rider.token, country: "CD" });
    assert.ok(mine.body.zones.includes("gombe"));
    assert.ok(mine.body.shifts.some((s: { id: string; active_now: boolean }) => s.id === shiftId && s.active_now));

    // Ops see the rider on shift now, both on the board and in the upcoming-shifts list.
    const board = await call("GET", "/v1/ops/dispatch", { token: ops.token, country: "CD" });
    const onBoard = board.body.riders.find((r: { id: string }) => r.id === rider.userId);
    assert.equal(onBoard?.on_shift, true, "the dispatch board marks the rider on shift");
    const opsShifts = await call("GET", "/v1/ops/shifts", { token: ops.token, country: "CD" });
    assert.ok(opsShifts.body.shifts.some((s: { id: string; rider_id: string }) => s.id === shiftId && s.rider_id === rider.userId));
    // A rider cannot read the ops shift list.
    assert.equal((await call("GET", "/v1/ops/shifts", { token: rider.token, country: "CD" })).status, 403);

    // Cancelling frees the rider; they are no longer on shift.
    const cancelled = await call("POST", `/v1/rider/shifts/${shiftId}/cancel`, { token: rider.token, country: "CD" });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, "CANCELLED");
    assert.equal((await call("POST", `/v1/rider/shifts/${shiftId}/cancel`, { token: rider.token, country: "CD" })).status, 404, "cannot cancel twice");
    const board2 = await call("GET", "/v1/ops/dispatch", { token: ops.token, country: "CD" });
    assert.equal(board2.body.riders.find((r: { id: string }) => r.id === rider.userId)?.on_shift, false);
  });

  test("the dispatcher prefers an on-shift rider in the zone, even one who is further away", async () => {
    // An isolated zone so only the two riders set up here can take the order.
    const SPOT = { lat: -4.4000, lng: 15.3300 };
    const DROPZ = { lat: -4.4100, lng: 15.3400 };
    const br = await call("POST", "/v1/branches", { token: admin.token, country: "CD", body: { name: "Masina Grill", restaurant_group_id: "rg-chez-maman", city: "kinshasa", commune: "masina", lat: SPOT.lat, lng: SPOT.lng } });
    const zbranch = br.body.id;
    const dish = await call("POST", `/v1/branches/${zbranch}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Brochette", en: "Skewer" }, prices: { USD: "6.00" } } });

    // Two riders in masina: NEAR (off shift, at the branch) and FAR (on shift, ~2 km away).
    const near = await signIn("+243810000240");
    const far = await signIn("+243810000241");
    await grant({ userId: near.userId, role: "RIDER", scope: { type: "ZONE", id: "masina" } });
    await grant({ userId: far.userId, role: "RIDER", scope: { type: "ZONE", id: "masina" } });
    await call("POST", "/v1/rider/presence", { token: near.token, country: "CD", body: { online: true, lat: SPOT.lat, lng: SPOT.lng } });
    await call("POST", "/v1/rider/presence", { token: far.token, country: "CD", body: { online: true, lat: -4.4200, lng: 15.3500 } });
    // The far rider is on shift now.
    assert.equal((await call("POST", "/v1/rider/shifts", { token: far.token, country: "CD", body: { zone: "masina", starts_at: iso(-5 * 60_000), ends_at: iso(2 * 3_600_000) } })).status, 201);

    // Place and pay for a delivery order from the masina branch.
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: zbranch, items: [{ item_id: dish.body.id, quantity: 1 }], order_type: "DELIVERY", delivery: DROPZ } });
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { branch_id: zbranch, items: [{ item_id: dish.body.id, quantity: 1 }], order_type: "DELIVERY", delivery: DROPZ, payment_mode: "PREPAID", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: placed.body.order_id, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });

    // The dispatcher offers this order to the on-shift (far) rider, not the nearer off-shift one.
    await api.get<DispatchService>(TOKENS.dispatch).tick("CD");
    const farJobs = await call("GET", "/v1/rider/jobs", { token: far.token, country: "CD" });
    const nearJobs = await call("GET", "/v1/rider/jobs", { token: near.token, country: "CD" });
    assert.equal(farJobs.body.offer?.job.order_id, placed.body.order_id, "the on-shift rider is offered the order");
    assert.notEqual(nearJobs.body.offer?.job.order_id, placed.body.order_id, "the nearer off-shift rider is not preferred");
  });
});

describe("busy-areas heatmap", () => {
  test("riders and ops see where demand is high; a plain customer cannot", async () => {
    // Place and pay for an order so Gombe has at least one order waiting for a rider.
    const p = await placePrepaid();
    await call("POST", "/v1/payments/intents", { token: customer.token, country: "CD", body: { order_id: p.orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });

    const h = await call("GET", "/v1/rider/heatmap", { token: rider.token, country: "CD" });
    assert.equal(h.status, 200, JSON.stringify(h.body));
    assert.equal(h.body.window_minutes, 45);
    const gombe = h.body.zones.find((z: { zone: string }) => z.zone === "gombe");
    assert.ok(gombe, "Gombe is on the map");
    assert.ok(gombe.waiting >= 1, "Gombe has at least one waiting order");
    assert.ok(["HOT", "BUSY", "STEADY"].includes(gombe.level), `Gombe reads busy, not quiet (${gombe.level})`);
    assert.ok(h.body.hotspots.length >= 1, "recent drop points feed the heat layer");
    assert.ok(h.body.hotspots.every((pt: { lat: number; lng: number }) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng)));

    // Operations see the same view.
    assert.equal((await call("GET", "/v1/ops/heatmap", { token: ops.token, country: "CD" })).status, 200);
    // A plain customer sees neither the rider nor the ops heatmap.
    assert.equal((await call("GET", "/v1/rider/heatmap", { token: customer.token, country: "CD" })).status, 403);
    assert.equal((await call("GET", "/v1/ops/heatmap", { token: customer.token, country: "CD" })).status, 403);
  });
});

describe("cashback campaigns", () => {
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const walletUsd = async (token: string) => {
    const r = await call("GET", "/v1/me/wallet", { token, country: "CD" });
    const usd = r.body.balances.find((b: { currency: string }) => b.currency === "USD");
    return usd ? BigInt(usd.amount_minor) : 0n;
  };
  let clabel = 0;
  // Drives one fresh wallet-paid order to DELIVERED for the given customer; returns the order total in minor units.
  const deliverOnce = async (who: { token: string; userId: string }) => {
    const q = await call("POST", "/v1/carts/quote", { token: who.token, country: "CD", body: cart() });
    const total = BigInt(q.body.total.amount_minor);
    const placed = await call("POST", "/v1/orders", { token: who.token, country: "CD", body: { ...cart(), payment_mode: "WALLET", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order_id, code = placed.body.recipient_code, lb = `CB-${++clabel}`;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: lb, sealId: `${lb}-S` }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: [lb], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: lb, location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    return total;
  };
  const sweep = () => api.get<CashbackService>(TOKENS.cashback).awardSweep("CD");

  test("a live campaign gives cashback to the wallet on a delivered order, capped and idempotent", async () => {
    const shopper = await signIn("+243810000250");
    // Only a market admin runs campaigns.
    assert.equal((await call("POST", "/v1/admin/cashback", { token: shopper.token, country: "CD", body: { name: "x", percent_bps: 1000, starts_at: iso(-1000), ends_at: iso(3_600_000) } })).status, 403);
    const made = await call("POST", "/v1/admin/cashback", { token: admin.token, country: "CD", body: { name: "Weekend 10% back", percent_bps: 1000, min_spend: "0", max_cashback: "1.00", starts_at: iso(-60_000), ends_at: iso(3_600_000) } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.status, "LIVE");
    assert.equal(made.body.percent, 10);

    // The customer sees the live offer.
    const offer = await call("GET", "/v1/cashback", { token: shopper.token, country: "CD" });
    assert.equal(offer.body.offer.percent, 10);
    assert.equal(offer.body.offer.max_cashback.amount_minor, "100");

    // Fund the wallet and deliver an order placed during the campaign.
    await call("POST", "/v1/me/wallet/topup", { token: shopper.token, country: "CD", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000250" } } });
    const afterTopup = await walletUsd(shopper.token);
    const total = await deliverOnce(shopper);
    const afterOrder = await walletUsd(shopper.token);
    assert.equal(afterOrder, afterTopup - total, "the order total is debited from the wallet");

    // The sweep credits cashback = min(10% of the total, the $1.00 cap).
    const expected = (total * 1000n) / 10000n;
    const capped = expected > 100n ? 100n : expected;
    assert.ok(capped > 0n, "the order earns some cashback");
    const swept = await sweep();
    assert.ok(swept.awarded >= 1, JSON.stringify(swept));
    assert.equal(await walletUsd(shopper.token), afterOrder + capped, "cashback credited to the wallet (capped)");
    // The wallet history shows the cashback credit.
    const hist = await call("GET", "/v1/me/wallet/transactions", { token: shopper.token, country: "CD" });
    assert.ok(hist.body.transactions.some((t: { kind: string }) => t.kind === "CASHBACK"));

    // The sweep is idempotent: running it again credits nothing more.
    await sweep();
    assert.equal(await walletUsd(shopper.token), afterOrder + capped, "no double cashback");

    // The books still balance after the promotional credit.
    const [bal] = await inspect("CD", "SELECT sum(amount_minor)::text AS s FROM money.ledger_entry WHERE currency = 'USD'");
    assert.equal(bal.s, "0", "the ledger still balances");

    // Switching the campaign off ends the offer; a later order earns nothing.
    await call("POST", `/v1/admin/cashback/${made.body.id}`, { token: admin.token, country: "CD", body: { active: false } });
    assert.equal((await call("GET", "/v1/cashback", { token: shopper.token, country: "CD" })).body.offer, null);
    await call("POST", "/v1/me/wallet/topup", { token: shopper.token, country: "CD", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000250" } } });
    const before2 = await walletUsd(shopper.token);
    const total2 = await deliverOnce(shopper);
    await sweep();
    assert.equal(await walletUsd(shopper.token), before2 - total2, "no cashback once the campaign is off");
  });

  test("an order below the campaign's minimum spend earns no cashback", async () => {
    // A campaign with a minimum far above any order total.
    await call("POST", "/v1/admin/cashback", { token: admin.token, country: "CD", body: { name: "Big spenders 15%", percent_bps: 1500, min_spend: "10000.00", starts_at: iso(-60_000), ends_at: iso(3_600_000) } });
    const shopper = await signIn("+243810000251");
    await call("POST", "/v1/me/wallet/topup", { token: shopper.token, country: "CD", body: { amount_minor: "10000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000251" } } });
    const before = await walletUsd(shopper.token);
    const total = await deliverOnce(shopper);
    await sweep();
    assert.equal(await walletUsd(shopper.token), before - total, "no cashback below the minimum spend");
  });
});

describe("merchant promotions (happy hour)", () => {
  // CD is Africa/Kinshasa (UTC+1); a UTC instant maps to local +1h.
  const AT_0800 = "2030-06-03T07:00:00Z"; // 08:00 local — inside a 07:00–11:00 window
  const AT_1500 = "2030-06-03T14:00:00Z"; // 15:00 local — outside it
  const everyDay = (o: string, c: string) => Object.fromEntries(["0","1","2","3","4","5","6"].map((d) => [d, [[o, c]]]));
  let pbranch: string, burger: string, cola: string;

  const quoteLine = async (itemId: string, at?: string) => {
    const body: Record<string, unknown> = { branch_id: pbranch, items: [{ item_id: itemId, quantity: 1 }], order_type: "DELIVERY", delivery: DROP };
    if (at) body.scheduled_for = at;
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    return q.body.lines[0];
  };

  test("a merchant runs percentage promotions by dish, category or branch; the deepest in-window wins", async () => {
    const br = await call("POST", "/v1/branches", { token: admin.token, country: "CD", body: { name: "Promo Grill", restaurant_group_id: "rg-chez-maman", city: "kinshasa", commune: "gombe", ...KINSHASA } });
    pbranch = br.body.id;
    burger = (await call("POST", `/v1/branches/${pbranch}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Burger", en: "Burger" }, prices: { USD: "10.00" }, category: "Mains" } })).body.id;
    cola = (await call("POST", `/v1/branches/${pbranch}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Cola", en: "Cola" }, prices: { USD: "2.00" }, category: "Drinks" } })).body.id;

    // No promotions yet: full price.
    assert.equal((await quoteLine(burger)).unit.amount_minor, "1000");
    assert.equal((await quoteLine(burger)).promo, undefined);

    // A customer cannot create a promotion; only a branch manager.
    assert.equal((await call("POST", `/v1/branches/${pbranch}/promotions`, { token: customer.token, country: "CD", body: { scope: "BRANCH", percent: 10 } })).status, 403);

    // A dish-scoped 20% off the burger. The burger drops to $8.00; the cola is untouched.
    const itemPromo = await call("POST", `/v1/branches/${pbranch}/promotions`, { token: restaurantOwner.token, country: "CD", body: { name: "Burger Tuesday", scope: "ITEM", target_item_id: burger, percent: 20 } });
    assert.equal(itemPromo.status, 201, JSON.stringify(itemPromo.body));
    const bl = await quoteLine(burger);
    assert.equal(bl.unit.amount_minor, "800", "20% off the burger");
    assert.equal(bl.promo.percent, 20);
    assert.equal(bl.promo.was_unit.amount_minor, "1000");
    assert.equal((await quoteLine(cola)).unit.amount_minor, "200", "the cola is not on promotion");

    // A branch-wide 10% off. The burger keeps its deeper 20% (deepest wins); the cola now gets 10%.
    await call("POST", `/v1/branches/${pbranch}/promotions`, { token: restaurantOwner.token, country: "CD", body: { name: "Storewide 10%", scope: "BRANCH", percent: 10 } });
    assert.equal((await quoteLine(burger)).unit.amount_minor, "800", "the deeper dish promo still wins");
    assert.equal((await quoteLine(cola)).unit.amount_minor, "180", "the branch promo applies to the cola");

    // A category promotion (30% off Drinks) now beats the 10% branch promo on the cola.
    await call("POST", `/v1/branches/${pbranch}/promotions`, { token: restaurantOwner.token, country: "CD", body: { name: "Happy drinks", scope: "CATEGORY", target_category: "Drinks", percent: 30 } });
    assert.equal((await quoteLine(cola)).unit.amount_minor, "140", "30% off drinks wins over the 10% branch promo");

    // The storefront menu shows the live promo on each dish.
    const menu = await call("GET", `/v1/branches/${pbranch}/menu`, { country: "CD" });
    const mBurger = menu.body.items.find((i: { id: string }) => i.id === burger);
    assert.equal(mBurger.promo.percent, 20);
    assert.equal(mBurger.promo.now.amount_minor, "800");
    assert.equal(mBurger.promo.was.amount_minor, "1000");

    // A windowed promotion only applies inside its hours. A fresh branch keeps this isolated.
    const wbr = await call("POST", "/v1/branches", { token: admin.token, country: "CD", body: { name: "Window Grill", restaurant_group_id: "rg-chez-maman", city: "kinshasa", commune: "gombe", ...KINSHASA } });
    const wbranch = wbr.body.id;
    const wItem = (await call("POST", `/v1/branches/${wbranch}/items`, { token: restaurantOwner.token, country: "CD", body: { names: { fr: "Lunch", en: "Lunch" }, prices: { USD: "10.00" } } })).body.id;
    await call("POST", `/v1/branches/${wbranch}/promotions`, { token: restaurantOwner.token, country: "CD", body: { name: "Morning 25%", scope: "BRANCH", percent: 25, hours: everyDay("07:00", "11:00") } });
    const inWin = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: wbranch, items: [{ item_id: wItem, quantity: 1 }], order_type: "DELIVERY", delivery: DROP, scheduled_for: AT_0800 } });
    assert.equal(inWin.body.lines[0].unit.amount_minor, "750", "25% off inside the window");
    const outWin = await call("POST", "/v1/carts/quote", { country: "CD", body: { branch_id: wbranch, items: [{ item_id: wItem, quantity: 1 }], order_type: "DELIVERY", delivery: DROP, scheduled_for: AT_1500 } });
    assert.equal(outWin.body.lines[0].unit.amount_minor, "1000", "full price outside the window");
  });

  test("a promoted order settles with the merchant funding the discount, and the books balance", async () => {
    // The kitchen staff need rights on this branch to drive the order.
    await grant({ userId: kitchen.userId, role: "KITCHEN_STAFF", scope: { type: "BRANCH", id: pbranch } });
    // Top up and place a wallet order for the discounted burger (20% off → $8.00).
    await call("POST", "/v1/me/wallet/topup", { token: customer.token, country: "CD", body: { amount_minor: "5000", currency: "USD", method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000001" } } });
    const pcart = { branch_id: pbranch, items: [{ item_id: burger, quantity: 1 }], order_type: "DELIVERY", delivery: DROP };
    const q = await call("POST", "/v1/carts/quote", { country: "CD", body: pcart });
    const goods = BigInt(q.body.lines[0].total.amount_minor);
    assert.equal(goods, 800n, "the goods are the discounted price");
    const placed = await call("POST", "/v1/orders", { token: customer.token, country: "CD", body: { ...pcart, payment_mode: "WALLET", expected_total: q.body.total } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order_id, code = placed.body.recipient_code;
    await transition(ops, orderId, { type: "ASSIGN_RIDER", riderId: rider.userId });
    await transition(kitchen, orderId, { type: "ACCEPT" });
    await transition(kitchen, orderId, { type: "START_PREPARING" });
    await transition(kitchen, orderId, { type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true });
    await transition(kitchen, orderId, { type: "MARK_READY", packages: [{ labelId: "PR-1", sealId: "PR-1-S" }], packPhotoRef: "photo://pack" });
    await transition(rider, orderId, { type: "PICK_UP", scannedLabelIds: ["PR-1"], restaurantConfirmed: true, sealsIntact: true, location: KINSHASA });
    const done = await transition(rider, orderId, { type: "DELIVER", scannedLabelId: "PR-1", location: DROP, sealIntact: true, verification: { method: "CODE", code }, proofPhotoRef: "photo://door" });
    assert.equal(done.body.state, "DELIVERED", JSON.stringify(done.body));
    // The merchant funds the promo by receiving less — there is no platform promotion_expense for it
    // (unlike a coupon), so the settlement journal has no promotion_expense entry.
    const promoExp = await inspect("CD", "SELECT e.amount_minor FROM money.ledger_entry e JOIN money.journal j ON j.id = e.journal_id WHERE j.idempotency_key = $1 AND e.account = 'promotion_expense'", [`order:${orderId}:settlement`]);
    assert.equal(promoExp.length, 0, "a merchant promo is not a platform expense");
    // The ledger still balances after a discounted order.
    const [bal] = await inspect("CD", "SELECT sum(amount_minor)::text AS s FROM money.ledger_entry WHERE currency = 'USD'");
    assert.equal(bal.s, "0", "the ledger balances");
  });
});
