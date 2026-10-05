#!/usr/bin/env node
/**
 * Fetch the current USD -> CDF exchange rate from a free, no-key source and write it to
 * lib/fx-rate.json. Run it before building the catalogue so storefront prices track the
 * real rate instead of a hand-typed one:
 *
 *     npm run fx:update -w @tunakula/web-customer
 *
 * Several free providers are tried in turn. If every one is unreachable (for example a
 * network policy that only allows the Tunakula sites and package registries), the existing
 * fx-rate.json is kept and the script exits 0 with a notice, so a build is never blocked by
 * a missing rate. The only thing that changes the committed rate is a successful fetch.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "fx-rate.json");

/** Each provider returns the number of CDF per 1 USD, or null if it can't. */
const PROVIDERS = [
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/USD",
    pick: (j) => j?.rates?.CDF ?? null,
  },
  {
    name: "fawazahmed0/currency-api (jsdelivr)",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    pick: (j) => j?.usd?.cdf ?? null,
  },
  {
    name: "fawazahmed0/currency-api (pages.dev)",
    url: "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
    pick: (j) => j?.usd?.cdf ?? null,
  },
  {
    name: "exchangerate.host",
    url: "https://api.exchangerate.host/latest?base=USD&symbols=CDF",
    pick: (j) => j?.rates?.CDF ?? null,
  },
];

async function tryProvider(p) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(p.url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rate = p.pick(await res.json());
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new Error("no CDF rate in response");
    return Math.round(rate);
  } finally {
    clearTimeout(timer);
  }
}

const failures = [];
for (const p of PROVIDERS) {
  try {
    const rate = await tryProvider(p);
    const payload = { rate, base: "USD", quote: "CDF", source: p.name, asOf: new Date().toISOString().slice(0, 10) };
    writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
    console.log(`USD->CDF = ${rate} (via ${p.name}); wrote ${OUT}`);
    process.exit(0);
  } catch (err) {
    failures.push(`${p.name}: ${err.message}`);
  }
}

let kept = "none";
try {
  kept = JSON.parse(readFileSync(OUT, "utf8")).rate;
} catch { /* no existing file */ }
console.warn("Could not fetch a live USD->CDF rate from any free provider:");
for (const f of failures) console.warn("  - " + f);
console.warn(`Keeping the committed fallback rate (${kept}). Run this again where the network allows these hosts.`);
process.exit(0);
