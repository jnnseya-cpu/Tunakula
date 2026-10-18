/**
 * Storefront CMS. A market admin edits the storefront's landing hero (headline, subcopy, call-to-action), the
 * social links and the footer tagline per country, without a code change. The customer app reads the live document
 * from GET /v1/site-content and falls back to its built-in defaults when a market has not set one. Additive and
 * purely presentational — the "landing / pages / social / theme" content tool the benchmark apps ship as a CMS.
 *
 * Content is stored as one JSON document per (country, key); today the only key is "home". The service validates
 * and shapes the document, so the public endpoint and the admin editor always agree on its structure, and links
 * are constrained to in-app paths or https URLs (never javascript: and the like).
 */
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";

const KEY = "home";
const SOCIAL = ["facebook", "instagram", "x", "tiktok", "youtube", "whatsapp"] as const;
type SocialKey = (typeof SOCIAL)[number];

export interface HomeContent {
  hero: { title: string; subtitle: string; cta_label: string; cta_href: string };
  social: Partial<Record<SocialKey, string>>;
  tagline: string;
}

// Shipped defaults — what the storefront shows until a market overrides it. Kept in step with the hardcoded copy.
const DEFAULTS: HomeContent = {
  hero: {
    title: "Get to eat.",
    subtitle: "Kinshasa's kitchens, groceries and pharmacies — delivered by road, with the distance and time shown before you order.",
    cta_label: "Order now",
    cta_href: "/order/",
  },
  social: {},
  tagline: "Tunakula — get to eat. A Groupe Nseya company.",
};

export class SiteContentService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;

  constructor(db: Db, registry: CountryConfigRegistry) {
    this.db = db;
    this.registry = registry;
  }

  #assertMarket(country: string) { if (!this.registry.published(country)) throw notFound(`Market ${country}`); }

  /** GET /v1/site-content — the live storefront content for a market, merged over the shipped defaults.
   * `customized` is true once a market admin has saved a document, so the storefront knows whether to override
   * its hand-designed default copy. */
  async live(country: string): Promise<{ home: HomeContent; customized: boolean }> {
    this.#assertMarket(country);
    const stored = await this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ value: Partial<HomeContent> } & Record<string, unknown>>("SELECT value FROM comms.site_content WHERE key = $1", [KEY]);
      return rows[0]?.value ?? null;
    });
    return { home: merge(stored), customized: stored !== null };
  }

  #assertAdmin(principal: Principal, country: string) {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    if (!authorize(principal, "campaign:write", { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) throw forbidden("Storefront content is managed by a market admin");
  }

  /** Admin: read the current document (merged over defaults) for the editor. */
  async get(country: string, principal: Principal): Promise<{ home: HomeContent }> {
    this.#assertAdmin(principal, country);
    const stored = await this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ value: Partial<HomeContent> } & Record<string, unknown>>("SELECT value FROM comms.site_content WHERE key = $1", [KEY]);
      return rows[0]?.value ?? null;
    });
    return { home: merge(stored) };
  }

  /** Admin: replace the home document. */
  async save(country: string, principal: Principal, input: unknown): Promise<{ home: HomeContent }> {
    this.#assertAdmin(principal, country);
    const doc = parse(input);
    return this.db.tx({ country }, async (sql) => {
      await sql.query(
        `INSERT INTO comms.site_content (country_iso2, key, value, updated_by, updated_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (country_iso2, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [country, KEY, JSON.stringify(doc), principal.userId],
      );
      await audit(sql, { actor: principal.userId, action: "site_content.saved", target: `country:${country}`, country, detail: { key: KEY } });
      return { home: merge(doc) };
    });
  }
}

/** Overlay a stored (partial) document onto the shipped defaults so every field is always present. */
function merge(doc: Partial<HomeContent> | null): HomeContent {
  const social: Partial<Record<SocialKey, string>> = {};
  for (const k of SOCIAL) { const v = doc?.social?.[k]; if (v) social[k] = v; }
  return {
    hero: {
      title: doc?.hero?.title?.trim() || DEFAULTS.hero.title,
      subtitle: doc?.hero?.subtitle?.trim() || DEFAULTS.hero.subtitle,
      cta_label: doc?.hero?.cta_label?.trim() || DEFAULTS.hero.cta_label,
      cta_href: doc?.hero?.cta_href?.trim() || DEFAULTS.hero.cta_href,
    },
    social,
    tagline: doc?.tagline?.trim() || DEFAULTS.tagline,
  };
}

function link(raw: unknown, field: string, external: boolean): string {
  const href = String(raw ?? "").trim().slice(0, 300);
  if (!href) return "";
  if (external) { if (!/^https?:\/\/[^\s]+$/.test(href)) throw badRequest("LINK_INVALID", `${field} must be an https URL`); }
  else if (!/^\/[^\s]*$/.test(href) && !/^https?:\/\/[^\s]+$/.test(href)) throw badRequest("LINK_INVALID", `${field} is an in-app path (/order) or an https URL`);
  return href;
}

function parse(input: unknown): HomeContent {
  const o = (input ?? {}) as Record<string, unknown>;
  const hero = (o.hero ?? {}) as Record<string, unknown>;
  const socialIn = (o.social ?? {}) as Record<string, unknown>;
  const title = String(hero.title ?? "").trim().slice(0, 80);
  if (!title) throw badRequest("TITLE_REQUIRED", "The hero needs a title");
  const social: Partial<Record<SocialKey, string>> = {};
  for (const k of SOCIAL) { const v = link(socialIn[k], `social.${k}`, true); if (v) social[k] = v; }
  return {
    hero: {
      title,
      subtitle: String(hero.subtitle ?? "").trim().slice(0, 240),
      cta_label: String(hero.cta_label ?? "").trim().slice(0, 40) || DEFAULTS.hero.cta_label,
      cta_href: link(hero.cta_href, "hero.cta_href", false) || DEFAULTS.hero.cta_href,
    },
    social,
    tagline: String(o.tagline ?? "").trim().slice(0, 280) || DEFAULTS.tagline,
  };
}
