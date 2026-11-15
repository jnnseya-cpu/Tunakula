/**
 * The nutrition-estimator port (§AI). A dish on a food-delivery menu rarely ships with lab nutrition data, so a
 * language model estimates the per-100 g/ml figures the Nutri-Score needs from the dish's name, category and
 * ingredients. This is backed by a hosted model with an HONEST fallback: when no model is configured the result
 * is an explicit "no estimate", never a fabricated one. Every estimate is marked as an AI estimate so it is shown
 * and stored as estimated — never as measured or verified — and a human can override or confirm it.
 */
export interface NutritionEstimateInput {
  readonly name: string;
  readonly category?: string;
  readonly cuisines?: readonly string[];
  readonly description?: string;
  /** Component names (add-ons / variation options) that hint at composition, e.g. "frites", "mayonnaise". */
  readonly ingredients?: readonly string[];
  readonly kind: "food" | "beverage";
  readonly lang: "fr" | "en";
}

/** Per-100 g (food) or per-100 ml (beverage) estimate — exactly the inputs the Nutri-Score algorithm consumes. */
export interface NutritionEstimate {
  readonly energy_kj_100g: number;
  readonly sugars_g_100g: number;
  readonly sat_fat_g_100g: number;
  readonly salt_g_100g: number;
  readonly fibre_g_100g: number;
  readonly protein_g_100g: number;
  readonly fruit_veg_legume_pct: number;
  /** The model's self-reported confidence 0..1. Advisory only; a low value can route a dish to human review. */
  readonly confidence: number;
}

export interface NutritionEstimateResult {
  /** The per-100 g estimate, or null when none could be produced (no model, a refusal, an unparseable reply). */
  readonly estimate: NutritionEstimate | null;
  /** "ai" when a model produced it; "none" when there was no estimate (honest — never a fabricated grade). */
  readonly source: "ai" | "none";
}

export interface NutritionEstimatorBrain {
  readonly id: string;
  estimate(input: NutritionEstimateInput): Promise<NutritionEstimateResult>;
}
