/**
 * Publishes a market's Country Profile non-interactively, so a market can be launched from the server
 * WITHOUT the admin console — useful on first bring-up, or when the admin UI is not yet reachable and the
 * storefront is still falling back to its built-in preview because no market is published.
 *
 *   DATABASE_OWNER_URL=... node src/db/publish-market-cli.ts CD
 *
 * Idempotent: if the market is already published it reports that and changes nothing. It seeds NO merchants
 * and NO orders — only the market itself. The profile is a STARTER built from the market template; once a
 * Super Admin can sign in, open Markets in the admin console and complete it with the real company, legal,
 * payment and delivery-zone details before taking real money.
 */
import { connect } from "./db.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../modules/config/config-registry.ts";
import { loadVersions, saveVersions } from "../persistence/config.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";

// Markets we ship a starter profile for (the key is the fixture name). Others are built in the admin console.
const STARTER: Record<string, "cd"> = { CD: "cd" };

const iso2 = (process.argv[2] ?? "CD").toUpperCase();
const key = STARTER[iso2];
if (!key) {
  console.error(`No starter profile for ${iso2}. Available: ${Object.keys(STARTER).join(", ")}. Build other markets in the admin Markets console.`);
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
    // Build the starter profile and make it production-shaped (LIVE, Africa data residency), the same way
    // the demo seed launches CD — but without any sample merchants or orders.
    const doc = syntheticProfileDocument(key);
    delete doc["synthetic"];
    doc["country"].status = "LIVE";
    doc["compliance"].data_residency = "africa-south1";
    const draft = registry.saveDraft("publish-market-cli", doc);
    registry.publish("publish-market-cli", iso2, draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "cli", at: new Date() }])));
    await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
    console.log(JSON.stringify({ iso2, published: true, version: draft.version }));
  }
} finally {
  await db.close();
}
