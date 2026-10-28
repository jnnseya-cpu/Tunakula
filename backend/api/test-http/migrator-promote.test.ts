/**
 * Promotion (migration.* staging → live tenant tables). Proves the second, deliberate migration step: it reads
 * staged canonical records and writes them into the live catalogue/identity through the app's persistence layer,
 * under the country's FORCE RLS; it carries add-ons and variations; it is idempotent; and it never promotes
 * historical orders. Runs against a real migrated database (needs Postgres, like the API e2e suite).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { testDatabase } from "../src/db/testing.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../src/modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../src/modules/config/brand.ts";
import { saveVersions } from "../src/persistence/config.ts";
import { promote } from "../src/migrator/promote.ts";
import { connect, type Db } from "../src/db/db.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;      // the app-role connection, for read-back assertions
let owner: Db;   // the owner connection, as the promotion CLI runs in production (DATABASE_OWNER_URL)

/** First row, asserted present — keeps strict-null tsc happy and doubles as a "row exists" check. */
const one = <T>(rows: T[]): T => { if (!rows[0]) throw new Error("expected a row"); return rows[0]; };

const STAGING_DDL = `
CREATE SCHEMA IF NOT EXISTS migration;
CREATE TABLE migration."user"   (source_id text PRIMARY KEY, phone_e164 text NOT NULL, record jsonb NOT NULL);
CREATE TABLE migration.merchant (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE migration.branch   (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE migration.item     (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE migration.order_hdr(source_id text PRIMARY KEY, total_minor numeric NOT NULL, record jsonb NOT NULL);`;

before(async () => {
  t = await testDatabase();
  db = t.db;
  owner = connect(t.ownerUrl, { max: 2 });
  // Publish a CD market (promotion needs it — its profile names the brand each store joins).
  const registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } });
  const doc = syntheticProfileDocument("cd");
  delete doc.synthetic;
  doc.country.status = "LIVE";
  doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("test", doc);
  registry.publish("test", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "test", at: new Date() }])));
  await owner.tx({}, (sql) => saveVersions(sql, registry.allVersions()));

  // Seed a small, representative staging set: 1 merchant, 2 branches, 2 customers, and items including one
  // rich dish (add-ons + a variation group), one unavailable dish, and one ORPHAN item (branch 999 absent).
  await owner.tx({}, async (sql) => {
    await sql.query(STAGING_DDL);
    await sql.query(`INSERT INTO migration."user" (source_id, phone_e164, record) VALUES
      ('u1','+243810000001', $1), ('u2','+243810000002', $2)`,
      [JSON.stringify({ sourceId: "u1", phoneE164: "+243810000001", displayName: "Amina", email: null, createdAt: null }),
       JSON.stringify({ sourceId: "u2", phoneE164: "+243810000002", displayName: null, email: null, createdAt: null })]);
    await sql.query(`INSERT INTO migration.merchant (source_id, record) VALUES ('m1', $1)`,
      [JSON.stringify({ sourceId: "m1", name: "Chez Amina", ownerPhoneE164: "+243810000001" })]);
    await sql.query(`INSERT INTO migration.branch (source_id, record) VALUES ('b1', $1), ('b2', $2)`,
      [JSON.stringify({ sourceId: "b1", merchantSourceId: "m1", name: "Chez Amina Gombe", storeType: "RESTAURANT", lat: -4.3, lng: 15.3, commune: "Gombe" }),
       JSON.stringify({ sourceId: "b2", merchantSourceId: "m1", name: "Chez Amina Kintambo", storeType: "RESTAURANT", lat: -4.33, lng: 15.26, commune: "Kintambo" })]);
    const rich = { sourceId: "i1", branchSourceId: "b1", name: "Brochettes", priceMinor: "14", currency: "CDF", available: true,
      addons: [{ name: "Bavaria", priceMinor: "8" }, { name: "Frites", priceMinor: "3" }],
      variations: [{ name: "Garnitures", type: "MULTI", required: false, min: 1, max: 3, options: [{ name: "Piment", priceMinor: "0" }, { name: "oignons", priceMinor: "0" }] }] };
    const gone = { sourceId: "i2", branchSourceId: "b1", name: "Plat du jour", priceMinor: "20", currency: "CDF", available: false, addons: [], variations: [] };
    const orphan = { sourceId: "i3", branchSourceId: "999", name: "Perdu", priceMinor: "5", currency: "CDF", available: true, addons: [], variations: [] };
    await sql.query(`INSERT INTO migration.item (source_id, record) VALUES ('i1',$1),('i2',$2),('i3',$3)`,
      [JSON.stringify(rich), JSON.stringify(gone), JSON.stringify(orphan)]);
    await sql.query(`INSERT INTO migration.order_hdr (source_id, total_minor, record) VALUES ('o1', 100, $1)`,
      [JSON.stringify({ sourceId: "o1", branchSourceId: "b1", customerSourceId: "u1", totalMinor: "100", currency: "CDF", state: "DELIVERED", placedAt: null })]);
  });
});
after(async () => { await owner.close(); await t.drop(); });

test("dry run writes nothing and reports what would promote", async () => {
  const s = await promote(owner, "CD", { apply: false, doPublish: false });
  assert.equal(s.merchants, 1);
  assert.equal(s.branches, 2);
  assert.equal(s.items, 2, "2 promotable items (the orphan is excluded)");
  assert.equal(s.itemsUnavailable, 1);
  // Nothing written.
  const c = one(await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM catalogue.branch")));
  assert.equal(c.n, "0", "dry run created no branches");
});

test("apply promotes merchants, branches, items (with add-ons + variations) and binds owners", async () => {
  const s = await promote(owner, "CD", { apply: true, doPublish: true });
  assert.equal(s.merchants, 1);
  assert.equal(s.owners, 1);
  assert.equal(s.branches, 2);
  assert.equal(s.published, 1, "only the branch with an available dish publishes");
  assert.equal(s.items, 2);
  assert.equal(s.orders, 1, "the order is counted but held as history");

  await db.tx({ country: "CD" }, async (sql) => {
    const g = one(await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM catalogue.restaurant_group"));
    assert.equal(g.n, "1");
    const b = one(await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM catalogue.branch"));
    assert.equal(b.n, "2");
    const pub = one(await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM catalogue.branch WHERE published_at IS NOT NULL"));
    assert.equal(pub.n, "1");
    const rich = one(await sql.query<{ names: unknown; addons: unknown[]; variations: unknown[]; available: boolean }>(
      "SELECT names, addons, variations, available FROM catalogue.menu_item WHERE names->>'fr' = 'Brochettes'"));
    assert.equal(rich.addons.length, 2, "add-ons carried");
    assert.equal(rich.variations.length, 1, "variation group carried");
    assert.equal(rich.available, true);
    const gone = one(await sql.query<{ available: boolean }>("SELECT available FROM catalogue.menu_item WHERE names->>'fr' = 'Plat du jour'"));
    assert.equal(gone.available, false, "unavailable dish stays unavailable");
    const orphan = await sql.query("SELECT 1 FROM catalogue.menu_item WHERE names->>'fr' = 'Perdu'");
    assert.equal(orphan.length, 0, "the orphan item (missing branch) was not promoted");
  });
  // Owner account exists and is bound RESTAURANT_OWNER (global identity).
  const binds = await db.tx({}, (sql) => sql.query("SELECT 1 FROM identity.role_binding WHERE role = 'RESTAURANT_OWNER'"));
  assert.equal(binds.length, 1);
});

test("a second apply is idempotent — creates nothing new", async () => {
  const s = await promote(owner, "CD", { apply: true, doPublish: true });
  assert.equal(s.merchants, 0);
  assert.equal(s.branches, 0);
  assert.equal(s.items, 0);
  const b2 = one(await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM catalogue.branch")));
  assert.equal(b2.n, "2", "still exactly two branches after re-run");
});

test("refuses to promote into an unpublished market", async () => {
  await assert.rejects(promote(owner, "GB", { apply: true, doPublish: false }), /not published/);
});
