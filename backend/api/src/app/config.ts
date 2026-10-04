/**
 * Country Profile administration (§17, CFG-001/002, ADP-001) over PostgreSQL.
 * The registry is the validator and the cache; the database is the record. Every
 * mutation reloads under a lock, persists in the same transaction and is audited.
 */
import { validateCountryProfile, type CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import { ConfigPublishError, READINESS_AREAS, type CountryConfigRegistry, type ReadinessReview } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { loadVersions, saveVersions } from "../persistence/config.ts";
import { audit } from "../persistence/identity.ts";
import { ApiError, badRequest, forbidden, notFound } from "./errors.ts";
import { require } from "./principal.ts";

/** Changes under these paths move money or affect people's pay: a second person (Super Admin) must publish them. */
export const DUAL_CONTROL_PATHS = ["/money", "/pricing", "/payments", "/labour"] as const;

const LOCK = 7242020;

export class ConfigService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;

  constructor(db: Db, registry: CountryConfigRegistry) {
    this.db = db;
    this.registry = registry;
  }

  /** Reloads every version from the database (other instances may have published). */
  async refresh(): Promise<void> {
    this.registry.restore(await this.db.tx({}, loadVersions));
  }

  async saveDraft(principal: Principal, document: unknown) {
    const checked = validateCountryProfile(document, { environment: "non-production" });
    if (!checked.ok) throw new ApiError(422, "PROFILE_INVALID", "The Country Profile does not validate", { issues: checked.issues });
    const iso2 = checked.profile.country.iso2;
    this.#authorize(principal, "country_config:write", iso2, checked.profile);
    return this.#mutate(iso2, async (sql) => {
      const draft = this.registry.saveDraft(principal.userId, document);
      await audit(sql, { actor: principal.userId, action: "country_config.draft_saved", target: `country_profile:${iso2}:${draft.version}`, country: iso2 });
      return { iso2, version: draft.version, status: draft.status };
    });
  }

  /**
   * Publishes a draft. The registry enforces CFG-002 (validation, brand, host, certified connectors,
   * §28.10 readiness review for a first PILOT/LIVE). On top: dual control for sensitive paths.
   */
  async publish(principal: Principal, iso2: string, version: number, review: Record<string, { signed_by?: string }> = {}) {
    if (!Number.isInteger(version) || version < 1) throw badVersion();
    const readiness: ReadinessReview = {};
    for (const area of READINESS_AREAS) {
      const signer = review[area]?.signed_by;
      if (typeof signer === "string" && signer.trim()) (readiness as Record<string, { signedBy: string; at: Date }>)[area] = { signedBy: signer.trim(), at: new Date() };
    }
    return this.#mutate(iso2, async (sql) => {
      // Decided on the freshly reloaded record, inside the lock.
      const target = this.registry.history(iso2).find((v) => v.version === version);
      if (!target) throw notFound(`${iso2} version ${version}`);
      this.#authorize(principal, "country_config:write", iso2, target.profile);
      const live = this.registry.published(iso2);
      const sensitive = live
        ? this.registry.diff(iso2, live.version, version).map((c) => c.path).filter((p) => DUAL_CONTROL_PATHS.some((s) => p === s || p.startsWith(`${s}/`)))
        : ["/"];
      if (sensitive.length > 0) {
        const approver = authorize(principal, "country_config:approve", { type: "country_config", country: iso2 }, { activeCountry: iso2, profile: target.profile });
        const what = live ? sensitive.slice(0, 3).join(", ") : "A first publish";
        if (!approver.allowed) throw forbidden(`${what} ${live ? "need" : "needs"} a Super Admin to publish`);
        if (target.createdBy === principal.userId) throw forbidden("Dual control: whoever drafted money, pricing, payments or labour changes cannot also publish them");
      }
      const config = this.registry.publish(principal.userId, iso2, version, readiness);
      await audit(sql, { actor: principal.userId, action: "country_config.published", target: `country_profile:${iso2}:${version}`, country: iso2, detail: { sensitive, review: Object.keys(readiness) } });
      return config;
    });
  }

  /** CFG-002: roll back to the previous published version, as a new version. */
  async rollback(principal: Principal, iso2: string) {
    const live = this.registry.published(iso2);
    if (!live) throw notFound(`Published config for ${iso2}`);
    this.#authorize(principal, "country_config:write", iso2, live.profile);
    return this.#mutate(iso2, async (sql) => {
      const config = this.registry.rollback(principal.userId, iso2);
      await audit(sql, { actor: principal.userId, action: "country_config.rolled_back", target: `country_profile:${iso2}`, country: iso2 });
      return config;
    });
  }

  history(principal: Principal, iso2: string) {
    const versions = this.registry.history(iso2);
    const latest = versions.at(-1);
    if (!latest) throw notFound(`Country ${iso2}`);
    this.#authorize(principal, "country_config:write", iso2, latest.profile);
    return versions.map((v) => ({ version: v.version, status: v.status, created_by: v.createdBy, created_at: v.createdAt, published_by: v.publishedBy ?? null, published_at: v.publishedAt ?? null }));
  }

  diff(principal: Principal, iso2: string, from: number, to: number) {
    const latest = this.registry.history(iso2).at(-1);
    if (!latest) throw notFound(`Country ${iso2}`);
    this.#authorize(principal, "country_config:write", iso2, latest.profile);
    try {
      return this.registry.diff(iso2, from, to);
    } catch {
      throw notFound(`${iso2} versions ${from}..${to}`);
    }
  }

  #authorize(principal: Principal, action: "country_config:write", iso2: string, profile: CountryProfile): void {
    require(principal, action, { type: "country_config", country: iso2 }, { activeCountry: iso2, profile });
  }

  /** Serialises config changes across instances, reloads, mutates, persists. On failure the cache is rebuilt from the record. */
  async #mutate<T>(iso2: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
    try {
      return await this.db.tx({}, async (sql) => {
        await sql.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
        this.registry.restore(await loadVersions(sql));
        const result = await fn(sql);
        await saveVersions(sql, this.registry.history(iso2));
        return result;
      });
    } catch (error) {
      await this.refresh().catch(() => undefined);
      if (error instanceof ConfigPublishError) throw new ApiError(422, "CONFIG_REJECTED", error.message, { issues: error.issues });
      throw error;
    }
  }
}

const badVersion = () => badRequest("VERSION_INVALID", "version is a positive whole number");
