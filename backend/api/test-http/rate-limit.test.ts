/**
 * The opt-in per-IP rate limit (a production abuse-control baseline). Off by default; when a positive rpm is
 * configured, requests beyond it in a one-minute window get 429 problem+json, while health probes are exempt.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DevOtpOutbox } from "../src/app/auth.ts";
import { testDatabase } from "../src/db/testing.ts";
import { createApi } from "../src/http/app.ts";
import { CountryConfigRegistry, GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../src/index.ts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

let t: Awaited<ReturnType<typeof testDatabase>>;
let api: NestFastifyApplication;

before(async () => {
  t = await testDatabase();
  const registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [], apiHosts: {} });
  api = await createApi({ db: t.db, registry, connectors: [], tokenSecret: "rate-limit-secret-rate-limit-secret!!", otp: new DevOtpOutbox(), rateLimit: { rpm: 3 }, onError: () => undefined });
});
after(async () => { await api.close(); await t.drop(); });

const hit = (url: string) => api.inject({ method: "GET", url });

test("requests beyond the per-minute limit get 429 problem+json", async () => {
  // rpm = 3: the first three pass, the fourth is limited.
  for (let i = 0; i < 3; i++) assert.equal((await hit("/v1/countries")).statusCode, 200, `request ${i + 1} should pass`);
  const limited = await hit("/v1/countries");
  assert.equal(limited.statusCode, 429);
  assert.match(String(limited.headers["content-type"]), /application\/problem\+json/);
  assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
  assert.equal(limited.headers["retry-after"], "60");
});

test("health probes are never rate-limited", async () => {
  for (let i = 0; i < 8; i++) assert.equal((await hit("/v1/health")).statusCode, 200, `health probe ${i + 1}`);
});
