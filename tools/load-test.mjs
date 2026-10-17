#!/usr/bin/env node
/**
 * Dependency-free load / soak test. Drives a target endpoint with N concurrent workers for a fixed duration and
 * reports throughput, latency percentiles and the status-code mix. Use a short run for a smoke load check and a
 * long one (e.g. --duration 1800) for a soak.
 *
 *   node tools/load-test.mjs https://api.tunakula.com --path /v1/health --concurrency 50 --duration 30
 *
 * It only drives whatever path you point it at — aim it at a read-only endpoint (health, countries, a public
 * menu) unless you intend to create load-bearing writes.
 */
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const base = (args.find((a) => !a.startsWith("--") && a !== flag("path", "") && a !== flag("concurrency", "") && a !== flag("duration", "")) ?? process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const path = flag("path", "/v1/health");
const concurrency = Math.max(1, Number(flag("concurrency", "20")));
const durationS = Math.max(1, Number(flag("duration", "10")));
const headers = { "x-country": "CD" };
const url = `${base}${path}`;

const latencies = [];
const statuses = new Map();
let errors = 0;
const deadline = Date.now() + durationS * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers });
      await res.arrayBuffer();
      latencies.push(performance.now() - t0);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    } catch {
      errors += 1;
      latencies.push(performance.now() - t0);
    }
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const ms = (n) => `${n.toFixed(1)} ms`;

console.log(`Load test → ${url}`);
console.log(`  ${concurrency} workers · ${durationS}s\n`);
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = (performance.now() - started) / 1000;

const total = latencies.length;
const ok = [...statuses.entries()].filter(([s]) => s < 400).reduce((n, [, c]) => n + c, 0);
const sorted = latencies.slice().sort((a, b) => a - b);
console.log(`Requests     ${total}  (${(total / elapsed).toFixed(0)} req/s over ${elapsed.toFixed(1)}s)`);
console.log(`Success      ${ok}/${total}  (${((ok / Math.max(total, 1)) * 100).toFixed(2)}%)   errors: ${errors}`);
console.log(`Status mix   ${[...statuses.entries()].sort().map(([s, c]) => `${s}:${c}`).join("  ") || "—"}`);
console.log(`Latency      p50 ${ms(pct(sorted, 50))}   p90 ${ms(pct(sorted, 90))}   p95 ${ms(pct(sorted, 95))}   p99 ${ms(pct(sorted, 99))}   max ${ms(sorted.at(-1) ?? 0)}`);

// Non-zero exit if a meaningful fraction failed, so CI / a pipeline can gate on it.
const errorRate = (total - ok + errors) / Math.max(total, 1);
if (errorRate > 0.01) { console.error(`\nFAIL: error rate ${(errorRate * 100).toFixed(2)}% exceeds 1%`); process.exit(1); }
console.log(`\nOK: error rate ${(errorRate * 100).toFixed(2)}%`);
