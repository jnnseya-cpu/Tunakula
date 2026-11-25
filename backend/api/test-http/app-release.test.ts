/**
 * App-release gate over HTTP: the public requirements check, the admin set (authorized like Integrations), and the
 * onRequest enforcement guard that 426s a client below a mandatory floor — the cutover kill-switch. Needs Postgres.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import type { ConnectorCapability } from "@tunakula/ts-contracts";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { DevOtpOutbox } from "../src/app/auth.ts";
import { testDatabase } from "../src/db/testing.ts";
import type { Db } from "../src/db/db.ts";
import { createApi } from "../src/http/app.ts";
import { addBinding } from "../src/persistence/identity.ts";
import { loadVersions, saveVersions } from "../src/persistence/config.ts";
import { CountryConfigRegistry, GROUP_INTERNAL_BRAND, READINESS_AREAS, TUNAKULA_BRAND } from "../src/index.ts";

const cap = (): ConnectorCapability => ({ methodType: "MOBILE_MONEY_PUSH", countries: ["CD"], currencies: ["USD", "CDF"], limits: [], flow: "ASYNC", refund: "PARTIAL", payout: true, settlement: { currency: "USD", delayDays: 1 }, fees: { percentBps: 150 } });

let api: NestFastifyApplication;
let db: Db;
let drop: () => Promise<void>;
const otp = new DevOtpOutbox();
let admin: { token: string };
let customer: { token: string };

type Res = { status: number; body: any };
async function call(method: string, url: string, opts: { token?: string; country?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.country) headers["x-country"] = opts.country;
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; headers["idempotency-key"] = headers["idempotency-key"] ?? crypto.randomUUID(); }
  const r = await api.inject({ method: method as "GET", url, headers, ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
async function signIn(phone: string): Promise<{ token: string; userId: string }> {
  await call("POST", "/v1/auth/otp/request", { body: { phone } });
  const code = otp.sent.get(phone) as string;
  const r = await call("POST", "/v1/auth/otp/verify", { body: { phone, code, display_name: phone.slice(-4) } });
  return { token: r.body.token, userId: r.body.user_id };
}

before(async () => {
  const t = await testDatabase();
  db = t.db; drop = t.drop;
  const opts = { brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } };
  const registry = new CountryConfigRegistry(opts);
  const doc = syntheticProfileDocument("cd"); delete doc.synthetic; doc.country.status = "LIVE"; doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("admin", doc);
  registry.publish("ceo", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "ceo", at: new Date() }])));
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  const restored = new CountryConfigRegistry(opts); restored.restore(await db.tx({}, loadVersions));
  api = await createApi({ db, registry: restored, connectors: [new SandboxConnector({ id: "bitripay", capabilities: [cap()], webhookSecret: "whsec-test" }), new SandboxConnector({ id: "sandbox", capabilities: [cap()] })], tokenSecret: "test-secret-test-secret-test-secret!!", otp, onError: () => {} });
  const a = await signIn("+243810000201");
  customer = await signIn("+243810000202");
  await db.tx({}, (sql) => addBinding(sql, { userId: a.userId, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "CD" } }));
  admin = a;
});
after(async () => { await api?.close(); await drop?.(); });

test("requirements: with no floor configured, any client is ok", async () => {
  const r = await call("GET", "/v1/app/requirements?app=customer&platform=android&version=1.0.0");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
});

test("requirements: unknown app or platform is a 400", async () => {
  assert.equal((await call("GET", "/v1/app/requirements?app=nope&platform=android&version=1.0.0")).status, 400);
  assert.equal((await call("GET", "/v1/app/requirements?app=customer&platform=watch&version=1.0.0")).status, 400);
});

test("a market admin sets a floor; an outsider cannot", async () => {
  const body = { app: "customer", platform: "android", min_supported: "2.0.0", latest: "2.3.0", store_url: "https://play.google.com/store/apps/details?id=com.tunakula.customer", mandatory: true, message: "A new Tunakula is here — please update." };
  assert.equal((await call("POST", "/v1/admin/app-releases", { token: customer.token, country: "CD", body })).status, 403);
  const r = await call("POST", "/v1/admin/app-releases", { token: admin.token, country: "CD", body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.releases.find((x: any) => x.app === "customer" && x.platform === "android");
  assert.equal(row.min_supported, "2.0.0");
  assert.equal(row.mandatory, true);
});

test("a bad version in a set is rejected", async () => {
  assert.equal((await call("POST", "/v1/admin/app-releases", { token: admin.token, country: "CD", body: { app: "rider", platform: "ios", min_supported: "banana" } })).status, 400);
});

test("requirements now reflects the floor: old=required, mid=optional, current=ok", async () => {
  assert.equal((await call("GET", "/v1/app/requirements?app=customer&platform=android&version=1.9.0")).body.status, "update_required");
  assert.equal((await call("GET", "/v1/app/requirements?app=customer&platform=android&version=2.1.0")).body.status, "update_optional");
  assert.equal((await call("GET", "/v1/app/requirements?app=customer&platform=android&version=2.3.0")).body.status, "ok");
});

test("the guard 426s a below-floor client that identifies itself, and lets a current one through", async () => {
  // A normal public call carrying the app headers at an old version is hard-blocked.
  const blocked = await call("GET", "/v1/countries", { headers: { "x-app-id": "customer", "x-app-platform": "android", "x-app-version": "1.0.0" } });
  assert.equal(blocked.status, 426);
  assert.equal(blocked.body.code, "UPDATE_REQUIRED");
  assert.ok(blocked.body.store_url.includes("play.google.com"));
  // A current client is not blocked.
  const ok = await call("GET", "/v1/countries", { headers: { "x-app-id": "customer", "x-app-platform": "android", "x-app-version": "2.3.0" } });
  assert.equal(ok.status, 200);
  // A request without app headers (e.g. the web admin) is never gated.
  assert.equal((await call("GET", "/v1/countries")).status, 200);
});

test("health and the requirements lookup are exempt even for a blocked client", async () => {
  const appHeaders = { "x-app-id": "customer", "x-app-platform": "android", "x-app-version": "1.0.0" };
  assert.equal((await call("GET", "/v1/health", { headers: appHeaders })).status, 200);
  assert.equal((await call("GET", "/v1/app/requirements?app=customer&platform=android&version=1.0.0", { headers: appHeaders })).status, 200);
});
