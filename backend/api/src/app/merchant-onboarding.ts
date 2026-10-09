/**
 * Self-serve merchant onboarding. Because there is no field team, a business owner sets themselves up
 * through a guided wizard: register the business, add a branch and its location, add the menu, then
 * publish. A branch is discoverable on the storefront — and in Tunakula Nzela, the WhatsApp channel,
 * which reads the same catalogue — only once it is published. Additive: it reuses the catalogue.
 */
import { randomInt, randomUUID } from "node:crypto";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { createBranch, ensureGroup, getBranch, getGroup, getGroupByInvite, publishBranch, setInviteCode } from "../persistence/catalogue.ts";
import { addBinding, audit } from "../persistence/identity.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

/** An invite-code alphabet without look-alike characters (no 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const makeInviteCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join("");

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

  /** The restaurant group (brand) the signed-in person owns in this market, if any. */
  #ownedGroupId(principal: Principal): string | null {
    const b = principal.bindings.find((x) => "role" in x && x.role === "RESTAURANT_OWNER" && x.scope.type === "RESTAURANT_GROUP" && "id" in x.scope);
    return b && "id" in b.scope ? b.scope.id : null;
  }

  /** Step 1: register a business (a brand). Creates a restaurant group and makes the signed-in user its owner. */
  async register(country: string, principal: Principal, input: { businessName: string }) {
    const name = String(input.businessName ?? "").trim();
    if (name.length < 2) throw badRequest("BUSINESS_NAME_REQUIRED", "Tell us your business name");
    // If they already own a group, reuse it (the wizard is resumable).
    const existing = this.#ownedGroupId(principal);
    if (existing) {
      const g = await this.db.tx({ country }, (sql) => ensureGroup(sql, { id: existing, country, name, createdBy: principal.userId }));
      return { group_id: existing, business_name: g.name };
    }
    const groupId = `rg-${randomUUID().slice(0, 12)}`;
    await this.db.tx({}, async (sql) => {
      await addBinding(sql, { userId: principal.userId, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: groupId } });
      await audit(sql, { actor: principal.userId, action: "merchant.registered", target: `group:${groupId}`, country, detail: { name } });
    });
    await this.db.tx({ country }, (sql) => ensureGroup(sql, { id: groupId, country, name, createdBy: principal.userId }));
    return { group_id: groupId, business_name: name };
  }

  /** The brand owner's invite code — franchisees sign up individually and join the brand with it. Created on first ask. */
  async brandInvite(country: string, principal: Principal) {
    const groupId = this.#ownedGroupId(principal);
    if (!groupId) throw forbidden("Only a brand owner can invite franchisees");
    return this.db.tx({ country }, async (sql) => {
      let g = (await getGroup(sql, groupId)) ?? (await ensureGroup(sql, { id: groupId, country, name: groupId, createdBy: principal.userId }));
      if (!g.invite_code) {
        let code = makeInviteCode();
        for (let i = 0; i < 5 && (await getGroupByInvite(sql, code)); i++) code = makeInviteCode();
        await setInviteCode(sql, groupId, code);
        g = { ...g, invite_code: code };
      }
      return { group_id: groupId, name: g.name, invite_code: g.invite_code };
    });
  }

  /**
   * A franchisee joins an existing brand with its invite code and gets their own branch under it. They run
   * that one branch (menu, profile, orders) but never see the brand's other franchises; the brand owner sees all.
   */
  async join(country: string, principal: Principal, input: { code: string; name: string; lat: number; lng: number; commune?: string }) {
    const profile = this.profile(country);
    const code = String(input.code ?? "").trim().toUpperCase();
    if (!code) throw badRequest("CODE_REQUIRED", "Enter the brand's invite code");
    if (!input.name?.trim()) throw badRequest("NAME_REQUIRED", "Your branch needs a name");
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw badRequest("LOCATION_REQUIRED", "Drop a pin for your branch");
    const alreadyMerchant = principal.bindings.some((b) => "role" in b && (b.role === "RESTAURANT_OWNER" || b.role === "FRANCHISEE"));
    if (alreadyMerchant) throw conflict("ALREADY_HAS_BUSINESS", "You already run a business on Tunakula");
    return this.db.tx({ country }, async (sql) => {
      const group = await getGroupByInvite(sql, code);
      if (!group) throw badRequest("INVALID_INVITE", "That brand code is not valid");
      const branch = await createBranch(sql, {
        country_iso2: country, brand_id: profile.experience.brand_id, restaurant_group_id: group.id,
        name: input.name.trim(), city: null, commune: input.commune ?? null, lat: String(input.lat), lng: String(input.lng),
      }, false);
      await addBinding(sql, { userId: principal.userId, role: "FRANCHISEE", scope: { type: "BRANCH", id: branch.id } });
      await audit(sql, { actor: principal.userId, action: "merchant.joined_brand", target: `branch:${branch.id}`, country, detail: { group: group.id } });
      return { group_id: group.id, branch_id: branch.id, brand_name: group.name, published: false };
    });
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
      require(principal, "branch:manage", { type: "branch", country, branchId, restaurantGroupId: facts.restaurant_group_id }, { activeCountry: country, profile });
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
      require(principal, "branch:manage", { type: "branch", country, branchId, restaurantGroupId: facts.restaurant_group_id }, { activeCountry: country, profile });
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
