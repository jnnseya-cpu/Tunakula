/**
 * Publishes a market's Country Profile non-interactively, so a market can be brought up from the server
 * WITHOUT the admin console — useful on first bring-up, or when the admin UI is not yet reachable and the
 * storefront is still falling back to its built-in preview because no market is published.
 *
 *   DATABASE_OWNER_URL=... node src/db/publish-market-cli.ts CD --starter
 *
 * It publishes the market as PILOT, NOT LIVE: the storefront can see it, but it is explicitly a placeholder
 * built from the market template, not a market cleared to take real money. The readiness areas are signed by
 * the literal actor "cli" (never a person's name), so the audit trail shows the sign-off was machine-made and
 * still needs a real §28.10 review. Because this fabricates those sign-offs, it refuses to run unless you pass
 * `--starter`, acknowledging that this is a placeholder a Super Admin must complete — open Markets in the admin
 * console and fill in the real company, legal, payment and delivery-zone details, re-sign readiness with real
 * owners, and move the market to LIVE — before taking real money. It seeds NO merchants and NO orders.
 *
 * Idempotent: if the market is already published it reports that and changes nothing.
 */
import { connect } from "./db.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../modules/config/config-registry.ts";
import { loadVersions, saveVersions } from "../persistence/config.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";

// Markets we ship a starter profile for (the key is the fixture name). Others are built in the admin console.
const STARTER: Record<string, "cd"> = { CD: "cd" };

const args = process.argv.slice(2);
const iso2 = (args.find((a) => !a.startsWith("-")) ?? "CD").toUpperCase();
const acknowledged = args.includes("--starter");
const key = STARTER[iso2];
if (!key) {
  console.error(`No starter profile for ${iso2}. Available: ${Object.keys(STARTER).join(", ")}. Build other markets in the admin Markets console.`);
  process.exit(2);
}
if (!acknowledged) {
  console.error(
    `Refusing to publish ${iso2}: this publishes a PLACEHOLDER (PILOT) market and signs its §28.10 readiness as "cli",\n` +
    `not a real compliance review. Re-run with --starter to acknowledge, then complete the real profile and re-sign\n` +
    `readiness in the admin Markets console before this market takes real money:\n\n` +
    `  DATABASE_OWNER_URL=... node src/db/publish-market-cli.ts ${iso2} --starter\n`,
  );
  process.exit(2);
}
const url = process.env["DATABASE_OWNER_URL"] ?? process.env["DATABASE_URL"];
if (!url) throw new Error("set DATABASE_OWNER_URL (or DATABASE_URL)");

const db = connect(url, { max: 1 });
try {
  const registry = new CountryConfigRegistry({
    brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
    connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
    apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
  });
  registry.restore(await db.tx({}, loadVersions));
  if (registry.published(iso2)) {
    console.log(JSON.stringify({ iso2, published: false, reason: "already published" }));
  } else {
    // Build the starter profile as a PILOT placeholder (Africa data residency), with NO sample merchants or
    // orders. PILOT is visible to the storefront (stops the preview fallback) but is not a market cleared to
    // take real money — a Super Admin must complete it and move it to LIVE in the admin console.
    const doc = syntheticProfileDocument(key);
    delete doc["synthetic"];
    doc["country"].status = "PILOT";
    doc["compliance"].data_residency = "africa-south1";
    const draft = registry.saveDraft("publish-market-cli", doc);
    registry.publish("publish-market-cli", iso2, draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "cli", at: new Date() }])));
    await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
    console.warn(`\n⚠  ${iso2} published as PILOT PLACEHOLDER (readiness signed by "cli", not a real review).\n   Complete the real profile and re-sign readiness in admin → Markets, then move it to LIVE before taking real money.\n`);
    console.log(JSON.stringify({ iso2, published: true, status: "PILOT", version: draft.version }));
  }
} finally {
  await db.close();
}
