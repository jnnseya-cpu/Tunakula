/**
 * The deterministic nutrition-estimator fallback. It makes NO estimate — you cannot honestly derive per-100 g
 * sugars, saturated fat, fibre and fruit/veg share from a dish name alone, so rather than fabricate a health
 * label it returns "none". With no model configured, dishes simply carry no Nutri-Score until real data arrives.
 */
import type { NutritionEstimateInput, NutritionEstimateResult, NutritionEstimatorBrain } from "@tunakula/ts-contracts";

export class SandboxNutritionEstimator implements NutritionEstimatorBrain {
  readonly id = "sandbox";
  async estimate(_input: NutritionEstimateInput): Promise<NutritionEstimateResult> {
    return { estimate: null, source: "none" };
  }
}
