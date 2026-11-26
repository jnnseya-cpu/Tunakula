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
CREATE TABLE migration.order_hdr(source_id text PRIMARY KEY, total_minor numeric NOT NULL, record jsonb NOT NULL);
CREATE TABLE migration.address (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE migration.wallet_tx (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE migration.order_line (source_id text PRIMARY KEY, record jsonb NOT NULL);`;

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
    // u1 has a wallet balance backed by movements; u2 has a balance but no history (gets an opening adjustment);
    // u3's movements do NOT sum to its stated balance (a reconciliation mismatch — must be reported, not imported).
    await sql.query(`INSERT INTO migration."user" (source_id, phone_e164, record) VALUES
      ('u1','+243810000001', $1), ('u2','+243810000002', $2), ('u3','+243810000003', $3)`,
      [JSON.stringify({ sourceId: "u1", phoneE164: "+243810000001", displayName: "Amina", email: null, createdAt: null, walletBalanceMinor: "1500" }),
       JSON.stringify({ sourceId: "u2", phoneE164: "+243810000002", displayName: null, email: null, createdAt: null, walletBalanceMinor: "800" }),
       JSON.stringify({ sourceId: "u3", phoneE164: "+243810000003", displayName: null, email: null, createdAt: null, walletBalanceMinor: "1000" })]);
    // u1: +2000 top-up then -500 order payment = 1500 (reconciles). u3: +500 only ≠ 1000 (mismatch).
    await sql.query(`INSERT INTO migration.wallet_tx (source_id, record) VALUES ('w1',$1),('w2',$2),('w3',$3)`,
      [JSON.stringify({ sourceId: "w1", customerSourceId: "u1", amountMinor: "2000", kind: "TOPUP", reference: "tp1", createdAt: "2025-01-02 09:00:00" }),
       JSON.stringify({ sourceId: "w2", customerSourceId: "u1", amountMinor: "-500", kind: "ORDER_PAYMENT", reference: null, createdAt: "2025-01-03 09:00:00" }),
       JSON.stringify({ sourceId: "w3", customerSourceId: "u3", amountMinor: "500", kind: "TOPUP", reference: "tp3", createdAt: "2025-01-02 09:00:00" })]);
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
      [JSON.stringify({ sourceId: "o1", branchSourceId: "b1", customerSourceId: "u1", totalMinor: "100", currency: "CDF", state: "DELIVERED", placedAt: "2025-03-01 12:00:00", orderType: "DELIVERY", paymentMode: "CASH_ON_DELIVERY" })]);
    // One line for o1, referencing item i1 (Brochettes). Its food_id resolves to the promoted live item.
    await sql.query(`INSERT INTO migration.order_line (source_id, record) VALUES ('ol1', $1)`,
      [JSON.stringify({ sourceId: "ol1", orderSourceId: "o1", itemSourceId: "i1", name: "Brochettes", quantity: 2, options: [] })]);
    // Two saved addresses for u1 (home + work) and one for a customer that will promote (u2). The orphan
    // address 'a-gone' points at a customer that does not exist, so it must be skipped.
    await sql.query(`INSERT INTO migration.address (source_id, record) VALUES ('a1',$1),('a2',$2),('a3',$3),('a-gone',$4)`,
      [JSON.stringify({ sourceId: "a1", customerSourceId: "u1", label: "Home", lat: -4.32, lng: 15.31, landmark: "12 Av. du Commerce", contactPhoneE164: "+243810000001", preferDefault: true }),
       JSON.stringify({ sourceId: "a2", customerSourceId: "u1", label: "Work", lat: -4.3, lng: 15.3, landmark: null, contactPhoneE164: null, preferDefault: false }),
       JSON.stringify({ sourceId: "a3", customerSourceId: "u2", label: "Home", lat: -4.34, lng: 15.27, landmark: null, contactPhoneE164: null, preferDefault: true }),
       JSON.stringify({ sourceId: "a-gone", customerSourceId: "u999", label: "Home", lat: -4.3, lng: 15.3, landmark: null, contactPhoneE164: null, preferDefault: false })]);
  });
});
after(async () => { await owner.close(); await t.drop(); });

test("dry run writes nothing and reports what would promote", async () => {
  const s = await promote(owner, "CD", { apply: false, doPublish: false });
  assert.equal(s.merchants, 1);
  assert.equal(s.branches, 2);
  assert.equal(s.items, 2, "2 promotable items (the orphan is excluded)");
  assert.equal(s.itemsUnavailable, 1);
  assert.equal(s.addresses, 3, "3 promotable addresses (the orphan customer's is excluded)");
  assert.equal(s.walletCustomers, 2, "u1 (replayed) + u2 (opening) reconcile; u3 does not");
  assert.equal(s.walletTx, 3, "u1's 2 movements + u2's 1 opening adjustment");
  assert.equal(s.walletMismatches.length, 1, "u3's balance does not reconcile");
  assert.equal(s.walletMismatches[0]?.customerSourceId, "u3");
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
  assert.equal(s.orders, 1, "the historical order is promoted as read-only history");

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
  assert.equal(s.addresses, 3, "all three resolvable addresses promoted");

  await db.tx({ country: "CD" }, async (sql) => {
    // u1 has both saved addresses, with exactly one default.
    const u1 = one(await sql.query<{ id: string }>("SELECT id FROM identity.app_user WHERE phone_e164 = $1", ["+243810000001"]));
    const addrs = await sql.query<{ label: string; is_default: boolean; contact_phone: string | null }>(
      "SELECT label, is_default, contact_phone FROM identity.saved_address WHERE user_id = $1 AND country_iso2 = 'CD' ORDER BY label", [u1.id]);
    assert.equal(addrs.length, 2, "both of u1's addresses carried over");
    assert.equal(addrs.filter((a) => a.is_default).length, 1, "exactly one default per customer");
    assert.deepEqual(addrs.map((a) => a.label).sort(), ["Home", "Work"]);
  });

  assert.equal(s.walletCustomers, 2, "u1 + u2 reconcile and import");
  assert.equal(s.walletTx, 3);
  assert.equal(s.walletMismatches.length, 1, "u3 reported, not imported");

  await db.tx({ country: "CD" }, async (sql) => {
    const bal = async (phone: string) => {
      const u = one(await sql.query<{ id: string }>("SELECT id FROM identity.app_user WHERE phone_e164 = $1", [phone]));
      const [row] = await sql.query<{ total: string | null; n: string }>(
        "SELECT coalesce(sum(amount_minor),0)::text AS total, count(*)::text AS n FROM wallet.transaction WHERE user_id = $1 AND country_iso2 = 'CD'", [u.id]);
      return { total: row?.total ?? "0", n: Number(row?.n ?? 0) };
    };
    const u1 = await bal("+243810000001");
    assert.equal(u1.total, "1500", "u1's replayed balance matches the source");
    assert.equal(u1.n, 2, "both movements carried");
    const u2 = await bal("+243810000002");
    assert.equal(u2.total, "800", "u2's balance carried as one opening adjustment");
    assert.equal(u2.n, 1);
    const u3 = await bal("+243810000003");
    assert.equal(u3.n, 0, "the mismatching customer's wallet was NOT imported");
    // The running balance is recorded on each row and never goes negative.
    const maxAfter = one(await sql.query<{ ok: boolean }>("SELECT bool_and(balance_after >= 0) AS ok FROM wallet.transaction"));
    assert.equal(maxAfter.ok, true);
  });

  // Order history: the past order shows up in the read model with its final state and carries its line item.
  await db.tx({ country: "CD" }, async (sql) => {
    const u1 = one(await sql.query<{ id: string }>("SELECT id FROM identity.app_user WHERE phone_e164 = $1", ["+243810000001"]));
    const ov = one(await sql.query<{ state: string; total_minor: string; payment_mode: string; order_id: string }>(
      "SELECT state, total_minor::text AS total_minor, payment_mode, order_id FROM ordering.order_view WHERE customer_id = $1", [u1.id]));
    assert.equal(ov.state, "DELIVERED");
    assert.equal(ov.total_minor, "100");
    assert.equal(ov.payment_mode, "CASH_ON_DELIVERY");
    // The ORDER_DRAFTED event carries the migrated line item, so the detail view can show what was ordered.
    const drafted = one(await sql.query<{ payload: { snapshot: { lines: { name: string; quantity: number }[] } } }>(
      "SELECT payload FROM ordering.order_event WHERE order_id = $1 AND type = 'ORDER_DRAFTED'", [ov.order_id]));
    assert.equal(drafted.payload.snapshot.lines.length, 1);
    assert.equal(drafted.payload.snapshot.lines[0]?.name, "Brochettes");
    assert.equal(drafted.payload.snapshot.lines[0]?.quantity, 2);
    // A terminal STATE_CHANGED event records the final state.
    const changed = one(await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM ordering.order_event WHERE order_id = $1 AND type = 'STATE_CHANGED'", [ov.order_id]));
    assert.equal(changed.n, "1");
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
  assert.equal(s.addresses, 0, "no addresses re-created on a second apply");
  assert.equal(s.walletTx, 0, "no wallet movements re-created on a second apply");
  assert.equal(s.orders, 0, "no orders re-created on a second apply");
  const b2 = one(await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM catalogue.branch")));
  assert.equal(b2.n, "2", "still exactly two branches after re-run");
  const a2 = one(await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM identity.saved_address")));
  assert.equal(a2.n, "3", "still exactly three addresses after re-run");
  const w2 = one(await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM wallet.transaction")));
  assert.equal(w2.n, "3", "still exactly three wallet movements after re-run (u1 x2 + u2 x1)");
  const o2 = one(await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM ordering.order_view")));
  assert.equal(o2.n, "1", "still exactly one historical order after re-run");
});

test("refuses to promote into an unpublished market", async () => {
  await assert.rejects(promote(owner, "GB", { apply: true, doPublish: false }), /not published/);
});
