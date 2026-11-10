/**
 * Trend Intelligence service embedded in the platform: the same DB, country RLS, RBAC (authorize) and audit as
 * every other service. Proves the ops capability gate and the ingest → score → brief → approve → effective-brief
 * control loop that steers Tunakula's existing agents. Needs Postgres (runs under test:api).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { testDatabase } from "../src/db/testing.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../src/modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../src/modules/config/brand.ts";
import { saveVersions } from "../src/persistence/config.ts";
import { addBinding, createUser } from "../src/persistence/identity.ts";
import { loadPrincipal } from "../src/app/principal.ts";
import { TrendService } from "../src/app/trend.ts";
import type { Db } from "../src/db/db.ts";
import type { Principal } from "../src/modules/identity/policy.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;
let registry: CountryConfigRegistry;
let admin: Principal;
let outsider: Principal;

before(async () => {
  t = await testDatabase();
  db = t.db;
  registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } });
  const doc = syntheticProfileDocument("cd");
  delete doc.synthetic; doc.country.status = "LIVE"; doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("test", doc);
  registry.publish("test", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "test", at: new Date() }])));
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));

  admin = await db.tx({}, async (sql) => {
    const u = await createUser(sql, { phone: "+243810000010", displayName: "Market Admin", homeCountry: "CD" });
    await addBinding(sql, { userId: u.id, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "CD" } });
    return loadPrincipal(sql, u.id);
  });
  outsider = await db.tx({}, async (sql) => {
    const u = await createUser(sql, { phone: "+243810000011", displayName: "Customer", homeCountry: "CD" });
    return loadPrincipal(sql, u.id);
  });
});
after(async () => { await t.drop(); });

test("the ops capability gates authoring — a plain customer is forbidden", async () => {
  const svc = new TrendService(db, registry);
  await assert.rejects(svc.ingest("CD", outsider, [obs()]), /market admin/i);
  await assert.rejects(svc.createBrief("CD", outsider, draftInput()), /market admin/i);
});

test("full embedded loop: ingest → score → brief → approve → effective brief steers the seo channel", async () => {
  const svc = new TrendService(db, registry, () => new Date("2026-11-12T00:00:00Z"));

  const ing = await svc.ingest("CD", admin, [obs("r1"), obs("r2")]);
  assert.deepEqual([ing.accepted, ing.duplicate, ing.conflict], [2, 0, 0]);

  // Score the §5 worked example — must be the reviewable BRIEF band at 86.25 / 83.5.
  const scored = await svc.score("CD", admin, {
    topic_id: "poulet-braise", locale: "fr-CD", window_end: "2026-11-10T09:00:00Z",
    demand: 80, fit: 95, intent: 85, timing: 90, readiness: 80,
    sourceQuality: 90, corroboration: 80, coverage: 70, freshness: 90, independentFamilies: 2,
  });
  assert.equal(scored.opportunity_score, 86.25);
  assert.equal(scored.confidence, 83.5);
  assert.equal(scored.band, "BRIEF");

  // Author a brief, then it must NOT steer until approved.
  const created = await svc.createBrief("CD", admin, draftInput());
  assert.equal(created.status, "DRAFT");
  assert.equal(await svc.effectiveBrief("CD", { locale: "fr-CD", topic_id: "poulet-braise", channel: "seo" }), null);

  // Approve → now an existing agent asking for the effective brief gets it on an allowed channel, not others.
  await svc.approveBrief("CD", admin, created.brief_id, 1);
  const eff = await svc.effectiveBrief("CD", { locale: "fr-CD", topic_id: "poulet-braise", channel: "seo" });
  assert.equal(eff?.brief_id, created.brief_id);
  assert.equal(eff?.platform_id, registry.published("CD")!.profile.experience.brand_id, "server stamped the platform id");
  assert.equal(await svc.effectiveBrief("CD", { locale: "fr-CD", topic_id: "poulet-braise", channel: "paid" }), null);
});

function obs(recordId = "r1") {
  return { source_id: "first_party_search", source_family: "first_party", source_record_id: recordId, observed_at: "2026-11-10T09:00:00Z",
    window_start: "2026-11-10T08:00:00Z", window_end: "2026-11-10T09:00:00Z", metric: "searches", value: 25, evidence_hash: `h_${recordId}` };
}

function draftInput() {
  return {
    topic_id: "poulet-braise", locale: "fr-CD", opportunity_score: 86.25, confidence: 83.5,
    valid_from: "2026-11-10T10:00:00Z", expires_at: "2026-11-17T10:00:00Z", evidence_ids: ["ev_1"],
    audience: "Kinshasa lunch crowd", intent: "find grilled chicken nearby", approved_claim_ids: ["claim_1"],
    cta_id: "cta_order_now", allowed_channels: ["seo", "organic_social"] as const, objective: "orders per session",
    experiment_id: "exp_1", policy_version: 1,
  };
}
