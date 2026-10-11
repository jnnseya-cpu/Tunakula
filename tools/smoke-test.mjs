#!/usr/bin/env node
/**
 * Post-deploy smoke test. Hits a running API and checks the go-live basics, then exits non-zero on any failure.
 *
 *   node tools/smoke-test.mjs https://api.tunakula.com
 *   BASE_URL=https://api.tunakula.com node tools/smoke-test.mjs
 *
 * It only reads public endpoints — safe to run against production right after a deploy.
 */
const base = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
};
const get = async (path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers, redirect: "manual" });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
  return { res, text, json };
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check("health: database round-trip", async () => {
  const { res, json } = await get("/v1/health", { "x-country": "CD" });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(json?.status === "ok", `expected {status:"ok"}, got ${JSON.stringify(json)}`);
});

await check("countries: config loaded", async () => {
  const { res, json } = await get("/v1/countries");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(Array.isArray(json?.data), "expected a data array");
  // A live deployment should have at least one published market before taking orders.
  if (json.data.length === 0) console.warn("  ⚠ no published markets yet — publish a Country Profile before launch");
});

await check("errors: problem+json shape", async () => {
  const { res, json } = await get("/v1/orders/not-a-real-id", { "x-country": "CD" });
  assert(res.status >= 400, `expected a 4xx, got ${res.status}`);
  assert(typeof json?.code === "string", "expected a problem+json body with a stable code");
});

await check("auth: protected route rejects anonymous", async () => {
  const { res } = await get("/v1/me", { "x-country": "CD" });
  assert(res.status === 401, `expected 401 for no token, got ${res.status}`);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}`);
process.exit(failed.length ? 1 : 0);
