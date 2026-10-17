/**
 * Marketing banners. A market admin places a promotional banner (headline, subtext, a call-to-action link) in the
 * customer app for a time window; the storefront shows whichever ones are live. Purely presentational and additive.
 * The "campaigns / banners" merchandising tool every benchmark app has.
 */
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, forbidden, notFound, unprocessable } from "./errors.ts";

const TONES = ["ACCENT", "DARK", "GREEN", "ORANGE"] as const;
type Tone = (typeof TONES)[number];
interface BannerRow { id: string; headline: string; subtext: string; cta_label: string; cta_href: string; tone: Tone; starts_at: Date; ends_at: Date; sort: number; active: boolean }
interface BannerInput { headline?: string; subtext?: string; cta_label?: string; cta_href?: string; tone?: string; starts_at?: string; ends_at?: string; sort?: number; active?: boolean }
const COLS = "id, headline, subtext, cta_label, cta_href, tone, starts_at, ends_at, sort, active";

export class BannerService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  #assertMarket(country: string) { if (!this.registry.published(country)) throw notFound(`Market ${country}`); }

  /** GET /v1/banners — the banners live right now, for the customer app. */
  async live(country: string) {
    this.#assertMarket(country);
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<BannerRow & Record<string, unknown>>(
        `SELECT ${COLS} FROM comms.banner WHERE active = true AND starts_at <= $1 AND ends_at > $1 ORDER BY sort, created_at`,
        [now],
      );
      return { banners: rows.map(publicBanner) };
    });
  }

  #assertAdmin(principal: Principal, country: string) {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    if (!authorize(principal, "campaign:write", { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) throw forbidden("Banners are managed by a market admin");
  }

  /** Admin: list all banners (live, upcoming, ended, off). */
  async list(country: string, principal: Principal) {
    this.#assertAdmin(principal, country);
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<BannerRow & Record<string, unknown>>(`SELECT ${COLS} FROM comms.banner ORDER BY sort, starts_at DESC`);
      return { banners: rows.map((b) => ({ ...publicBanner(b), status: status(b, now) })) };
    });
  }

  async create(country: string, principal: Principal, input: BannerInput) {
    this.#assertAdmin(principal, country);
    const p = parse(input, true);
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<BannerRow & Record<string, unknown>>(
        `INSERT INTO comms.banner (country_iso2, headline, subtext, cta_label, cta_href, tone, starts_at, ends_at, sort, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
        [country, p.headline, p.subtext, p.cta_label, p.cta_href, p.tone, p.starts_at, p.ends_at, p.sort, p.active ?? true],
      );
      await audit(sql, { actor: principal.userId, action: "banner.created", target: `country:${country}`, country, detail: { banner: row!.id } });
      return { ...publicBanner(row!), status: status(row!, this.now()) };
    });
  }

  async update(country: string, principal: Principal, id: string, input: BannerInput) {
    this.#assertAdmin(principal, country);
    const p = parse(input, false);
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (c: string, v: unknown) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
    for (const [k, v] of Object.entries(p)) if (v !== undefined) add(k, v);
    return this.db.tx({ country }, async (sql) => {
      if (sets.length === 0) { const [row] = await sql.query<BannerRow & Record<string, unknown>>(`SELECT ${COLS} FROM comms.banner WHERE id = $1`, [id]); if (!row) throw notFound("Banner"); return { ...publicBanner(row), status: status(row, this.now()) }; }
      const [row] = await sql.query<BannerRow & Record<string, unknown>>(`UPDATE comms.banner SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, vals);
      if (!row) throw notFound("Banner");
      await audit(sql, { actor: principal.userId, action: "banner.updated", target: `country:${country}`, country, detail: { banner: id } });
      return { ...publicBanner(row), status: status(row, this.now()) };
    });
  }

  async remove(country: string, principal: Principal, id: string) {
    this.#assertAdmin(principal, country);
    return this.db.tx({ country }, async (sql) => {
      if ((await sql.query("DELETE FROM comms.banner WHERE id = $1 RETURNING id", [id])).length === 0) throw notFound("Banner");
      await audit(sql, { actor: principal.userId, action: "banner.deleted", target: `country:${country}`, country, detail: { banner: id } });
      return { deleted: true };
    });
  }
}

function publicBanner(b: BannerRow) {
  return { id: b.id, headline: b.headline, subtext: b.subtext, cta_label: b.cta_label, cta_href: b.cta_href, tone: b.tone, starts_at: new Date(b.starts_at).toISOString(), ends_at: new Date(b.ends_at).toISOString(), sort: b.sort, active: b.active };
}
function status(b: BannerRow, now: Date): "LIVE" | "UPCOMING" | "ENDED" | "OFF" {
  if (!b.active) return "OFF";
  const s = new Date(b.starts_at), e = new Date(b.ends_at);
  return e <= now ? "ENDED" : s > now ? "UPCOMING" : "LIVE";
}
function parse(input: BannerInput, creating: boolean) {
  const out: { headline?: string; subtext?: string; cta_label?: string; cta_href?: string; tone?: Tone; starts_at?: Date; ends_at?: Date; sort?: number; active?: boolean } = {};
  if (creating || input.headline !== undefined) { const h = String(input.headline ?? "").trim(); if (!h) throw badRequest("HEADLINE_REQUIRED", "A banner needs a headline"); out.headline = h.slice(0, 120); }
  if (input.subtext !== undefined) out.subtext = String(input.subtext).trim().slice(0, 240);
  else if (creating) out.subtext = "";
  if (input.cta_label !== undefined) out.cta_label = String(input.cta_label).trim().slice(0, 40);
  else if (creating) out.cta_label = "";
  if (input.cta_href !== undefined) {
    const href = String(input.cta_href).trim().slice(0, 240);
    // Keep links in-app (a path) or to an allowed external scheme; never javascript: etc.
    if (href && !/^\/[^\s]*$/.test(href) && !/^https?:\/\/[^\s]+$/.test(href)) throw badRequest("LINK_INVALID", "A link is an in-app path (/order) or an https URL");
    out.cta_href = href;
  } else if (creating) out.cta_href = "";
  if (creating || input.tone !== undefined) { const tone = String(input.tone ?? "ACCENT").toUpperCase(); if (!TONES.includes(tone as Tone)) throw badRequest("TONE_INVALID", "tone is ACCENT, DARK, GREEN or ORANGE"); out.tone = tone as Tone; }
  if (input.sort !== undefined) out.sort = Math.round(Number(input.sort) || 0);
  if (creating || input.starts_at !== undefined || input.ends_at !== undefined) {
    if (input.starts_at !== undefined) { const s = new Date(String(input.starts_at)); if (Number.isNaN(s.getTime())) throw badRequest("TIME_INVALID", "Give a start time"); out.starts_at = s; }
    if (input.ends_at !== undefined) { const e = new Date(String(input.ends_at)); if (Number.isNaN(e.getTime())) throw badRequest("TIME_INVALID", "Give an end time"); out.ends_at = e; }
    if (creating && (out.starts_at === undefined || out.ends_at === undefined)) throw badRequest("TIME_INVALID", "Give a start and an end time");
    if (out.starts_at && out.ends_at && out.ends_at <= out.starts_at) throw unprocessable("WINDOW_INVALID", "A banner ends after it starts");
  }
  if (input.active !== undefined) out.active = Boolean(input.active);
  return out;
}
