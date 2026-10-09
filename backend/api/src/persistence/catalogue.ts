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
  hours?: Record<string, [string, string][]>;
  special_hours?: Record<string, [string, string][]>;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: Record<string, string>;
  cuisines?: string[];
  min_order_minor?: string | null;
  logo_id?: string | null;
  cover_id?: string | null;
}

/** The editable business-profile fields of a branch (address, contact, about, cuisines, order minimum, logo, cover). */
export interface BranchProfilePatch {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: Record<string, string>;
  cuisines?: string[];
  minOrderMinor?: string | null;
  logoId?: string | null;
  coverId?: string | null;
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
  age_restricted: boolean;
  image_id: string | null;
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
  ageRestricted?: boolean;
  imageId?: string | null;
}

const ITEM_COLUMNS = "id, branch_id, names, description, prices, category, veg, tags, allergens, available, recommended, variations, addons, dietary, nutrition, age_restricted, image_id";

export interface GroupRow { id: string; country_iso2: string; name: string; invite_code: string | null; created_by: string | null }

/** Creates the brand (restaurant group) if it does not exist yet; keeps the stored name on conflict. */
export async function ensureGroup(sql: Sql, g: { id: string; country: string; name: string; createdBy?: string | null }): Promise<GroupRow> {
  const [row] = await sql.query<GroupRow & Record<string, unknown>>(
    `INSERT INTO catalogue.restaurant_group (id, country_iso2, name, created_by)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET updated_at = now()
     RETURNING id, country_iso2, name, invite_code, created_by`,
    [g.id, g.country, g.name.slice(0, 120), g.createdBy ?? null],
  );
  return row as GroupRow;
}

export async function getGroup(sql: Sql, id: string): Promise<GroupRow | undefined> {
  const [row] = await sql.query<GroupRow & Record<string, unknown>>("SELECT id, country_iso2, name, invite_code, created_by FROM catalogue.restaurant_group WHERE id = $1", [id]);
  return row;
}

export async function getGroupByInvite(sql: Sql, code: string): Promise<GroupRow | undefined> {
  const [row] = await sql.query<GroupRow & Record<string, unknown>>("SELECT id, country_iso2, name, invite_code, created_by FROM catalogue.restaurant_group WHERE invite_code = $1", [code]);
  return row;
}

export async function setInviteCode(sql: Sql, id: string, code: string): Promise<void> {
  await sql.query("UPDATE catalogue.restaurant_group SET invite_code = $2, updated_at = now() WHERE id = $1", [id, code]);
}

export async function createBranch(sql: Sql, b: Omit<BranchRow, "id" | "status">, published = false): Promise<BranchRow> {
  const [row] = await sql.query<BranchRow & Record<string, unknown>>(
    `INSERT INTO catalogue.branch (country_iso2, brand_id, restaurant_group_id, name, city, commune, lat, lng, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9 THEN now() ELSE NULL END) RETURNING id, country_iso2, brand_id, restaurant_group_id, name, city, commune, lat::text, lng::text, status`,
    [b.country_iso2, b.brand_id, b.restaurant_group_id, b.name, b.city, b.commune, b.lat, b.lng, published],
  );
  return row as BranchRow;
}

/** Marks a branch published (discoverable on the storefront and in Tunakula Nzela). Idempotent. */
export async function publishBranch(sql: Sql, branchId: string): Promise<void> {
  await sql.query("UPDATE catalogue.branch SET published_at = coalesce(published_at, now()), updated_at = now() WHERE id = $1", [branchId]);
}

export async function getBranch(sql: Sql, id: string): Promise<BranchRow | undefined> {
  const rows = await sql.query<BranchRow & Record<string, unknown>>(
    `SELECT id, country_iso2, brand_id, restaurant_group_id, name, city, commune, lat::text, lng::text, status, hours, special_hours,
            address, phone, email, description, cuisines, min_order_minor::text AS min_order_minor, logo_id::text AS logo_id, cover_id::text AS cover_id
       FROM catalogue.branch WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Updates only the profile fields that are present in the patch; leaves the rest unchanged. */
export async function updateBranchProfile(sql: Sql, branchId: string, p: BranchProfilePatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [branchId];
  const add = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (p.address !== undefined) add("address", p.address);
  if (p.phone !== undefined) add("phone", p.phone);
  if (p.email !== undefined) add("email", p.email);
  if (p.description !== undefined) add("description", JSON.stringify(p.description));
  if (p.cuisines !== undefined) add("cuisines", p.cuisines);
  if (p.minOrderMinor !== undefined) add("min_order_minor", p.minOrderMinor);
  if (p.logoId !== undefined) add("logo_id", p.logoId);
  if (p.coverId !== undefined) add("cover_id", p.coverId);
  if (sets.length === 0) return;
  await sql.query(`UPDATE catalogue.branch SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
}

export async function addMenuItem(sql: Sql, branch: BranchRow, i: MenuItemInput): Promise<MenuItemRow> {
  const [row] = await sql.query<MenuItemRow & Record<string, unknown>>(
    `INSERT INTO catalogue.menu_item (branch_id, country_iso2, brand_id, names, description, prices, category, veg, tags, allergens, recommended, variations, addons, dietary, nutrition, age_restricted, image_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING ${ITEM_COLUMNS}`,
    [branch.id, branch.country_iso2, branch.brand_id, JSON.stringify(i.names), JSON.stringify(i.description ?? {}), JSON.stringify(i.prices), i.category ?? null, i.veg ?? null, i.tags ?? [], i.allergens ?? [], i.recommended ?? false, JSON.stringify(i.variations ?? []), JSON.stringify(i.addons ?? []), i.dietary ?? [], JSON.stringify(i.nutrition ?? {}), i.ageRestricted ?? false, i.imageId ?? null],
  );
  return row as MenuItemRow;
}

/** Updates the given fields of one item; returns the new row, or undefined if it is not in this branch. */
export async function updateMenuItem(sql: Sql, branchId: string, itemId: string, i: MenuItemInput): Promise<MenuItemRow | undefined> {
  const [row] = await sql.query<MenuItemRow & Record<string, unknown>>(
    `UPDATE catalogue.menu_item
       SET names = $3, description = $4, prices = $5, category = $6, veg = $7, tags = $8, allergens = $9, recommended = $10, variations = $11, addons = $12, dietary = $13, nutrition = $14, age_restricted = $15, image_id = $16, updated_at = now()
     WHERE id = $1 AND branch_id = $2 RETURNING ${ITEM_COLUMNS}`,
    [itemId, branchId, JSON.stringify(i.names), JSON.stringify(i.description ?? {}), JSON.stringify(i.prices), i.category ?? null, i.veg ?? null, i.tags ?? [], i.allergens ?? [], i.recommended ?? false, JSON.stringify(i.variations ?? []), JSON.stringify(i.addons ?? []), i.dietary ?? [], JSON.stringify(i.nutrition ?? {}), i.ageRestricted ?? false, i.imageId ?? null],
  );
  return row as MenuItemRow | undefined;
}

export async function setAvailability(sql: Sql, itemId: string, available: boolean): Promise<boolean> {
  const rows = await sql.query("UPDATE catalogue.menu_item SET available = $2, updated_at = now() WHERE id = $1 RETURNING id", [itemId, available]);
  return rows.length === 1;
}

/** Copies every dish of one branch into another (new items), keeping prices, photos, variations and add-ons. */
export async function copyMenu(sql: Sql, source: BranchRow, target: BranchRow): Promise<number> {
  const items = await menuOf(sql, source.id);
  for (const it of items) {
    await addMenuItem(sql, target, {
      names: it.names, description: it.description, prices: it.prices, category: it.category, veg: it.veg,
      tags: it.tags, allergens: it.allergens, recommended: it.recommended, variations: it.variations, addons: it.addons,
      dietary: it.dietary, nutrition: it.nutrition, ageRestricted: it.age_restricted, imageId: it.image_id,
    });
  }
  return items.length;
}

export async function menuOf(sql: Sql, branchId: string): Promise<MenuItemRow[]> {
  return sql.query<MenuItemRow & Record<string, unknown>>(
    `SELECT ${ITEM_COLUMNS} FROM catalogue.menu_item WHERE branch_id = $1 ORDER BY category NULLS LAST, created_at`,
    [branchId],
  );
}
