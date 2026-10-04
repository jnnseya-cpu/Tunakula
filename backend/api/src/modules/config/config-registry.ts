/**
 * Country Config publishing (PRD §17, CFG-002, ADP-001, §28.10).
 *
 * A market is launched by publishing a validated Country Profile — no code
 * change, no deployment. Versions are append-only: drafts, published,
 * superseded. Rollback republishes an earlier version as a new version, so
 * history is never rewritten. Going live requires the §28.10 readiness review.
 */
import { validateCountryProfile, type CountryProfile, type ProfileIssue } from "@tunakula/ts-contracts";
import { validateBrand, type Brand } from "./brand.ts";
import { deriveCountryConfig, type CountryConfig } from "./country-config.ts";

/** §28.10 go-live readiness areas; each must be signed before a market first goes PILOT or LIVE. */
export const READINESS_AREAS = ["PRODUCT", "ENGINEERING", "PAYMENTS", "SECURITY", "COMPLIANCE", "OPERATIONS", "AI", "FINANCE"] as const;
export type ReadinessArea = (typeof READINESS_AREAS)[number];
export type ReadinessReview = Partial<Record<ReadinessArea, { readonly signedBy: string; readonly at: Date }>>;

export interface ProfileVersion {
  readonly iso2: string;
  readonly version: number;
  readonly status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  readonly profile: CountryProfile;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly publishedBy?: string;
  readonly publishedAt?: Date;
  /** Set when this version was created by rolling back to an earlier one. */
  readonly rolledBackFrom?: number;
}

export interface ConnectorListing {
  readonly id: string;
  /** Passed the §20.7 certification suite and live micro-transactions. */
  readonly certified: boolean;
}

export interface ConfigPublishedEvent {
  readonly type: "country.config.published";
  readonly iso2: string;
  readonly version: number;
  readonly by: string;
  readonly at: Date;
  readonly rollbackOf?: number;
}

export interface RegistryOptions {
  readonly brands: readonly Brand[];
  readonly connectors: readonly ConnectorListing[];
  /** Maps a profile's data-residency setting to the regional API host (§9.4). */
  readonly apiHosts: Readonly<Record<string, string>>;
  readonly now?: () => Date;
}

export class ConfigPublishError extends Error {
  readonly issues: readonly ProfileIssue[];

  constructor(message: string, issues: readonly ProfileIssue[]) {
    super(`${message}: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
    this.name = "ConfigPublishError";
    this.issues = issues;
  }
}

const LIVE_STATES = ["PILOT", "LIVE"];

export class CountryConfigRegistry {
  readonly #versions = new Map<string, ProfileVersion[]>();
  readonly #brands = new Map<string, Brand>();
  readonly #connectors: Map<string, ConnectorListing>;
  readonly #apiHosts: Readonly<Record<string, string>>;
  readonly #now: () => Date;
  readonly #listeners: ((e: ConfigPublishedEvent) => void)[] = [];
  readonly #cache = new Map<string, CountryConfig>();

  constructor(options: RegistryOptions) {
    for (const brand of options.brands) this.upsertBrand(brand);
    this.#connectors = new Map(options.connectors.map((c) => [c.id, c]));
    this.#apiHosts = options.apiHosts;
    this.#now = options.now ?? (() => new Date());
  }

  /** Brands change at runtime (§17.1); configs that use the brand pick it up on the next fetch. */
  upsertBrand(brand: Brand): void {
    const issues = validateBrand(brand);
    if (issues.length) throw new ConfigPublishError(`Brand ${brand.id} is invalid`, issues);
    this.#brands.set(brand.id, brand);
    for (const [iso2, config] of this.#cache) if (config.brand.id === brand.id) this.#cache.delete(iso2);
  }

  onPublished(listener: (e: ConfigPublishedEvent) => void): void {
    this.#listeners.push(listener);
  }

  /** Saves a new draft version. Drafts must pass the schema; publication applies the full checks. */
  saveDraft(actorUserId: string, document: unknown): ProfileVersion {
    const result = validateCountryProfile(document, { environment: "non-production" });
    if (!result.ok) throw new ConfigPublishError("Draft rejected", result.issues);
    const iso2 = result.profile.country.iso2;
    const history = this.#versions.get(iso2) ?? [];
    const version = history.length + 1;
    const draft: ProfileVersion = {
      iso2,
      version,
      status: "DRAFT",
      profile: { ...result.profile, version, status: "DRAFT" },
      createdBy: actorUserId,
      createdAt: this.#now(),
    };
    this.#versions.set(iso2, [...history, draft]);
    return draft;
  }

  /** Every version of every country, for persistence. */
  allVersions(): ProfileVersion[] {
    return [...this.#versions.values()].flat();
  }

  /** Rehydrates the registry from storage at boot (no validation re-run: these versions were accepted when written). */
  restore(versions: readonly ProfileVersion[]): void {
    this.#versions.clear();
    this.#cache.clear();
    for (const v of [...versions].sort((a, b) => a.version - b.version)) {
      this.#versions.set(v.iso2, [...(this.#versions.get(v.iso2) ?? []), v]);
    }
  }

  history(iso2: string): readonly ProfileVersion[] {
    return this.#versions.get(iso2) ?? [];
  }

  published(iso2: string): ProfileVersion | undefined {
    return this.history(iso2).find((v) => v.status === "PUBLISHED");
  }

  /** ADP-001: what changed between two versions, as JSON-pointer paths. */
  diff(iso2: string, from: number, to: number): { path: string; before: unknown; after: unknown }[] {
    const a = this.#version(iso2, from).profile;
    const b = this.#version(iso2, to).profile;
    const changes: { path: string; before: unknown; after: unknown }[] = [];
    const walk = (x: unknown, y: unknown, path: string) => {
      if (path === "/version" || path === "/status") return;
      if (isPlainObject(x) && isPlainObject(y)) {
        for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[key], y[key], `${path}/${key}`);
      } else if (Array.isArray(x) && Array.isArray(y)) {
        for (let i = 0; i < Math.max(x.length, y.length); i++) walk(x[i], y[i], `${path}/${i}`);
      } else if (JSON.stringify(x) !== JSON.stringify(y)) {
        changes.push({ path: path || "/", before: x, after: y });
      }
    };
    walk(a, b, "");
    return changes;
  }

  /**
   * Publishes a draft. Invalid configs cannot be published (CFG-002): the
   * profile must pass production validation, use a valid brand and theme,
   * resolve to a regional API host, and route only through certified
   * connectors. A market's first move to PILOT or LIVE needs a full §28.10 review.
   */
  publish(actorUserId: string, iso2: string, version: number, review: ReadinessReview = {}): CountryConfig {
    const draft = this.#version(iso2, version);
    if (draft.status !== "DRAFT") throw new ConfigPublishError("Only drafts can be published", [{ path: "/status", message: draft.status }]);
    const issues = this.#publishIssues(draft.profile, iso2, review);
    if (issues.length) throw new ConfigPublishError(`${iso2} v${version} cannot be published`, issues);
    return this.#activate(draft, actorUserId);
  }

  /**
   * Rolls back to the previously published version (CFG-002: < 1 minute) by
   * republishing its content as a new version. No readiness review is needed:
   * that content has been live before.
   */
  rollback(actorUserId: string, iso2: string): CountryConfig {
    const history = this.history(iso2);
    const current = this.published(iso2);
    const previous = [...history].reverse().find((v) => v.status === "SUPERSEDED" && v.publishedAt && v.version !== current?.version);
    if (!current || !previous) throw new ConfigPublishError("Nothing to roll back to", [{ path: "/", message: iso2 }]);
    const version = history.length + 1;
    const restored: ProfileVersion = {
      iso2,
      version,
      status: "DRAFT",
      profile: { ...previous.profile, version, status: "DRAFT" },
      createdBy: actorUserId,
      createdAt: this.#now(),
      rolledBackFrom: previous.version,
    };
    this.#versions.set(iso2, [...history, restored]);
    return this.#activate(restored, actorUserId);
  }

  /** GET /v1/countries/{iso2}/config */
  config(iso2: string): CountryConfig {
    const cached = this.#cache.get(iso2);
    if (cached) return cached;
    const live = this.published(iso2);
    if (!live) throw new ConfigPublishError("No published config", [{ path: "/", message: iso2 }]);
    const config = deriveCountryConfig(live.profile, this.#brands.get(live.profile.experience.brand_id) as Brand, this.#apiHost(live.profile) as string);
    this.#cache.set(iso2, config);
    return config;
  }

  /** GET /v1/countries — markets customers can see (PILOT and LIVE). */
  countries(): { iso2: string; name: string; status: string }[] {
    return [...this.#versions.keys()]
      .map((iso2) => this.published(iso2)?.profile)
      .filter((p): p is CountryProfile => !!p && LIVE_STATES.includes(p.country.status))
      .map((p) => ({ iso2: p.country.iso2, name: p.country.name, status: p.country.status }));
  }

  #publishIssues(profile: CountryProfile, iso2: string, review: ReadinessReview): ProfileIssue[] {
    const issues: ProfileIssue[] = [];
    const result = validateCountryProfile(profile, { environment: "production", asOf: this.#now() });
    if (!result.ok) issues.push(...result.issues);

    const brand = this.#brands.get(profile.experience.brand_id);
    if (!brand) issues.push({ path: "/experience/brand_id", message: `Unknown brand ${profile.experience.brand_id}` });
    else if (!brand.themes.some((t) => t.id === profile.experience.theme_id)) {
      issues.push({ path: "/experience/theme_id", message: `Brand ${brand.id} has no theme ${profile.experience.theme_id}` });
    }
    if (!this.#apiHost(profile)) {
      issues.push({ path: "/compliance/data_residency", message: `No regional API host for "${profile.compliance.data_residency}" — residency must be decided before launch` });
    }
    profile.payments.connectors.forEach((c, i) => {
      const listing = this.#connectors.get(c.id);
      if (!listing) issues.push({ path: `/payments/connectors/${i}/id`, message: `Connector ${c.id} is not registered` });
      else if (!listing.certified) issues.push({ path: `/payments/connectors/${i}/id`, message: `Connector ${c.id} has not passed certification (§20.7)` });
    });

    const everLive = this.history(iso2).some((v) => v.publishedAt && LIVE_STATES.includes(v.profile.country.status));
    if (LIVE_STATES.includes(profile.country.status) && !everLive) {
      for (const area of READINESS_AREAS) {
        if (!review[area]) issues.push({ path: `/readiness/${area}`, message: `§28.10 ${area.toLowerCase()} readiness not signed` });
      }
    }
    return issues;
  }

  #activate(version: ProfileVersion, actorUserId: string): CountryConfig {
    const at = this.#now();
    const updated = this.history(version.iso2).map((v): ProfileVersion => {
      if (v.version === version.version) return { ...v, status: "PUBLISHED", profile: { ...v.profile, status: "PUBLISHED" }, publishedBy: actorUserId, publishedAt: at };
      if (v.status === "PUBLISHED") return { ...v, status: "SUPERSEDED", profile: { ...v.profile, status: "SUPERSEDED" } };
      return v;
    });
    this.#versions.set(version.iso2, updated);
    this.#cache.delete(version.iso2);
    const event: ConfigPublishedEvent = {
      type: "country.config.published",
      iso2: version.iso2,
      version: version.version,
      by: actorUserId,
      at,
      ...(version.rolledBackFrom ? { rollbackOf: version.rolledBackFrom } : {}),
    };
    for (const listener of this.#listeners) listener(event);
    return this.config(version.iso2);
  }

  #version(iso2: string, version: number): ProfileVersion {
    const v = this.history(iso2).find((x) => x.version === version);
    if (!v) throw new ConfigPublishError("Unknown version", [{ path: "/version", message: `${iso2} v${version}` }]);
    return v;
  }

  #apiHost(profile: CountryProfile): string | undefined {
    return this.#apiHosts[profile.compliance.data_residency];
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
