/**
 * The opt-in Prometheus metrics endpoint. Off by default; when enabled it records every request and exposes
 * them at GET /metrics in the Prometheus text format, optionally behind a bearer token.
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
  api = await createApi({ db: t.db, registry, connectors: [], tokenSecret: "metrics-secret-metrics-secret-metrics!", otp: new DevOtpOutbox(), metrics: { token: "scrape-token" }, onError: () => undefined });
});
after(async () => { await api.close(); await t.drop(); });

test("GET /metrics needs the bearer token", async () => {
  assert.equal((await api.inject({ method: "GET", url: "/metrics" })).statusCode, 401);
  assert.equal((await api.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
});

test("requests are counted and exposed in Prometheus format", async () => {
  // Generate a little traffic.
  for (let i = 0; i < 3; i++) assert.equal((await api.inject({ method: "GET", url: "/v1/countries" })).statusCode, 200);
  await api.inject({ method: "GET", url: "/v1/health", headers: { "x-country": "CD" } });

  const res = await api.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer scrape-token" } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /text\/plain/);
  const body = res.body;
  // The counter and histogram are present, with the route template (not a raw URL) as the label.
  assert.match(body, /# TYPE http_requests_total counter/);
  assert.match(body, /http_requests_total\{method="GET",route="\/v1\/countries",status="200"\} 3/);
  assert.match(body, /# TYPE http_request_duration_seconds histogram/);
  assert.match(body, /http_request_duration_seconds_count\{method="GET",route="\/v1\/countries"\} 3/);
  assert.match(body, /http_request_duration_seconds_bucket\{method="GET",route="\/v1\/countries",le="\+Inf"\} 3/);
  // Process gauges are included.
  assert.match(body, /process_uptime_seconds \d/);
  assert.match(body, /nodejs_heap_used_bytes \d/);
  // The scrape of /metrics itself is not counted as traffic.
  assert.doesNotMatch(body, /route="\/metrics"/);
});
