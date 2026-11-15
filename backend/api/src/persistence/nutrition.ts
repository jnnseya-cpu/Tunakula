/**
 * Nutrition-estimate persistence. Finds dishes that still lack the per-100 g Nutri-Score inputs and records an
 * AI estimate against them, tagged with its provenance. Runs inside a country transaction (FORCE RLS scopes it).
 */
import type { Sql } from "../db/db.ts";

export interface NutritionCandidate {
  readonly id: string;
  readonly names: Record<string, string>;
  readonly category: string | null;
  readonly tags: string[];
  readonly description: Record<string, string>;
  readonly addons: { name: string }[];
  readonly variations: { name: string; options: { name: string }[] }[];
}

/** Published-branch dishes with no nutrition basis set yet and no per-100 g energy value — the estimate backlog. */
export async function candidatesForEstimate(sql: Sql, limit: number): Promise<NutritionCandidate[]> {
  const rows = await sql.query<{ id: string; names: Record<string, string>; category: string | null; tags: string[]; description: Record<string, string>; addons: { name: string }[]; variations: { name: string; options: { name: string }[] }[] }>(
    `SELECT mi.id::text AS id, mi.names, mi.category, mi.tags, mi.description, mi.addons, mi.variations
       FROM catalogue.menu_item mi
       JOIN catalogue.branch b ON b.id = mi.branch_id
      WHERE b.published_at IS NOT NULL
        AND mi.nutrition_source IS NULL
        AND NOT (mi.nutrition ? 'energy_kj_100g')
      ORDER BY mi.updated_at ASC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Merge the per-100 g estimate into the dish's nutrition and record its provenance (e.g. 'ai_estimate'). */
export async function storeNutrition(sql: Sql, itemId: string, facts: Record<string, number>, source: string): Promise<void> {
  await sql.query(
    "UPDATE catalogue.menu_item SET nutrition = nutrition || $2::jsonb, nutrition_source = $3, updated_at = now() WHERE id = $1",
    [itemId, JSON.stringify(facts), source],
  );
}
