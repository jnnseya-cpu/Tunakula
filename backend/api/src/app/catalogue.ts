/** Catalogue management (§22.2 CAT-002/003) under scoped permissions. */
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { addMenuItem, createBranch, getBranch, menuOf, setAvailability, updateMenuItem, type MenuItemInput, type MenuItemRow } from "../persistence/catalogue.ts";
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
    if (!prices[profile.money.settlement_currency]) throw badRequest("SETTLEMENT_PRICE_REQUIRED", `Give a ${profile.money.settlement_currency} price`);
    return {
      names: input.names, prices,
      ...(input.description ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category ? String(input.category).slice(0, 80) : null } : {}),
      ...(input.veg !== undefined ? { veg: input.veg === null ? null : Boolean(input.veg) } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.allergens ? { allergens: input.allergens } : {}),
      ...(input.recommended !== undefined ? { recommended: Boolean(input.recommended) } : {}),
    };
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
  recommended?: boolean;
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
    available: i.available,
    recommended: i.recommended,
  };
}
