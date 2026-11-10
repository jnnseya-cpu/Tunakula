/**
 * Trend Intelligence autonomous sweep (spec §2/§5): reads Tunakula's own first-party order signal, scores
 * per-branch demand, and freezes watched opportunities — headless, invisible, idempotent. A single first-party
 * family caps confidence at 69, so the sweep WATCHES; it never silently makes a live, user-facing change.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { testDatabase } from "../src/db/testing.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../src/modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../src/modules/config/brand.ts";
import { saveVersions } from "../src/persistence/config.ts";
import { addMenuItem, createBranch, ensureGroup, publishBranch } from "../src/persistence/catalogue.ts";
import { createUser } from "../src/persistence/identity.ts";
import { TrendService } from "../src/app/trend.ts";
import type { Db } from "../src/db/db.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;
let registry: CountryConfigRegistry;
let branchId: string;
let brand: string;
const NOW = new Date("2026-11-10T12:30:00Z"); // current complete window is [11:00, 12:00)

before(async () => {
  t = await testDatabase();
  db = t.db;
  registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } });
  const doc = syntheticProfileDocument("cd");
  delete doc.synthetic; doc.country.status = "LIVE"; doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("test", doc);
  registry.publish("test", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "test", at: new Date() }])));
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  brand = registry.published("CD")!.profile.experience.brand_id;

  const customer = await db.tx({}, (sql) => createUser(sql, { phone: "+243810009999", displayName: "C", homeCountry: "CD" }));
  await db.tx({ country: "CD" }, async (sql) => {
    await ensureGroup(sql, { id: "rg-sweep", country: "CD", name: "Sweep Co", createdBy: customer.id });
    const branch = await createBranch(sql, { country_iso2: "CD", brand_id: brand, restaurant_group_id: "rg-sweep", name: "Braise Gombe", city: null, commune: "Gombe", lat: "-4.3", lng: "15.3", store_type: "RESTAURANT" }, true);
    branchId = branch.id;
    await addMenuItem(sql, branch, { names: { fr: "Poulet" }, prices: { CDF: "5000" } }); // available → readiness ok
    await publishBranch(sql, branchId);

    // Seed orders: a busy current window [11:00,12:00), a quiet prior baseline → a clear rising signal.
    const order = (createdAt: string) => sql.query(
      `INSERT INTO ordering.order_view (order_id, country_iso2, brand_id, branch_id, customer_id, type, channel, payment_mode, state, total_minor, currency, version, created_at, updated_at)
       VALUES ($1,'CD',$2,$3,$4,'DELIVERY','web','CASH','DELIVERED',5000,'CDF',1,$5,$5)`,
      [randomUUID(), brand, branchId, customer.id, createdAt],
    );
    for (let i = 0; i < 15; i++) await order(`2026-11-10T11:${String(i * 3).padStart(2, "0")}:00Z`); // 15 in current window
    for (let w = 1; w <= 8; w++) await order(`2026-11-10T${String(11 - w).padStart(2, "0")}:30:00Z`); // 1 per prior window
  });
});
after(async () => { await t.drop(); });

test("the sweep freezes a watched opportunity from rising first-party demand, and is idempotent", async () => {
  const svc = new TrendService(db, registry, () => NOW);
  const first = await svc.sweep("CD", { force: true, now: NOW });
  assert.equal(first.ran, true);
  assert.ok(first.observations >= 1, "ingested the current-window observation");
  assert.ok(first.opportunities >= 1, "froze at least one opportunity");

  const opp = await db.tx({ country: "CD" }, (sql) => sql.query<{ topic_id: string; band: string; opportunity_score: string; confidence: string }>(
    "SELECT topic_id, band, opportunity_score::text, confidence::text FROM trend.opportunity WHERE topic_id = $1", [`branch-${branchId}`]));
  assert.equal(opp.length, 1);
  assert.equal(opp[0]!.band, "WATCH", "one first-party family caps confidence below the brief threshold");
  assert.ok(Number(opp[0]!.confidence) <= 69, "confidence is capped at 69 for a single family");

  // Re-running the same window freezes nothing new (idempotent on the input digest).
  const second = await svc.sweep("CD", { force: true, now: NOW });
  assert.equal(second.opportunities, 0, "no new opportunity on re-run");
  const count = await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM trend.opportunity WHERE topic_id = $1", [`branch-${branchId}`]));
  assert.equal(count[0]!.n, "1", "still exactly one frozen opportunity");

  // A run was recorded for audit.
  const runs = await db.tx({ country: "CD" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM trend.sweep_run"));
  assert.ok(Number(runs[0]!.n) >= 1);
});

test("the cadence guard skips a run that is too soon after the last", async () => {
  const svc = new TrendService(db, registry, () => NOW);
  // Not forced, and a run just happened in the test above → guarded off.
  const skipped = await svc.sweep("CD", { now: new Date(NOW.getTime() + 60_000) });
  assert.equal(skipped.ran, false);
});
