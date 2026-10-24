/**
 * The opt-in per-IP cap on sign-in-code requests (a denial-of-wallet / SMS-pumping control, independent of the
 * general rate limit). Off by default; when a positive count is configured, POST /v1/auth/otp/request beyond it
 * in a ten-minute window gets 429 problem+json, while other endpoints are untouched by this cap.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  api = await createApi({ db: t.db, registry, connectors: [], tokenSecret: "otp-cap-secret-otp-cap-secret-okok!!", otp: new DevOtpOutbox(), authOtpPerIp: 3, onError: () => undefined });
});
after(async () => { await api.close(); await t.drop(); });

const requestCode = (phone: string) =>
  api.inject({ method: "POST", url: "/v1/auth/otp/request", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, payload: JSON.stringify({ phone }) });

test("sign-in-code requests beyond the per-IP cap get 429 problem+json", async () => {
  // authOtpPerIp = 3: the first three (each a different number, so the per-phone cap never fires) pass, the fourth
  // is blocked by the per-IP cap even though it is a fresh number — this is the cross-number flood it exists to stop.
  for (let i = 0; i < 3; i++) {
    const r = await requestCode(`+24381000000${i}`);
    assert.ok(r.statusCode < 400, `request ${i + 1} should pass, got ${r.statusCode}`);
  }
  const limited = await requestCode("+243810000009");
  assert.equal(limited.statusCode, 429);
  assert.match(String(limited.headers["content-type"]), /application\/problem\+json/);
  assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
  assert.equal(limited.headers["retry-after"], "600");
});

test("other endpoints are untouched by the sign-in-code cap", async () => {
  for (let i = 0; i < 8; i++) assert.equal((await api.inject({ method: "GET", url: "/v1/countries" })).statusCode, 200, `countries ${i + 1}`);
});
