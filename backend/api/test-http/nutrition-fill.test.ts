/**
 * The AI nutrition fill (§AI): NutritionService estimates missing per-100g figures via the estimator brain, stores
 * them tagged `ai_estimate`, and the menu read model then exposes an automatic Nutri-Score with that basis. With
 * the deterministic (sandbox) brain it is a no-op — nothing is fabricated. Needs Postgres.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { NutritionEstimateResult, NutritionEstimatorBrain } from "@tunakula/ts-contracts";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { testDatabase } from "../src/db/testing.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../src/modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../src/modules/config/brand.ts";
import { saveVersions } from "../src/persistence/config.ts";
import { addMenuItem, createBranch, ensureGroup, menuOf, publishBranch } from "../src/persistence/catalogue.ts";
import { createUser } from "../src/persistence/identity.ts";
import { NutritionService } from "../src/app/nutrition.ts";
import { SandboxNutritionEstimator } from "../src/modules/nutriscore/sandbox-nutrition-estimator.ts";
import { gradeFromFacts } from "../src/modules/nutriscore/nutriscore.ts";
import type { Db } from "../src/db/db.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;
let registry: CountryConfigRegistry;
let branchId: string;

// A fake estimator that returns a fixed, valid estimate for any dish.
const fakeBrain: NutritionEstimatorBrain = {
  id: "fake",
  async estimate(): Promise<NutritionEstimateResult> {
    return { source: "ai", estimate: { energy_kj_100g: 900, sugars_g_100g: 5, sat_fat_g_100g: 3, salt_g_100g: 0.8, fibre_g_100g: 2, protein_g_100g: 12, fruit_veg_legume_pct: 10, confidence: 0.6 } };
  },
};

before(async () => {
  t = await testDatabase();
  db = t.db;
  registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } });
  const doc = syntheticProfileDocument("cd");
  delete doc.synthetic; doc.country.status = "LIVE"; doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("test", doc);
  registry.publish("test", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "test", at: new Date() }])));
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  const brand = registry.published("CD")!.profile.experience.brand_id;
  const u = await db.tx({}, (sql) => createUser(sql, { phone: "+243810000040", displayName: "C", homeCountry: "CD" }));
  await db.tx({ country: "CD" }, async (sql) => {
    await ensureGroup(sql, { id: "rg-n", country: "CD", name: "N", createdBy: u.id });
    const branch = await createBranch(sql, { country_iso2: "CD", brand_id: brand, restaurant_group_id: "rg-n", name: "B", city: null, commune: "Gombe", lat: "-4.3", lng: "15.3", store_type: "RESTAURANT" }, true);
    branchId = branch.id;
    await addMenuItem(sql, branch, { names: { fr: "Poulet braisé" }, prices: { CDF: "5000" } }); // no nutrition facts
    await publishBranch(sql, branchId);
  });
});
after(async () => { await t.drop(); });

test("the sandbox estimator is a no-op — no AI, nothing fabricated", async () => {
  const svc = new NutritionService(db, registry, new SandboxNutritionEstimator());
  const r = await svc.estimateMissing("CD", { limit: 10 });
  assert.equal(r.ran, false);
  assert.equal(r.estimated, 0);
});

test("the AI fill estimates a dish, tags it ai_estimate, and the dish gets a Nutri-Score", async () => {
  const svc = new NutritionService(db, registry, fakeBrain);
  const r = await svc.estimateMissing("CD", { limit: 10 });
  assert.equal(r.ran, true);
  assert.equal(r.estimated, 1);

  const items = await db.tx({ country: "CD" }, (sql) => menuOf(sql, branchId));
  const dish = items.find((i) => i.names.fr === "Poulet braisé")!;
  assert.equal(dish.nutrition_source, "ai_estimate");
  assert.equal(dish.nutrition.energy_kj_100g, 900, "the per-100g estimate was stored");
  // The automatic Nutri-Score now resolves from the estimate.
  assert.ok(gradeFromFacts(dish.nutrition)?.grade, "a grade is now computable");

  // Idempotent: a second run finds nothing new (the dish now has a basis).
  const again = await svc.estimateMissing("CD", { limit: 10 });
  assert.equal(again.estimated, 0);
});
