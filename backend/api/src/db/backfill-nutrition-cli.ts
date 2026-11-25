/**
 * Fast, headless Nutri-Score backfill for a market. Estimates per-100 g nutrition for every published dish that
 * lacks it, in bounded batches, until no more progress is made — far quicker than the gentle background trickle.
 *
 *   DATABASE_OWNER_URL=... node --import tsx src/db/backfill-nutrition-cli.ts CD
 *
 * It builds the AI estimator from the SAME Integrations keys the API uses (loaded from the database), so it needs
 * no extra configuration. With no AI model configured it exits without changing anything (never fabricates a
 * grade). Dishes the model cannot estimate are left ungraded and the run stops rather than looping on them.
 */
import { connect } from "./db.ts";
import { loadIntegrationConfig } from "../app/integrations.ts";
import { loadVersions } from "../persistence/config.ts";
import { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { NutritionService } from "../app/nutrition.ts";
import { countMissing } from "../persistence/nutrition.ts";
import { LlmNutritionEstimator } from "../modules/nutriscore/llm-nutrition-estimator.ts";
import { SandboxNutritionEstimator } from "../modules/nutriscore/sandbox-nutrition-estimator.ts";

const iso2 = (process.argv[2] ?? "CD").toUpperCase();
const url = process.env["DATABASE_OWNER_URL"] ?? process.env["DATABASE_URL"];
if (!url) throw new Error("set DATABASE_OWNER_URL (or DATABASE_URL)");

const db = connect(url, { max: 1 });
try {
  const integ = await loadIntegrationConfig(db);
  const envc = (k: string) => process.env[k] ?? integ.get(k);
  const key = envc("TUNAKULA_ASSISTANT_API_KEY");
  const provider = (envc("TUNAKULA_ASSISTANT_PROVIDER") ?? "anthropic").toLowerCase();
  const model = envc("TUNAKULA_ASSISTANT_MODEL") ?? "claude-opus-5-5";
  const estimator = key && provider === "anthropic"
    ? new LlmNutritionEstimator({ apiKey: key, model }, new SandboxNutritionEstimator())
    : new SandboxNutritionEstimator();

  const registry = new CountryConfigRegistry({
    brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
    connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
    apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
  });
  registry.restore(await db.tx({}, loadVersions));
  if (!registry.published(iso2)) throw new Error(`market ${iso2} is not published`);

  const svc = new NutritionService(db, registry, estimator);
  if (!svc.aiConfigured) {
    console.error("No AI model configured (set the AI provider + key in admin → Integrations). Nothing to do.");
    process.exit(2);
  }

  let before = await db.tx({ country: iso2 }, (sql) => countMissing(sql));
  console.log(`${iso2}: ${before} dish(es) need a Nutri-Score estimate.`);
  let total = 0;
  for (;;) {
    const r = await svc.estimateMissing(iso2, { limit: 100 }); // minIntervalMs defaults to 0 → no cadence guard
    total += r.estimated;
    const remaining = await db.tx({ country: iso2 }, (sql) => countMissing(sql));
    console.log(JSON.stringify({ estimated: r.estimated, skipped: r.skipped, remaining }));
    if (remaining === 0 || remaining >= before) break; // done, or this pass made no progress (un-estimable dishes)
    before = remaining;
  }
  console.log(`Done: ${total} dish(es) estimated for ${iso2}.`);
} finally {
  await db.close();
}
