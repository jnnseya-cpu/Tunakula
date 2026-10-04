/** Catalogue management (§22.2 CAT-002/003) under scoped permissions. */
import { Money } from "@tunakula/ts-money";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { addMenuItem, createBranch, getBranch, menuOf, setAvailability, type MenuItemRow } from "../persistence/catalogue.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, notFound } from "./errors.ts";
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

  async addItem(country: string, principal: Principal, branchId: string, input: { names: Record<string, string>; prices: Record<string, string>; tags?: string[]; allergens?: string[] }) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Branch");
      require(principal, "menu:write", { type: "menu", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      if (!input.names || Object.keys(input.names).length === 0) throw badRequest("NAME_REQUIRED", "An item needs a name in at least one language");
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
      const item = await addMenuItem(sql, { branch, names: input.names, prices, tags: input.tags ?? [], allergens: input.allergens ?? [] });
      return publicItem(item);
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

function publicItem(i: MenuItemRow) {
  return {
    id: i.id,
    names: i.names,
    prices: Object.fromEntries(Object.entries(i.prices).map(([c, m]) => [c, { amount_minor: m, currency: c }])),
    tags: i.tags,
    allergens: i.allergens,
    available: i.available,
  };
}
