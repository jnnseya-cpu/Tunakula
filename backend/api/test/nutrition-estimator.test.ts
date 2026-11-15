/**
 * Nutrition estimator: the LLM brain (offline, fake transport) and the deterministic fallback. Proves strict
 * validation (missing/out-of-range/unparseable replies are rejected, never stored) and the honest no-estimate path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LlmNutritionEstimator, parseEstimate, type LlmTransport } from "../src/modules/nutriscore/llm-nutrition-estimator.ts";
import { SandboxNutritionEstimator } from "../src/modules/nutriscore/sandbox-nutrition-estimator.ts";

const GOOD = '{"energy_kj_100g":900,"sugars_g_100g":5,"sat_fat_g_100g":3,"salt_g_100g":0.8,"fibre_g_100g":2,"protein_g_100g":12,"fruit_veg_legume_pct":10,"confidence":0.6}';
const reply = (text: string): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
const input = { name: "Poulet braisé", category: "Grillades", kind: "food" as const, lang: "fr" as const };

test("parseEstimate accepts a valid reply and clamps confidence", () => {
  const e = parseEstimate(GOOD);
  assert.equal(e?.energy_kj_100g, 900);
  assert.equal(e?.protein_g_100g, 12);
  assert.equal(e?.confidence, 0.6);
  assert.equal(parseEstimate('prose… ' + GOOD + ' …trailing')?.energy_kj_100g, 900, "tolerates surrounding prose");
});

test("parseEstimate rejects unknown, out-of-range, missing-field and unparseable replies", () => {
  assert.equal(parseEstimate('{"unknown":true}'), null);
  assert.equal(parseEstimate('{"energy_kj_100g":99999,"sugars_g_100g":5,"sat_fat_g_100g":3,"salt_g_100g":0.8,"fibre_g_100g":2,"protein_g_100g":12,"fruit_veg_legume_pct":10}'), null, "energy out of range");
  assert.equal(parseEstimate('{"energy_kj_100g":900}'), null, "missing fields");
  assert.equal(parseEstimate('not json'), null);
});

test("the LLM estimator returns an AI estimate on a good reply", async () => {
  const brain = new LlmNutritionEstimator({ apiKey: "k", model: "m", transport: reply(GOOD) }, new SandboxNutritionEstimator());
  const r = await brain.estimate(input);
  assert.equal(r.source, "ai");
  assert.equal(r.estimate?.protein_g_100g, 12);
});

test("it falls back to no-estimate on an HTTP error or a bad reply — never fabricates", async () => {
  const errorTransport: LlmTransport = async () => ({ status: 503, body: {} });
  const onError = new LlmNutritionEstimator({ apiKey: "k", model: "m", transport: errorTransport }, new SandboxNutritionEstimator());
  assert.deepEqual(await onError.estimate(input), { estimate: null, source: "none" });

  const onGarbage = new LlmNutritionEstimator({ apiKey: "k", model: "m", transport: reply("I can't help with that") }, new SandboxNutritionEstimator());
  assert.deepEqual(await onGarbage.estimate(input), { estimate: null, source: "none" });
});

test("the sandbox estimator always makes no estimate", async () => {
  assert.deepEqual(await new SandboxNutritionEstimator().estimate(input), { estimate: null, source: "none" });
});
