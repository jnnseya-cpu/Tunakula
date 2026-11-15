/**
 * Nutri-Score — the 2017 front-of-pack algorithm (foods and beverages), pure and deterministic.
 *
 * It offsets "negative" nutrients (energy, sugars, saturated fat, sodium) against "positive" ones (fruit/
 * vegetables/legumes, fibre, protein) on a per-100 g (or per-100 ml for drinks) basis, then maps the net points
 * to a letter A–E. A health label must never be invented: `nutriScore` returns null when any required nutrient
 * is missing, so callers show "unavailable" rather than a fabricated grade.
 *
 * Reference: Santé publique France Nutri-Score 2017 scoring. The 2023 update changes some thresholds; this is the
 * widely-documented original and is swappable behind the same interface if a market adopts the newer tables.
 */

export type NutriScoreGrade = "A" | "B" | "C" | "D" | "E";

/** Per-100 g (food) or per-100 ml (beverage) nutrient inputs. salt_g and sodium_mg are interchangeable. */
export interface Nutrients {
  readonly energy_kj: number;        // kilojoules
  readonly sugars_g: number;
  readonly saturated_fat_g: number;
  readonly sodium_mg?: number;       // or give salt_g
  readonly salt_g?: number;          // salt_g = sodium_mg × 2.5 / 1000
  readonly fibre_g: number;
  readonly protein_g: number;
  readonly fruit_veg_legume_pct: number; // 0–100
  readonly kind?: "food" | "beverage";    // default "food"
  readonly is_water?: boolean;             // plain water scores A outright
}

export interface NutriScoreResult {
  readonly grade: NutriScoreGrade;
  readonly points: number;      // final net points (lower = healthier)
  readonly negative: number;    // total negative points
  readonly positive: number;    // total positive points counted
  readonly kind: "food" | "beverage";
}

/** points for a value given ascending thresholds: first threshold the value is ≤ wins its index; above all → max. */
function tier(value: number, thresholds: readonly number[]): number {
  for (let i = 0; i < thresholds.length; i++) if (value <= thresholds[i]!) return i;
  return thresholds.length;
}

// Negative-nutrient thresholds (points 0..10). Energy & sugars differ for beverages; sat fat & sodium are shared.
const ENERGY_FOOD = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGARS_FOOD = [4.5, 9, 13.5, 18, 22.5, 27, 31, 36, 40, 45];
const ENERGY_BEV = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270];
const SUGARS_BEV = [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5];
const SAT_FAT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SODIUM = [90, 180, 270, 360, 450, 540, 630, 720, 810, 900]; // mg

// Positive-nutrient thresholds. Fibre & protein (points 0..5) shared; fruit/veg differs food vs beverage.
const FIBRE = [0.9, 1.9, 2.8, 3.7, 4.7];
const PROTEIN = [1.6, 3.2, 4.8, 6.4, 8.0];
const FRUIT_FOOD = [40, 60, 80];      // 0,1,2 then >80 → 5
const FRUIT_BEV = [40, 60, 80];       // 0,2,4 then >80 → 10 (handled below)

function fruitPointsFood(pct: number): number {
  const t = tier(pct, FRUIT_FOOD); // 0..3
  return t >= 3 ? 5 : t;           // ≤40→0, ≤60→1, ≤80→2, >80→5
}
function fruitPointsBeverage(pct: number): number {
  const t = tier(pct, FRUIT_BEV);  // 0..3
  return t >= 3 ? 10 : t * 2;      // ≤40→0, ≤60→2, ≤80→4, >80→10
}

/** Input to nutriScore: every nutrient optional AND allowed to be explicitly undefined (so callers can map a
 *  facts record straight in and let the function decide completeness). */
export type NutrientsInput = { readonly [K in keyof Nutrients]?: Nutrients[K] | undefined };

/** Compute the Nutri-Score, or null when any required nutrient is absent/invalid (never fabricate a grade). */
export function nutriScore(n: NutrientsInput | null | undefined): NutriScoreResult | null {
  if (!n) return null;
  const sodium = n.sodium_mg ?? (n.salt_g !== undefined ? n.salt_g * 400 : undefined);
  const required = [n.energy_kj, n.sugars_g, n.saturated_fat_g, sodium, n.fibre_g, n.protein_g, n.fruit_veg_legume_pct];
  if (required.some((v) => typeof v !== "number" || !Number.isFinite(v) || (v as number) < 0)) return null;

  const kind = n.kind === "beverage" ? "beverage" : "food";
  if (kind === "beverage" && n.is_water) return { grade: "A", points: 0, negative: 0, positive: 0, kind };

  const energyTable = kind === "beverage" ? ENERGY_BEV : ENERGY_FOOD;
  const sugarTable = kind === "beverage" ? SUGARS_BEV : SUGARS_FOOD;
  const negative = tier(n.energy_kj!, energyTable) + tier(n.sugars_g!, sugarTable) + tier(n.saturated_fat_g!, SAT_FAT) + tier(sodium!, SODIUM);

  const fruitPts = kind === "beverage" ? fruitPointsBeverage(n.fruit_veg_legume_pct!) : fruitPointsFood(n.fruit_veg_legume_pct!);
  const fibrePts = tier(n.fibre_g!, FIBRE);
  const proteinPts = tier(n.protein_g!, PROTEIN);

  // Protein rule: when negatives are high (≥11) and fruit points are below 5, protein is NOT subtracted —
  // unless fruit/veg points are maxed. Fibre and the fruit/veg component always count.
  const countProtein = negative < 11 || fruitPts >= 5;
  const positive = fruitPts + fibrePts + (countProtein ? proteinPts : 0);
  const points = negative - positive;

  return { grade: kind === "beverage" ? beverageGrade(points, false) : foodGrade(points), points, negative, positive, kind };
}

/** The explicit per-100 g/ml nutrition keys a dish must carry for an accurate Nutri-Score. Kept separate from the
 *  platform's per-serving display figures (kcal/protein_g/…), because mixing bases would corrupt the grade. */
export const NUTRISCORE_FACT_KEYS = [
  "energy_kj_100g", "sugars_g_100g", "sat_fat_g_100g", "salt_g_100g", "fibre_g_100g", "protein_g_100g", "fruit_veg_legume_pct",
] as const;

/** Map a dish's stored nutrition facts to a Nutri-Score, or null when the per-100 g inputs are incomplete. */
export function gradeFromFacts(facts: Record<string, number> | null | undefined, opts: { kind?: "food" | "beverage"; isWater?: boolean } = {}): NutriScoreResult | null {
  if (!facts) return null;
  return nutriScore({
    energy_kj: facts.energy_kj_100g,
    sugars_g: facts.sugars_g_100g,
    saturated_fat_g: facts.sat_fat_g_100g,
    salt_g: facts.salt_g_100g,
    fibre_g: facts.fibre_g_100g,
    protein_g: facts.protein_g_100g,
    fruit_veg_legume_pct: facts.fruit_veg_legume_pct,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.isWater ? { is_water: opts.isWater } : {}),
  });
}

/** Food grade bands (spec §5 letter scale): A ≤ -1, B 0–2, C 3–10, D 11–18, E ≥ 19. */
export function foodGrade(points: number): NutriScoreGrade {
  if (points <= -1) return "A";
  if (points <= 2) return "B";
  if (points <= 10) return "C";
  if (points <= 18) return "D";
  return "E";
}

/** Beverage grade bands: water → A (handled earlier); B ≤ 1, C 2–5, D 6–9, E ≥ 10. */
export function beverageGrade(points: number, isWater: boolean): NutriScoreGrade {
  if (isWater) return "A";
  if (points <= 1) return "B";
  if (points <= 5) return "C";
  if (points <= 9) return "D";
  return "E";
}
