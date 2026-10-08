/** Catalogue management (§22.2 CAT-002/003) under scoped permissions. */
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { addMenuItem, createBranch, getBranch, menuOf, setAvailability, updateMenuItem, type Addon, type MenuItemInput, type MenuItemRow, type Variation, type VariationOption } from "../persistence/catalogue.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

export class CatalogueService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;

  constructor(db: Db, registry: CountryConfigRegistry) {
    this.db = db;
    this.registry = registry;
  }

  #profile(country: string) {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  async createBranch(country: string, principal: Principal, input: { name: string; restaurantGroupId: string; city?: string; commune?: string; lat: number; lng: number }) {
    const profile = this.#profile(country);
    if (!input.name?.trim()) throw badRequest("NAME_REQUIRED", "A branch needs a name");
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw badRequest("LOCATION_REQUIRED", "A branch needs a location");
    require(principal, "restaurant:manage", { type: "branch", country, restaurantGroupId: input.restaurantGroupId }, { activeCountry: country, profile });
    return this.db.tx({ country }, async (sql) => {
      const branch = await createBranch(sql, {
        country_iso2: country,
        brand_id: profile.experience.brand_id,
        restaurant_group_id: input.restaurantGroupId,
        name: input.name.trim(),
        city: input.city ?? null,
        commune: input.commune ?? null,
        lat: String(input.lat),
        lng: String(input.lng),
      });
      await audit(sql, { actor: principal.userId, action: "branch.created", target: `branch:${branch.id}`, country });
      return branch;
    });
  }

  #priced(profile: CountryProfile, country: string, input: ItemInput): MenuItemInput {
    if (!input.names || Object.keys(input.names).filter((k) => (input.names[k] ?? "").trim()).length === 0) throw badRequest("NAME_REQUIRED", "An item needs a name in at least one language");
    const prices: Record<string, string> = {};
    for (const [ccy, major] of Object.entries(input.prices ?? {})) {
      if (!profile.money.currencies.includes(ccy)) throw badRequest("CURRENCY_NOT_ACCEPTED", `${ccy} is not accepted in ${country}`);
      // Prices arrive in major units and are stored exactly in minor units (MR-1); excess precision is rejected.
      try {
        prices[ccy] = Money.of(major, ccy).minor.toString();
      } catch (error) {
        throw badRequest("PRICE_INVALID", `${ccy} ${major}: ${(error as Error).message}`);
      }
    }
    const ccy = profile.money.settlement_currency;
    if (!prices[ccy]) throw badRequest("SETTLEMENT_PRICE_REQUIRED", `Give a ${ccy} price`);
    const delta = (major: unknown, where: string): string => {
      try { const m = Money.of(String(major ?? "0"), ccy); if (m.minor < 0n) throw new Error("must be 0 or more"); return m.minor.toString(); }
      catch (error) { throw badRequest("OPTION_PRICE_INVALID", `${where}: ${(error as Error).message}`); }
    };
    return {
      names: input.names, prices,
      ...(input.description ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category ? String(input.category).slice(0, 80) : null } : {}),
      ...(input.veg !== undefined ? { veg: input.veg === null ? null : Boolean(input.veg) } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.allergens ? { allergens: input.allergens } : {}),
      ...(input.dietary !== undefined ? { dietary: dietaryTags(input.dietary) } : {}),
      ...(input.nutrition !== undefined ? { nutrition: nutritionFacts(input.nutrition) } : {}),
      ...(input.recommended !== undefined ? { recommended: Boolean(input.recommended) } : {}),
      ...(input.variations !== undefined ? { variations: this.#variations(input.variations, delta) } : {}),
      ...(input.addons !== undefined ? { addons: this.#addons(input.addons, delta) } : {}),
    };
  }

  #variations(raw: unknown, delta: (m: unknown, where: string) => string): Variation[] {
    if (!Array.isArray(raw)) throw badRequest("VARIATIONS_INVALID", "variations must be a list");
    return raw.map((g: Record<string, unknown>, i): Variation => {
      const name = String(g?.name ?? "").trim();
      if (!name) throw badRequest("VARIATION_NAME_REQUIRED", `Variation ${i + 1} needs a name`);
      const type = g?.type === "MULTI" ? "MULTI" : "SINGLE";
      const options = Array.isArray(g?.options) ? g.options : [];
      if (options.length === 0) throw badRequest("VARIATION_EMPTY", `Variation "${name}" needs at least one option`);
      const required = Boolean(g?.required);
      const max = type === "SINGLE" ? 1 : Math.max(1, Math.min(Number(g?.max) || options.length, options.length));
      const min = type === "SINGLE" ? (required ? 1 : 0) : Math.max(required ? 1 : 0, Math.min(Number(g?.min) || 0, max));
      return {
        id: `g${i}`, name, type, required, min, max,
        options: options.map((o: Record<string, unknown>, j): VariationOption => {
          const on = String(o?.name ?? "").trim();
          if (!on) throw badRequest("OPTION_NAME_REQUIRED", `An option of "${name}" needs a name`);
          return { id: `g${i}o${j}`, name: on, price: delta(o?.price, `${name} / ${on}`) };
        }),
      };
    });
  }

  #addons(raw: unknown, delta: (m: unknown, where: string) => string): Addon[] {
    if (!Array.isArray(raw)) throw badRequest("ADDONS_INVALID", "addons must be a list");
    return raw.map((a: Record<string, unknown>, i): Addon => {
      const name = String(a?.name ?? "").trim();
      if (!name) throw badRequest("ADDON_NAME_REQUIRED", `Add-on ${i + 1} needs a name`);
      return { id: `a${i}`, name, price: delta(a?.price, `add-on ${name}`) };
    });
  }

  async addItem(country: string, principal: Principal, branchId: string, input: ItemInput) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Branch");
      require(principal, "menu:write", { type: "menu", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      return publicItem(await addMenuItem(sql, branch, this.#priced(profile, country, input)));
    });
  }

  async updateItem(country: string, principal: Principal, branchId: string, itemId: string, input: ItemInput) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Branch");
      require(principal, "menu:write", { type: "menu", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      const item = await updateMenuItem(sql, branchId, itemId, this.#priced(profile, country, input));
      if (!item) throw notFound("Item");
      return publicItem(item);
    });
  }

  /** Bulk upsert of a branch's menu. A row with an id updates that dish; without one, it is added.
   *  All rows are validated first; if any is invalid, nothing is applied and every error is returned. */
  async importMenu(country: string, principal: Principal, branchId: string, rows: readonly ImportRow[]) {
    const profile = this.#profile(country);
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest("NO_ROWS", "Send at least one row to import");
    if (rows.length > 2000) throw badRequest("TOO_MANY_ROWS", "Import at most 2000 rows at a time");

    const prepared: { line: number; id?: string; available?: boolean; input: MenuItemInput }[] = [];
    const errors: { row: number; message: string }[] = [];
    rows.forEach((row, i) => {
      try {
        prepared.push({ line: i + 1, ...(row.id ? { id: String(row.id) } : {}), ...(row.available !== undefined ? { available: Boolean(row.available) } : {}), input: this.#priced(profile, country, row) });
      } catch (e) {
        errors.push({ row: i + 1, message: (e as Error).message });
      }
    });
    if (errors.length) throw unprocessable("IMPORT_INVALID", `${errors.length} of ${rows.length} rows are invalid; nothing was imported`, { errors });

    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Branch");
      require(principal, "menu:write", { type: "menu", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      let created = 0, updated = 0;
      for (const p of prepared) {
        if (p.id) {
          const item = await updateMenuItem(sql, branchId, p.id, p.input);
          if (!item) throw unprocessable("IMPORT_ID_NOT_FOUND", `Row ${p.line}: no dish ${p.id} in this branch`, { errors: [{ row: p.line, message: "unknown id" }] });
          updated += 1;
          if (p.available !== undefined) await setAvailability(sql, p.id, p.available);
        } else {
          const item = await addMenuItem(sql, branch, p.input);
          created += 1;
          if (p.available === false) await setAvailability(sql, item.id, false);
        }
      }
      return { imported: created + updated, created, updated, errors: [] as { row: number; message: string }[] };
    });
  }

  async setAvailability(country: string, principal: Principal, branchId: string, itemId: string, available: boolean) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Branch");
      require(principal, "availability:write", { type: "menu", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      if (!(await setAvailability(sql, itemId, available))) throw notFound("Item");
      return { item_id: itemId, available };
    });
  }

  async menu(country: string, branchId: string) {
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Branch");
      return { branch: { id: branch.id, name: branch.name, commune: branch.commune, status: branch.status }, items: (await menuOf(sql, branchId)).map(publicItem) };
    });
  }
}

interface ItemInput {
  names: Record<string, string>;
  description?: Record<string, string>;
  prices: Record<string, string>;
  category?: string | null;
  veg?: boolean | null;
  tags?: string[];
  allergens?: string[];
  dietary?: unknown;
  nutrition?: unknown;
  recommended?: boolean;
  variations?: unknown;
  addons?: unknown;
}

/** Structured dietary tags a customer can filter by (the EU/UK compliance + discovery set). */
export const DIETARY_TAGS = ["VEGETARIAN", "VEGAN", "HALAL", "KOSHER", "GLUTEN_FREE", "DAIRY_FREE", "NUT_FREE", "ORGANIC", "SPICY"] as const;
/** The 14 EU major allergens; a dish's `allergens` are validated against this set when provided. */
export const EU_ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"] as const;
const NUTRITION_KEYS = ["kcal", "protein_g", "carbs_g", "fat_g", "sugar_g", "salt_g"] as const;

function dietaryTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw badRequest("DIETARY_INVALID", "dietary is a list of tags");
  const out = value.map((t) => String(t).toUpperCase().trim()).filter(Boolean);
  for (const t of out) if (!(DIETARY_TAGS as readonly string[]).includes(t)) throw badRequest("DIETARY_UNKNOWN", `Unknown dietary tag "${t}"; allowed: ${DIETARY_TAGS.join(", ")}`);
  return [...new Set(out)];
}

function nutritionFacts(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object") throw badRequest("NUTRITION_INVALID", "nutrition is an object of per-serving figures");
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!(NUTRITION_KEYS as readonly string[]).includes(k)) throw badRequest("NUTRITION_KEY_UNKNOWN", `Unknown nutrition field "${k}"; allowed: ${NUTRITION_KEYS.join(", ")}`);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest("NUTRITION_VALUE_INVALID", `${k} must be a number of 0 or more`);
    out[k] = Math.round(n * 10) / 10;
  }
  return out;
}

interface ImportRow extends ItemInput {
  id?: string;
  available?: boolean;
}

function publicItem(i: MenuItemRow) {
  return {
    id: i.id,
    names: i.names,
    description: i.description,
    prices: Object.fromEntries(Object.entries(i.prices).map(([c, m]) => [c, { amount_minor: m, currency: c }])),
    category: i.category,
    veg: i.veg,
    tags: i.tags,
    allergens: i.allergens,
    dietary: i.dietary,
    nutrition: i.nutrition,
    available: i.available,
    recommended: i.recommended,
    // Variation/add-on prices are minor units in the market's settlement currency (the client knows it).
    variations: i.variations,
    addons: i.addons,
  };
}
