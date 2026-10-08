/** Catalogue persistence (§21 branch / menu_item). Prices are minor units per currency (MR-1, MR-2). */
import type { Sql } from "../db/db.ts";

export interface BranchRow {
  id: string;
  country_iso2: string;
  brand_id: string;
  restaurant_group_id: string;
  name: string;
  city: string | null;
  commune: string | null;
  lat: string;
  lng: string;
  status: "OPEN" | "CLOSED" | "PAUSED";
}

export interface VariationOption { id: string; name: string; price: string }
export interface Variation { id: string; name: string; type: "SINGLE" | "MULTI"; required: boolean; min: number; max: number; options: VariationOption[] }
export interface Addon { id: string; name: string; price: string }

export interface MenuItemRow {
  id: string;
  branch_id: string;
  names: Record<string, string>;
  description: Record<string, string>;
  prices: Record<string, string>;
  category: string | null;
  veg: boolean | null;
  tags: string[];
  allergens: string[];
  available: boolean;
  recommended: boolean;
  variations: Variation[];
  addons: Addon[];
  dietary: string[];
  nutrition: Record<string, number>;
}

export interface MenuItemInput {
  names: Record<string, string>;
  description?: Record<string, string>;
  prices: Record<string, string>;
  category?: string | null;
  veg?: boolean | null;
  tags?: string[];
  allergens?: string[];
  recommended?: boolean;
  variations?: Variation[];
  addons?: Addon[];
  dietary?: string[];
  nutrition?: Record<string, number>;
}

const ITEM_COLUMNS = "id, branch_id, names, description, prices, category, veg, tags, allergens, available, recommended, variations, addons, dietary, nutrition";

export async function createBranch(sql: Sql, b: Omit<BranchRow, "id" | "status">): Promise<BranchRow> {
  const [row] = await sql.query<BranchRow & Record<string, unknown>>(
    `INSERT INTO catalogue.branch (country_iso2, brand_id, restaurant_group_id, name, city, commune, lat, lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, country_iso2, brand_id, restaurant_group_id, name, city, commune, lat::text, lng::text, status`,
    [b.country_iso2, b.brand_id, b.restaurant_group_id, b.name, b.city, b.commune, b.lat, b.lng],
  );
  return row as BranchRow;
}

export async function getBranch(sql: Sql, id: string): Promise<BranchRow | undefined> {
  const rows = await sql.query<BranchRow & Record<string, unknown>>(
    "SELECT id, country_iso2, brand_id, restaurant_group_id, name, city, commune, lat::text, lng::text, status FROM catalogue.branch WHERE id = $1",
    [id],
  );
  return rows[0];
}

export async function addMenuItem(sql: Sql, branch: BranchRow, i: MenuItemInput): Promise<MenuItemRow> {
  const [row] = await sql.query<MenuItemRow & Record<string, unknown>>(
    `INSERT INTO catalogue.menu_item (branch_id, country_iso2, brand_id, names, description, prices, category, veg, tags, allergens, recommended, variations, addons, dietary, nutrition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${ITEM_COLUMNS}`,
    [branch.id, branch.country_iso2, branch.brand_id, JSON.stringify(i.names), JSON.stringify(i.description ?? {}), JSON.stringify(i.prices), i.category ?? null, i.veg ?? null, i.tags ?? [], i.allergens ?? [], i.recommended ?? false, JSON.stringify(i.variations ?? []), JSON.stringify(i.addons ?? []), i.dietary ?? [], JSON.stringify(i.nutrition ?? {})],
  );
  return row as MenuItemRow;
}

/** Updates the given fields of one item; returns the new row, or undefined if it is not in this branch. */
export async function updateMenuItem(sql: Sql, branchId: string, itemId: string, i: MenuItemInput): Promise<MenuItemRow | undefined> {
  const [row] = await sql.query<MenuItemRow & Record<string, unknown>>(
    `UPDATE catalogue.menu_item
       SET names = $3, description = $4, prices = $5, category = $6, veg = $7, tags = $8, allergens = $9, recommended = $10, variations = $11, addons = $12, dietary = $13, nutrition = $14, updated_at = now()
     WHERE id = $1 AND branch_id = $2 RETURNING ${ITEM_COLUMNS}`,
    [itemId, branchId, JSON.stringify(i.names), JSON.stringify(i.description ?? {}), JSON.stringify(i.prices), i.category ?? null, i.veg ?? null, i.tags ?? [], i.allergens ?? [], i.recommended ?? false, JSON.stringify(i.variations ?? []), JSON.stringify(i.addons ?? []), i.dietary ?? [], JSON.stringify(i.nutrition ?? {})],
  );
  return row as MenuItemRow | undefined;
}

export async function setAvailability(sql: Sql, itemId: string, available: boolean): Promise<boolean> {
  const rows = await sql.query("UPDATE catalogue.menu_item SET available = $2, updated_at = now() WHERE id = $1 RETURNING id", [itemId, available]);
  return rows.length === 1;
}

export async function menuOf(sql: Sql, branchId: string): Promise<MenuItemRow[]> {
  return sql.query<MenuItemRow & Record<string, unknown>>(
    `SELECT ${ITEM_COLUMNS} FROM catalogue.menu_item WHERE branch_id = $1 ORDER BY category NULLS LAST, created_at`,
    [branchId],
  );
}
