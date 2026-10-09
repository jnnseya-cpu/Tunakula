/**
 * Self-serve merchant onboarding. Because there is no field team, a business owner sets themselves up
 * through a guided wizard: register the business, add a branch and its location, add the menu, then
 * publish. A branch is discoverable on the storefront — and in Tunakula Nzela, the WhatsApp channel,
 * which reads the same catalogue — only once it is published. Additive: it reuses the catalogue.
 */
import { randomUUID } from "node:crypto";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { createBranch, getBranch, publishBranch } from "../persistence/catalogue.ts";
import { addBinding, audit } from "../persistence/identity.ts";
import { badRequest, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

export class MerchantOnboardingService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;

  constructor(db: Db, registry: CountryConfigRegistry) {
    this.db = db;
    this.registry = registry;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** Step 1: register a business. Creates a restaurant group and makes the signed-in user its owner. */
  async register(country: string, principal: Principal, input: { businessName: string }) {
    const name = String(input.businessName ?? "").trim();
    if (name.length < 2) throw badRequest("BUSINESS_NAME_REQUIRED", "Tell us your business name");
    // If they already own a group, reuse it (the wizard is resumable).
    const existing = principal.bindings.find((b) => "role" in b && b.role === "RESTAURANT_OWNER" && b.scope.type === "RESTAURANT_GROUP");
    if (existing && "id" in existing.scope) return { group_id: existing.scope.id, business_name: name };
    const groupId = `rg-${randomUUID().slice(0, 12)}`;
    await this.db.tx({}, async (sql) => {
      await addBinding(sql, { userId: principal.userId, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: groupId } });
      await audit(sql, { actor: principal.userId, action: "merchant.registered", target: `group:${groupId}`, country, detail: { name } });
    });
    return { group_id: groupId, business_name: name };
  }

  /** Step 2: add a branch (a location). Created unpublished until the wizard finishes. */
  async addBranch(country: string, principal: Principal, input: { groupId: string; name: string; lat: number; lng: number; city?: string; commune?: string }) {
    const profile = this.profile(country);
    if (!input.name?.trim()) throw badRequest("NAME_REQUIRED", "Your branch needs a name");
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw badRequest("LOCATION_REQUIRED", "Drop a pin for your branch");
    require(principal, "branch:manage", { type: "branch", country, restaurantGroupId: input.groupId }, { activeCountry: country, profile });
    return this.db.tx({ country }, async (sql) => {
      const branch = await createBranch(sql, {
        country_iso2: country,
        brand_id: profile.experience.brand_id,
        restaurant_group_id: input.groupId,
        name: input.name.trim(),
        city: input.city ?? null,
        commune: input.commune ?? null,
        lat: String(input.lat),
        lng: String(input.lng),
      }, false);
      await audit(sql, { actor: principal.userId, action: "merchant.branch_added", target: `branch:${branch.id}`, country });
      return { branch_id: branch.id, name: branch.name, published: false };
    });
  }

  /** The wizard's progress for a branch: what is done and what is left before it can go live. */
  async status(country: string, principal: Principal, branchId: string) {
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      const facts = await this.#branchFacts(sql, branchId);
      if (!facts) throw notFound("Branch");
      require(principal, "branch:manage", { type: "branch", country, restaurantGroupId: facts.restaurant_group_id }, { activeCountry: country, profile });
      const canPublish = facts.available_items > 0;
      return {
        branch: { id: branchId, name: facts.name, commune: facts.commune },
        items: facts.item_count,
        available_items: facts.available_items,
        has_hours: facts.has_hours,
        published: facts.published,
        can_publish: canPublish,
        steps: {
          business: true,
          branch: true,
          menu: facts.available_items > 0,
          published: facts.published,
        },
      };
    });
  }

  /** Final step: publish the branch so customers (web and Tunakula Nzela) can find and order from it. */
  async publish(country: string, principal: Principal, branchId: string) {
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      const facts = await this.#branchFacts(sql, branchId);
      if (!facts) throw notFound("Branch");
      require(principal, "branch:manage", { type: "branch", country, restaurantGroupId: facts.restaurant_group_id }, { activeCountry: country, profile });
      if (facts.available_items < 1) throw unprocessable("MENU_EMPTY", "Add at least one available dish before you publish");
      await publishBranch(sql, branchId);
      await audit(sql, { actor: principal.userId, action: "merchant.published", target: `branch:${branchId}`, country });
      return { branch_id: branchId, published: true };
    });
  }

  async #branchFacts(sql: Sql, branchId: string) {
    const b = await getBranch(sql, branchId);
    if (!b) return null;
    const [counts] = await sql.query<{ item_count: string; available_items: string }>(
      "SELECT count(*)::text AS item_count, count(*) FILTER (WHERE available)::text AS available_items FROM catalogue.menu_item WHERE branch_id = $1",
      [branchId],
    );
    const [pub] = await sql.query<{ published_at: Date | null }>("SELECT published_at FROM catalogue.branch WHERE id = $1", [branchId]);
    return {
      name: b.name,
      commune: b.commune,
      restaurant_group_id: b.restaurant_group_id,
      item_count: Number(counts?.item_count ?? 0),
      available_items: Number(counts?.available_items ?? 0),
      has_hours: Object.keys(b.hours ?? {}).length > 0,
      published: pub?.published_at != null,
    };
  }
}
