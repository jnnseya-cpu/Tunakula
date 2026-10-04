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

export interface MenuItemRow {
  id: string;
  branch_id: string;
  names: Record<string, string>;
  prices: Record<string, string>;
  tags: string[];
  allergens: string[];
  available: boolean;
}

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

export async function addMenuItem(
  sql: Sql,
  i: { branch: BranchRow; names: Record<string, string>; prices: Record<string, string>; tags?: string[]; allergens?: string[] },
): Promise<MenuItemRow> {
  const [row] = await sql.query<MenuItemRow & Record<string, unknown>>(
    `INSERT INTO catalogue.menu_item (branch_id, country_iso2, brand_id, names, prices, tags, allergens)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, branch_id, names, prices, tags, allergens, available`,
    [i.branch.id, i.branch.country_iso2, i.branch.brand_id, JSON.stringify(i.names), JSON.stringify(i.prices), i.tags ?? [], i.allergens ?? []],
  );
  return row as MenuItemRow;
}

export async function setAvailability(sql: Sql, itemId: string, available: boolean): Promise<boolean> {
  const rows = await sql.query("UPDATE catalogue.menu_item SET available = $2, updated_at = now() WHERE id = $1 RETURNING id", [itemId, available]);
  return rows.length === 1;
}

export async function menuOf(sql: Sql, branchId: string): Promise<MenuItemRow[]> {
  return sql.query<MenuItemRow & Record<string, unknown>>(
    "SELECT id, branch_id, names, prices, tags, allergens, available FROM catalogue.menu_item WHERE branch_id = $1 ORDER BY created_at",
    [branchId],
  );
}
