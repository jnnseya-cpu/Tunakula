/**
 * Trend Intelligence steers EXISTING storefront content silently (spec §7 owned placement), through Tunakula's
 * existing CMS and only via the current approval path: the engine proposes, a market admin applies with the
 * existing SiteContentService.save, and the live storefront reflects it. No new visible surface, no silent
 * publish; prohibited claims can never leak into the proposal. Needs Postgres.
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
import { SiteContentService } from "../src/app/site-content.ts";
import type { Db } from "../src/db/db.ts";
import type { Principal } from "../src/modules/identity/policy.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;
let registry: CountryConfigRegistry;
let admin: Principal;
let trend: TrendService;
let content: SiteContentService;

before(async () => {
  t = await testDatabase();
  db = t.db;
  registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } });
  const doc = syntheticProfileDocument("cd");
  delete doc.synthetic; doc.country.status = "LIVE"; doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("test", doc);
  registry.publish("test", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "test", at: new Date() }])));
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  trend = new TrendService(db, registry, () => new Date("2026-11-12T00:00:00Z"));
  content = new SiteContentService(db, registry);
  admin = await db.tx({}, async (sql) => {
    const u = await createUser(sql, { phone: "+243810000020", displayName: "Admin", homeCountry: "CD" });
    await addBinding(sql, { userId: u.id, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "CD" } });
    return loadPrincipal(sql, u.id);
  });
});
after(async () => { await t.drop(); });

const brief = () => ({
  topic_id: "team-onboarding", locale: "en-CA", opportunity_score: 86.25, confidence: 83.5,
  valid_from: "2026-11-10T10:00:00Z", expires_at: "2026-11-17T10:00:00Z", evidence_ids: ["ev_1"],
  audience: "Small teams", intent: "onboard quickly", approved_claim_ids: ["claim_1"], cta_id: "cta_guide",
  allowed_channels: ["owned_placement"] as const, prohibited_claims: ["guaranteed onboarding time"],
  objective: "trial starts", experiment_id: "exp_1", policy_version: 1,
});

test("with no approved brief, the proposal returns current content unchanged (steered_by null)", async () => {
  await content.save("CD", admin, { hero: { title: "Get to eat.", subtitle: "Original subtitle." } });
  const p = await trend.proposeSiteContent("CD", admin, { locale: "en-CA", topic_id: "team-onboarding" });
  assert.equal(p.steered_by, null);
});

test("an approved brief steers the existing hero; applying it via the existing save reaches the live storefront", async () => {
  const created = await trend.createBrief("CD", admin, brief());
  await trend.approveBrief("CD", admin, created.brief_id, 1);

  const proposal = await trend.proposeSiteContent("CD", admin, { locale: "en-CA", topic_id: "team-onboarding" });
  assert.equal(proposal.steered_by, created.brief_id);
  const hero = proposal.home.hero as { title: string; subtitle: string };
  assert.equal(hero.title, "Get to eat.", "existing title preserved");
  assert.match(hero.subtitle, /Small teams/);
  assert.match(hero.subtitle, /onboard quickly/);

  // Apply through the EXISTING approval path — not the engine.
  await content.save("CD", admin, proposal.home);
  const live = await content.live("CD");
  assert.match(live.home.hero.subtitle, /Small teams/, "the live storefront now shows the steered content");
  assert.equal(live.home.hero.title, "Get to eat.");
});

test("a prohibited claim can never enter the proposal", async () => {
  // Title already contains the prohibited phrase → the steer must refuse.
  await content.save("CD", admin, { hero: { title: "We offer a guaranteed onboarding time", subtitle: "x" } });
  await assert.rejects(trend.proposeSiteContent("CD", admin, { locale: "en-CA", topic_id: "team-onboarding" }), /prohibited claim/i);
});
