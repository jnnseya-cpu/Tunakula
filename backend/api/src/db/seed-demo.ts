/**
 * Demo data for the admin console: a published Kinshasa market, five sample merchants, staff, riders,
 * customers and 30 days of orders. Development and demos only — never run against production.
 *
 *   DATABASE_OWNER_URL=postgres://tunakula:…@localhost/tunakula_demo \
 *   DATABASE_URL=postgres://tunakula_app:…@localhost/tunakula_demo \
 *   npm run seed:demo -w @tunakula/api -- [--admin +243810000000]
 *
 * It drives the real API in process with a controllable clock, so every order passes the same
 * validation, pricing, custody gates, payments and ledger postings as a live one. Orders are
 * deterministic (seeded random): the same run gives the same history.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { DevOtpOutbox } from "../app/auth.ts";
import { createApi } from "../http/app.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../modules/config/config-registry.ts";
import { loadVersions, saveVersions } from "../persistence/config.ts";
import { addBinding, type NewBinding } from "../persistence/identity.ts";
import { connect } from "./db.ts";
import { migrate } from "./migrate.ts";

const ownerUrl = process.env["DATABASE_OWNER_URL"];
const appUrl = process.env["DATABASE_URL"];
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_URL are required");
const argAdmin = process.argv.indexOf("--admin");
const ADMIN_PHONE = argAdmin > 0 ? (process.argv[argAdmin + 1] as string) : "+243810000000";
const DAYS = 30;

// Deterministic randomness.
let seed = 20261004;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = <T,>(xs: readonly T[]): T => xs.at(Math.floor(rand() * xs.length)) as T;
const chance = (p: number) => rand() < p;

const MERCHANTS = [
  { name: "Chez Mama Pauline", group: "rg-mama-pauline", commune: "gombe", lat: -4.3045, lng: 15.3085, weight: 5, items: [["Poulet à la moambe", "Chicken moambe", "16.00", ["peanuts"]], ["Liboke ya mbisi", "River fish in leaves", "18.00", ["fish"]], ["Pondu na makayabu", "Cassava leaves", "9.00", ["fish"]], ["Riz parfumé", "Rice", "3.00", []], ["Jus de gingembre", "Ginger juice", "2.00", []]] },
  { name: "Malewa ya Limete", group: "rg-malewa-limete", commune: "limete", lat: -4.3600, lng: 15.3390, weight: 4, items: [["Pondu na makayabu", "Cassava leaves", "9.00", ["fish"]], ["Fumbwa ya ngolo", "Wild spinach and catfish", "8.00", ["peanuts", "fish"]], ["Makemba na ndunda", "Plantain and beans", "6.00", []], ["Chikwangue", "Kwanga", "1.50", []]] },
  { name: "Brochettes Kintambo", group: "rg-brochettes-kintambo", commune: "kintambo", lat: -4.3270, lng: 15.2780, weight: 3, items: [["Brochettes de chèvre", "Goat skewers", "12.00", []], ["Thomson braisé", "Grilled mackerel", "15.00", ["fish"]], ["Liboke ya mbika", "Pumpkin seed parcels", "10.00", []], ["Makemba frits", "Fried plantain", "4.00", []]] },
  { name: "Boulangerie Victoire", group: "rg-boulangerie-victoire", commune: "kalamu", lat: -4.3420, lng: 15.3120, weight: 3, items: [["Baguette", "Baguette", "1.00", ["gluten"]], ["Mikate (6)", "Beignets, six", "2.50", ["gluten"]], ["Pain de mie", "Sandwich loaf", "3.50", ["gluten"]]] },
  { name: "Marché Express Ngaliema", group: "rg-marche-express", commune: "ngaliema", lat: -4.3480, lng: 15.2490, weight: 2, items: [["Panier de fruits", "Fruit basket", "15.00", []], ["Riz long grain 5 kg", "Rice 5 kg", "22.00", []], ["Panier de la semaine", "Week's basket", "65.00", []]] },
] as const;

const RIDERS = ["Patrick M.", "Benjamin K.", "Stone L.", "Dime M.", "Gérôme T.", "Salem B.", "Sylvia N.", "Héritier K."];
const FIRST = ["Grâce", "Josué", "Merveille", "Christelle", "Patient", "Ruth", "Exaucé", "Dorcas", "Glody", "Benedicte", "Fiston", "Nadège", "Trésor", "Jonathan", "Gloire", "Plamedi", "Divine", "Rachel", "Junior", "Prisca"];
/** Orders per hour of day (Kinshasa time): lunch and evening peaks. */
const HOURLY = [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 4, 7, 10, 9, 5, 3, 3, 4, 7, 10, 9, 6, 3, 1];

async function main() {
  const applied = await migrate(ownerUrl as string, process.env["DATABASE_APP_ROLE"] ?? "tunakula_app");
  console.log(applied.length ? `migrated: ${applied.join(", ")}` : "schema up to date");
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("SELECT set_config('app.country', 'CD', false)"); // FORCE RLS applies to the owner too
  const [{ n }] = (await owner.query("SELECT count(*)::int AS n FROM ordering.order_event")).rows;
  if (n > 0) throw new Error("This database already has orders; seed a fresh database");
  const db = connect(appUrl as string, { max: 4 });

  // Market: the CD profile, made production-shaped for the demo, published with a full review.
  const registry = new CountryConfigRegistry({
    brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
    connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
    apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
  });
  registry.restore(await db.tx({}, loadVersions));
  if (!registry.published("CD")) {
    const doc = syntheticProfileDocument("cd");
    delete doc["synthetic"];
    doc["country"].status = "LIVE";
    doc["compliance"].data_residency = "africa-south1";
    const draft = registry.saveDraft("seed", doc);
    registry.publish("seed", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "demo", at: new Date() }])));
    await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  }

  let clock = new Date(Date.now() - DAYS * 86_400_000);
  const otp = new DevOtpOutbox();
  const sandbox = new SandboxConnector({
    id: "sandbox",
    capabilities: [{ methodType: "MOBILE_MONEY_PUSH", countries: ["CD"], currencies: ["USD", "CDF"], limits: [], flow: "ASYNC", refund: "PARTIAL", payout: true, settlement: { currency: "USD", delayDays: 1 }, fees: { percentBps: 150 } }],
  });
  const api = await createApi({ db, registry, connectors: [sandbox], tokenSecret: "seed-only-secret-seed-only-secret-0001", otp, now: () => clock, onError: (e) => console.error(e) });

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const headers: Record<string, string> = { "x-country": "CD" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (method !== "GET") headers["idempotency-key"] = randomUUID();
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.inject({ method: method as "GET", url, headers, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
  };
  const signIn = async (phone: string, name: string) => {
    await call("POST", "/v1/auth/otp/request", undefined, { phone });
    const r = await call("POST", "/v1/auth/otp/verify", undefined, { phone, code: otp.sent.get(phone), display_name: name });
    if (r.status !== 200) throw new Error(`sign-in ${phone}: ${JSON.stringify(r.body)}`);
    return { token: r.body.token as string, id: r.body.user_id as string };
  };
  const grant = (b: NewBinding) => db.tx({}, (sql) => addBinding(sql, b));

  // People.
  const admin = await signIn(ADMIN_PHONE, "Super Admin");
  await grant({ userId: admin.id, role: "SUPER_ADMIN", scope: { type: "GROUP" } });
  const countryAdmin = await signIn("+243810100001", "Aimée (country admin)");
  await grant({ userId: countryAdmin.id, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "CD" } });
  const finance = await signIn("+243810100002", "Grace (finance)");
  await grant({ userId: finance.id, role: "COUNTRY_FINANCE", scope: { type: "COUNTRY", id: "CD" } });
  const ops = await signIn("+243810100003", "Junior (city ops)");
  await grant({ userId: ops.id, role: "CITY_OPS", scope: { type: "CITY", id: "kinshasa" } });
  const compliance = await signIn("+243810100004", "Ruth (compliance)");
  await grant({ userId: compliance.id, role: "COMPLIANCE_OFFICER", scope: { type: "GROUP" } });

  const branches: { id: string; owner: { token: string; id: string }; kitchen: { token: string; id: string }; items: { id: string; price: number; allergens: number }[]; weight: number; commune: string; lat: number; lng: number }[] = [];
  for (const [i, m] of MERCHANTS.entries()) {
    const ownerUser = await signIn(`+24381020000${i}`, `${m.name} (owner)`);
    await grant({ userId: ownerUser.id, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: m.group } });
    const b = await call("POST", "/v1/branches", countryAdmin.token, { name: m.name, restaurant_group_id: m.group, city: "kinshasa", commune: m.commune, lat: m.lat, lng: m.lng });
    if (b.status !== 201) throw new Error(JSON.stringify(b.body));
    const kitchen = await signIn(`+24381030000${i}`, `${m.name} (kitchen)`);
    await grant({ userId: kitchen.id, role: "KITCHEN_STAFF", scope: { type: "BRANCH", id: b.body.id } });
    const items = [];
    for (const [fr, en, usd, allergens] of m.items) {
      const r = await call("POST", `/v1/branches/${b.body.id}/items`, ownerUser.token, { names: { fr, en }, prices: { USD: usd }, allergens });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      items.push({ id: r.body.id as string, price: Number(usd), allergens: allergens.length });
    }
    branches.push({ id: b.body.id, owner: ownerUser, kitchen, items, weight: m.weight, commune: m.commune, lat: m.lat, lng: m.lng });
  }
  const riders = [];
  for (const [i, name] of RIDERS.entries()) {
    const r = await signIn(`+24381040000${i}`, name);
    for (const m of MERCHANTS) await grant({ userId: r.id, role: "RIDER", scope: { type: "ZONE", id: m.commune } });
    riders.push(r);
  }
  const customers = [];
  for (let i = 0; i < 60; i++) customers.push(await signIn(`+2438150${String(i).padStart(5, "0")}`, `${pick(FIRST)} ${String.fromCharCode(65 + (i % 26))}.`));
  // Accounts are older than the order history (cash on delivery needs a minimum account age).
  await owner.query("UPDATE identity.app_user SET created_at = now() - interval '60 days'");

  const weighted = branches.flatMap((b) => Array.from({ length: b.weight }, () => b));
  const at = (dayStart: Date, minutes: number) => new Date(dayStart.getTime() + minutes * 60_000);
  let made = 0;
  const outcomes: Record<string, number> = {};
  const tally = (k: string) => (outcomes[k] = (outcomes[k] ?? 0) + 1);

  for (let d = DAYS; d >= 0; d--) {
    // Kinshasa is UTC+1: local midnight = 23:00 UTC the day before.
    const day = new Date(Date.now() - d * 86_400_000);
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - 3_600_000);
    const weekday = new Date(dayStart.getTime() + 3_600_000).getUTCDay();
    const growth = 0.6 + 0.4 * ((DAYS - d) / DAYS); // the market grows over the month
    const volume = Math.round((weekday === 5 || weekday === 6 ? 1.35 : weekday === 0 ? 1.2 : 1) * growth * 22);
    for (let k = 0; k < volume; k++) {
      // Pick an hour by the daily curve.
      let roll = rand() * HOURLY.reduce((s, h) => s + h, 0), hour = 0;
      while (roll > (HOURLY.at(hour) ?? 0)) roll -= HOURLY.at(hour++) ?? 0;
      const start = at(dayStart, hour * 60 + Math.floor(rand() * 60));
      if (start.getTime() > Date.now() - 45 * 60_000 && d === 0) continue; // nothing in the last 45 minutes
      const b = pick(weighted);
      const customer = pick(customers);
      const lines = [{ item_id: pick(b.items).id, quantity: 1 + Math.floor(rand() * 2) }];
      if (chance(0.5)) {
        const extra = pick(b.items);
        if (extra.id !== lines[0]!.item_id) lines.push({ item_id: extra.id, quantity: 1 });
      }
      const cod = chance(0.12);
      const drop = { lat: b.lat + (rand() - 0.5) * 0.05, lng: b.lng + (rand() - 0.5) * 0.05 };
      const cart = { branch_id: b.id, items: lines, order_type: chance(0.1) ? "TAKEAWAY" : "DELIVERY", delivery: drop };
      clock = start;
      const q = await call("POST", "/v1/carts/quote", undefined, cart);
      if (q.status !== 200) continue;
      const placed = await call("POST", "/v1/orders", customer.token, { ...cart, payment_mode: cod ? "CASH_ON_DELIVERY" : "PREPAID", expected_total: q.body.total });
      if (placed.status !== 201) { tally(`place:${placed.body.code}`); continue; }
      const orderId = placed.body.order_id as string;
      const code = placed.body.recipient_code as string;
      made++;
      if (!cod) {
        clock = at(start, 1);
        const fail = chance(0.06);
        sandbox.defaultOutcome = fail ? "INSUFFICIENT_FUNDS" : "SUCCEED";
        await call("POST", "/v1/payments/intents", customer.token, { order_id: orderId, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: "+243810000000" } });
        sandbox.defaultOutcome = "SUCCEED";
        if (fail) { tally("payment_failed"); continue; }
      }
      const t = (who: { token: string }, minutes: number, command: Record<string, unknown>) => {
        clock = at(start, minutes);
        return call("POST", `/v1/orders/${orderId}/transitions`, who.token, { command });
      };
      const recent = start.getTime() > Date.now() - 2 * 3_600_000;
      if (chance(0.07)) { await t(customer, 3, { type: "CANCEL", reasonCode: "CHANGED_MIND" }); tally("cancelled"); continue; }
      const isDelivery = cart.order_type === "DELIVERY";
      const rider = pick(riders);
      if (isDelivery) await t(ops, 2, { type: "ASSIGN_RIDER", riderId: rider.id });
      if (chance(0.03)) { await t(b.kitchen, 4, { type: "REJECT", reasonCode: "KITCHEN_CLOSED" }); tally("rejected"); continue; }
      await t(b.kitchen, 4, { type: "ACCEPT" });
      if (recent && chance(0.5)) { tally("open"); continue; }
      const prep = 10 + Math.floor(rand() * 18);
      await t(b.kitchen, 6, { type: "START_PREPARING" });
      await t(b.kitchen, 6 + prep, { type: "PACK", confirmedLineIds: lines.map((_, i) => `l${i + 1}`), packageCount: 1, allergenAcknowledged: true });
      await t(b.kitchen, 8 + prep, { type: "MARK_READY", packages: [{ labelId: `L-${orderId.slice(-6)}`, sealId: `S-${orderId.slice(-6)}` }], packPhotoRef: "photo://pack" });
      if (!isDelivery) {
        const r = await t(b.kitchen, 20 + prep, { type: "DELIVER", verification: { method: "CODE", code }, sealIntact: true });
        tally(r.status === 200 ? "collected" : `collect:${r.body.code}`);
        continue;
      }
      await t(rider, 12 + prep, { type: "PICK_UP", scannedLabelIds: [`L-${orderId.slice(-6)}`], restaurantConfirmed: true, sealsIntact: true, location: { lat: b.lat, lng: b.lng } });
      const travel = 8 + Math.floor(rand() * 25);
      const r = await t(rider, 12 + prep + travel, { type: "DELIVER", scannedLabelId: `L-${orderId.slice(-6)}`, location: drop, verification: { method: "CODE", code }, sealIntact: true });
      tally(r.status === 200 ? "delivered" : `deliver:${r.body.code}`);
    }
  }
  await api.close();
  await db.close();
  await owner.end();
  console.log(JSON.stringify({ orders: made, outcomes, sign_in: { super_admin: ADMIN_PHONE, country_admin: "+243810100001", finance: "+243810100002", city_ops: "+243810100003", compliance: "+243810100004", restaurant_owner: "+243810200000" } }, null, 2));
}

await main();
