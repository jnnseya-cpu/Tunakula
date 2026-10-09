/** Catalogue persistence (§21 branch / menu_item). Prices are minor units per currency (MR-1, MR-2). */
import type { Sql } from "../db/db.ts";
import { isOpenNow } from "../modules/catalogue/hours.ts";

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
  price_markup_bps?: number;
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
  source_item_id: string | null;
  /** Dayparting: weekly [open, close] windows (branch-local) when the dish is orderable; empty = always. */
  availability_hours: Record<string, [string, string][]>;
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
  sourceItemId?: string | null;
  availabilityHours?: Record<string, [string, string][]>;
}

const ITEM_COLUMNS = "id, branch_id, names, description, prices, category, veg, tags, allergens, available, recommended, variations, addons, dietary, nutrition, age_restricted, image_id, source_item_id, availability_hours";

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
            address, phone, email, description, cuisines, min_order_minor::text AS min_order_minor, logo_id::text AS logo_id, cover_id::text AS cover_id, price_markup_bps
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
    `INSERT INTO catalogue.menu_item (branch_id, country_iso2, brand_id, names, description, prices, category, veg, tags, allergens, recommended, variations, addons, dietary, nutrition, age_restricted, image_id, source_item_id, availability_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING ${ITEM_COLUMNS}`,
    [branch.id, branch.country_iso2, branch.brand_id, JSON.stringify(i.names), JSON.stringify(i.description ?? {}), JSON.stringify(i.prices), i.category ?? null, i.veg ?? null, i.tags ?? [], i.allergens ?? [], i.recommended ?? false, JSON.stringify(i.variations ?? []), JSON.stringify(i.addons ?? []), i.dietary ?? [], JSON.stringify(i.nutrition ?? {}), i.ageRestricted ?? false, i.imageId ?? null, i.sourceItemId ?? null, JSON.stringify(i.availabilityHours ?? {})],
  );
  return row as MenuItemRow;
}

/** Updates the given fields of one item; returns the new row, or undefined if it is not in this branch. */
export async function updateMenuItem(sql: Sql, branchId: string, itemId: string, i: MenuItemInput): Promise<MenuItemRow | undefined> {
  const [row] = await sql.query<MenuItemRow & Record<string, unknown>>(
    `UPDATE catalogue.menu_item
       SET names = $3, description = $4, prices = $5, category = $6, veg = $7, tags = $8, allergens = $9, recommended = $10, variations = $11, addons = $12, dietary = $13, nutrition = $14, age_restricted = $15, image_id = $16, availability_hours = $17, updated_at = now()
     WHERE id = $1 AND branch_id = $2 RETURNING ${ITEM_COLUMNS}`,
    [itemId, branchId, JSON.stringify(i.names), JSON.stringify(i.description ?? {}), JSON.stringify(i.prices), i.category ?? null, i.veg ?? null, i.tags ?? [], i.allergens ?? [], i.recommended ?? false, JSON.stringify(i.variations ?? []), JSON.stringify(i.addons ?? []), i.dietary ?? [], JSON.stringify(i.nutrition ?? {}), i.ageRestricted ?? false, i.imageId ?? null, JSON.stringify(i.availabilityHours ?? {})],
  );
  return row as MenuItemRow | undefined;
}

export async function setAvailability(sql: Sql, itemId: string, available: boolean): Promise<boolean> {
  const rows = await sql.query("UPDATE catalogue.menu_item SET available = $2, updated_at = now() WHERE id = $1 RETURNING id", [itemId, available]);
  return rows.length === 1;
}

/**
 * Pushes one branch's menu into another by lineage: each source dish is linked to its copy, so a new dish
 * is added and an existing copy is updated in place (keeping the target's own availability). This is both the
 * first copy (all added) and later syncs (edits flow down). Target-only dishes are left untouched.
 */
export async function syncMenu(sql: Sql, source: BranchRow, target: BranchRow, markupBps = 0): Promise<{ added: number; updated: number }> {
  const items = await menuOf(sql, source.id);
  // Which source dishes already have a copy in the target?
  const existing = await sql.query<{ id: string; source_item_id: string }>(
    "SELECT id, source_item_id::text AS source_item_id FROM catalogue.menu_item WHERE branch_id = $1 AND source_item_id IS NOT NULL",
    [target.id],
  );
  const bySource = new Map(existing.map((r) => [r.source_item_id, r.id]));
  let added = 0, updated = 0;
  for (const it of items) {
    const input: MenuItemInput = markup({
      names: it.names, description: it.description, prices: it.prices, category: it.category, veg: it.veg,
      tags: it.tags, allergens: it.allergens, recommended: it.recommended, variations: it.variations, addons: it.addons,
      dietary: it.dietary, nutrition: it.nutrition, ageRestricted: it.age_restricted, imageId: it.image_id, availabilityHours: it.availability_hours,
    }, markupBps);
    const targetItemId = bySource.get(it.id);
    if (targetItemId) { await updateMenuItem(sql, target.id, targetItemId, input); updated++; }
    else { await addMenuItem(sql, target, { ...input, sourceItemId: it.id }); added++; }
  }
  return { added, updated };
}

/** Multiplies a minor-unit price by (1 + bps/10000), rounded to the nearest minor unit. */
function markMinor(minor: string, bps: number): string {
  if (!bps) return minor;
  const n = BigInt(minor), scale = BigInt(10000 + bps);
  const marked = n < 0n ? -((-n * scale + 5000n) / 10000n) : (n * scale + 5000n) / 10000n;
  return marked.toString();
}

/** Applies a price markup to a dish's goods price and every variation/add-on price. */
function markup(input: MenuItemInput, bps: number): MenuItemInput {
  if (!bps) return input;
  return {
    ...input,
    prices: Object.fromEntries(Object.entries(input.prices).map(([c, m]) => [c, markMinor(m, bps)])),
    ...(input.variations ? { variations: input.variations.map((v) => ({ ...v, options: v.options.map((o) => ({ ...o, price: markMinor(o.price, bps) })) })) } : {}),
    ...(input.addons ? { addons: input.addons.map((a) => ({ ...a, price: markMinor(a.price, bps) })) } : {}),
  };
}

/** Records the price markup a branch applies to prices synced from its source (basis points; can be negative). */
export async function setBranchMarkup(sql: Sql, branchId: string, bps: number): Promise<void> {
  await sql.query("UPDATE catalogue.branch SET price_markup_bps = $2, updated_at = now() WHERE id = $1", [branchId, bps]);
}

/** The branches (other than the source) that hold dishes copied from this source, with how many. */
export async function linkedCopies(sql: Sql, sourceBranchId: string): Promise<{ id: string; name: string; linked: number; markup_bps: number }[]> {
  return sql.query<{ id: string; name: string; linked: number; markup_bps: number }>(
    `SELECT b.id, b.name, count(*)::int AS linked, b.price_markup_bps AS markup_bps
       FROM catalogue.menu_item m
       JOIN catalogue.menu_item src ON src.id = m.source_item_id
       JOIN catalogue.branch b ON b.id = m.branch_id
      WHERE src.branch_id = $1 AND m.branch_id <> $1
      GROUP BY b.id, b.name, b.price_markup_bps ORDER BY b.name`,
    [sourceBranchId],
  );
}

// ── Delivery zones (per-branch circular service areas) ──
export interface DeliveryZoneRow {
  id: string;
  branch_id: string;
  name: string;
  centre_lat: string;
  centre_lng: string;
  radius_m: number;
  flat_fee_minor: string | null;
  min_order_minor: string | null;
  active: boolean;
}
export interface DeliveryZoneInput {
  name: string;
  centreLat: number;
  centreLng: number;
  radiusM: number;
  flatFeeMinor?: string | null;
  minOrderMinor?: string | null;
  active?: boolean;
}

const ZONE_COLUMNS = "id, branch_id, name, centre_lat::text AS centre_lat, centre_lng::text AS centre_lng, radius_m, flat_fee_minor::text AS flat_fee_minor, min_order_minor::text AS min_order_minor, active";

/** A branch's delivery zones, newest first. With activeOnly, only the ones currently switched on. */
export async function zonesForBranch(sql: Sql, branchId: string, opts: { activeOnly?: boolean } = {}): Promise<DeliveryZoneRow[]> {
  return sql.query<DeliveryZoneRow & Record<string, unknown>>(
    `SELECT ${ZONE_COLUMNS} FROM catalogue.delivery_zone WHERE branch_id = $1 ${opts.activeOnly ? "AND active = true" : ""} ORDER BY created_at DESC`,
    [branchId],
  );
}

export async function createZone(sql: Sql, branch: BranchRow, z: DeliveryZoneInput): Promise<DeliveryZoneRow> {
  const [row] = await sql.query<DeliveryZoneRow & Record<string, unknown>>(
    `INSERT INTO catalogue.delivery_zone (country_iso2, branch_id, name, centre_lat, centre_lng, radius_m, flat_fee_minor, min_order_minor, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ZONE_COLUMNS}`,
    [branch.country_iso2, branch.id, z.name, z.centreLat, z.centreLng, z.radiusM, z.flatFeeMinor ?? null, z.minOrderMinor ?? null, z.active ?? true],
  );
  return row as DeliveryZoneRow;
}

/** Updates the given fields of one zone; returns the new row, or undefined if it is not in this branch. */
export async function updateZone(sql: Sql, branchId: string, zoneId: string, p: Partial<DeliveryZoneInput>): Promise<DeliveryZoneRow | undefined> {
  const sets: string[] = [];
  const vals: unknown[] = [zoneId, branchId];
  const add = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (p.name !== undefined) add("name", p.name);
  if (p.centreLat !== undefined) add("centre_lat", p.centreLat);
  if (p.centreLng !== undefined) add("centre_lng", p.centreLng);
  if (p.radiusM !== undefined) add("radius_m", p.radiusM);
  if (p.flatFeeMinor !== undefined) add("flat_fee_minor", p.flatFeeMinor);
  if (p.minOrderMinor !== undefined) add("min_order_minor", p.minOrderMinor);
  if (p.active !== undefined) add("active", p.active);
  if (sets.length === 0) { const [row] = await sql.query<DeliveryZoneRow & Record<string, unknown>>(`SELECT ${ZONE_COLUMNS} FROM catalogue.delivery_zone WHERE id = $1 AND branch_id = $2`, [zoneId, branchId]); return row as DeliveryZoneRow | undefined; }
  const [row] = await sql.query<DeliveryZoneRow & Record<string, unknown>>(
    `UPDATE catalogue.delivery_zone SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND branch_id = $2 RETURNING ${ZONE_COLUMNS}`,
    vals,
  );
  return row as DeliveryZoneRow | undefined;
}

export async function deleteZone(sql: Sql, branchId: string, zoneId: string): Promise<boolean> {
  const rows = await sql.query("DELETE FROM catalogue.delivery_zone WHERE id = $1 AND branch_id = $2 RETURNING id", [zoneId, branchId]);
  return rows.length === 1;
}

// ── Merchant promotions (happy hour) ──
export interface PromotionRow {
  id: string; branch_id: string; name: string;
  scope: "ITEM" | "CATEGORY" | "BRANCH";
  target_item_id: string | null; target_category: string | null;
  percent_bps: number; hours: Record<string, [string, string][]>; active: boolean;
}
export interface PromotionInput {
  name: string; scope: "ITEM" | "CATEGORY" | "BRANCH";
  targetItemId?: string | null; targetCategory?: string | null;
  percentBps: number; hours?: Record<string, [string, string][]>; active?: boolean;
}
const PROMO_COLUMNS = "id, branch_id, name, scope, target_item_id::text AS target_item_id, target_category, percent_bps, hours, active";

export async function promotionsForBranch(sql: Sql, branchId: string, opts: { activeOnly?: boolean } = {}): Promise<PromotionRow[]> {
  return sql.query<PromotionRow & Record<string, unknown>>(
    `SELECT ${PROMO_COLUMNS} FROM catalogue.menu_promotion WHERE branch_id = $1 ${opts.activeOnly ? "AND active = true" : ""} ORDER BY created_at DESC`,
    [branchId],
  );
}

export async function createPromotion(sql: Sql, branch: BranchRow, p: PromotionInput): Promise<PromotionRow> {
  const [row] = await sql.query<PromotionRow & Record<string, unknown>>(
    `INSERT INTO catalogue.menu_promotion (country_iso2, branch_id, name, scope, target_item_id, target_category, percent_bps, hours, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${PROMO_COLUMNS}`,
    [branch.country_iso2, branch.id, p.name, p.scope, p.targetItemId ?? null, p.targetCategory ?? null, p.percentBps, JSON.stringify(p.hours ?? {}), p.active ?? true],
  );
  return row as PromotionRow;
}

export async function updatePromotion(sql: Sql, branchId: string, promoId: string, p: Partial<PromotionInput>): Promise<PromotionRow | undefined> {
  const sets: string[] = [];
  const vals: unknown[] = [promoId, branchId];
  const add = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (p.name !== undefined) add("name", p.name);
  if (p.percentBps !== undefined) add("percent_bps", p.percentBps);
  if (p.hours !== undefined) add("hours", JSON.stringify(p.hours));
  if (p.active !== undefined) add("active", p.active);
  if (sets.length === 0) { const [row] = await sql.query<PromotionRow & Record<string, unknown>>(`SELECT ${PROMO_COLUMNS} FROM catalogue.menu_promotion WHERE id = $1 AND branch_id = $2`, [promoId, branchId]); return row as PromotionRow | undefined; }
  const [row] = await sql.query<PromotionRow & Record<string, unknown>>(
    `UPDATE catalogue.menu_promotion SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND branch_id = $2 RETURNING ${PROMO_COLUMNS}`,
    vals,
  );
  return row as PromotionRow | undefined;
}

export async function deletePromotion(sql: Sql, branchId: string, promoId: string): Promise<boolean> {
  const rows = await sql.query("DELETE FROM catalogue.menu_promotion WHERE id = $1 AND branch_id = $2 RETURNING id", [promoId, branchId]);
  return rows.length === 1;
}

/** The best (deepest) promotion that applies to a dish at `at` — item-, category- or branch-scoped, in its window. */
export function bestPromotion(promos: PromotionRow[], item: { id: string; category: string | null }, at: Date, tz: string): { id: string; name: string; percent_bps: number } | null {
  let best: { id: string; name: string; percent_bps: number } | null = null;
  for (const p of promos) {
    if (!p.active) continue;
    const matches = p.scope === "BRANCH"
      || (p.scope === "ITEM" && p.target_item_id === item.id)
      || (p.scope === "CATEGORY" && p.target_category !== null && item.category === p.target_category);
    if (!matches) continue;
    if (Object.keys(p.hours ?? {}).length > 0 && !isOpenNow(p.hours, {}, at, tz)) continue;
    if (!best || p.percent_bps > best.percent_bps) best = { id: p.id, name: p.name, percent_bps: p.percent_bps };
  }
  return best;
}

/** Applies a percentage-off (basis points) to a minor-unit price, rounding the discount to the nearest minor unit. */
export function promoPrice(minor: bigint, percentBps: number): bigint {
  if (!percentBps) return minor;
  const discount = (minor * BigInt(percentBps) + 5000n) / 10000n;
  const out = minor - discount;
  return out < 0n ? 0n : out;
}

export async function menuOf(sql: Sql, branchId: string): Promise<MenuItemRow[]> {
  return sql.query<MenuItemRow & Record<string, unknown>>(
    `SELECT ${ITEM_COLUMNS} FROM catalogue.menu_item WHERE branch_id = $1 ORDER BY category NULLS LAST, created_at`,
    [branchId],
  );
}
