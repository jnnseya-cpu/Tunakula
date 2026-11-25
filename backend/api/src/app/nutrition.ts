/**
 * Nutrition service — the AI agent that fills missing per-100 g nutrition so dishes can be Nutri-Scored (§AI).
 *
 * For each published dish with no nutrition basis yet, it asks the estimator brain (a hosted model, or the
 * deterministic fallback that makes NO estimate) for per-100 g figures, and stores any estimate tagged
 * `ai_estimate` — so the resulting Nutri-Score is always shown as estimated, never measured, and a human can
 * override it. With no model configured the estimator returns nothing and this is a cheap no-op. Bounded per run
 * and rate-limited per country so it never floods the model. It runs headless (no principal): a system job.
 */
import type { NutritionEstimatorBrain } from "@tunakula/ts-contracts";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { classifyBeverage } from "../modules/nutriscore/nutriscore.ts";
import { candidatesForEstimate, countMissing, storeNutrition } from "../persistence/nutrition.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";

export class NutritionService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly estimator: NutritionEstimatorBrain;
  private readonly now: () => number;
  /** In-memory per-country cadence so the background loop does not re-run the estimator every tick. */
  private readonly lastRun = new Map<string, number>();

  constructor(db: Db, registry: CountryConfigRegistry, estimator: NutritionEstimatorBrain, now: () => number = () => Date.now()) {
    this.db = db;
    this.registry = registry;
    this.estimator = estimator;
    this.now = now;
  }

  /** Does a model actually back the estimator? With the deterministic fallback there is nothing to fill. */
  get aiConfigured(): boolean { return this.estimator.id !== "sandbox"; }

  /**
   * Estimate and store nutrition for up to `limit` dishes that still lack it. `minIntervalMs` guards the per-
   * country cadence for the background caller; pass 0 to force. Returns what it scanned/estimated/skipped.
   */
  async estimateMissing(country: string, opts: { limit?: number; minIntervalMs?: number } = {}): Promise<{ scanned: number; estimated: number; skipped: number; ran: boolean }> {
    if (!this.registry.published(country) || !this.aiConfigured) return { scanned: 0, estimated: 0, skipped: 0, ran: false };
    const minInterval = opts.minIntervalMs ?? 0;
    if (minInterval > 0) {
      const last = this.lastRun.get(country);
      if (last && this.now() - last < minInterval) return { scanned: 0, estimated: 0, skipped: 0, ran: false };
    }
    this.lastRun.set(country, this.now());
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
    const r = await this.#estimateBatch(country, limit);
    return { ...r, ran: true };
  }

  /**
   * Operator-triggered backfill (spec §AI): estimate up to `limit` dishes in one go, then report how many still
   * need it (`remaining`), so an admin can grade a whole catalogue fast by calling it until remaining is 0 — far
   * quicker than the gentle background trickle, yet still bounded per call so it never floods the model. Requires
   * the campaign:write capability; no cadence guard.
   */
  async backfill(country: string, principal: Principal, opts: { limit?: number } = {}): Promise<{ scanned: number; estimated: number; skipped: number; remaining: number }> {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    if (!authorize(principal, "campaign:write", { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) {
      throw forbidden("Nutrition backfill is managed by a market admin");
    }
    if (!this.aiConfigured) throw badRequest("NO_AI", "No AI model is configured; set the AI provider in Integrations first");
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    const r = await this.#estimateBatch(country, limit);
    const remaining = await this.db.tx({ country }, (sql) => countMissing(sql));
    return { ...r, remaining };
  }

  /** Estimate and store nutrition for up to `limit` candidate dishes. The AI calls run outside any transaction. */
  async #estimateBatch(country: string, limit: number): Promise<{ scanned: number; estimated: number; skipped: number }> {
    const candidates = await this.db.tx({ country }, (sql) => candidatesForEstimate(sql, limit));
    let estimated = 0, skipped = 0;
    for (const c of candidates) {
      const name = c.names.fr || c.names.en || Object.values(c.names)[0] || "";
      if (!name) { skipped++; continue; }
      const description = c.description?.fr || c.description?.en || "";
      const ingredients = [...c.addons.map((a) => a.name), ...c.variations.flatMap((v) => v.options.map((o) => o.name))].filter(Boolean);
      const kind = classifyBeverage([c.category ?? "", ...Object.values(c.names), ...c.tags].join(" ")) ? "beverage" : "food";
      const res = await this.estimator.estimate({ name, ...(c.category ? { category: c.category } : {}), cuisines: c.tags, description, ingredients, kind, lang: "fr" });
      if (!res.estimate) { skipped++; continue; }
      const e = res.estimate;
      const facts = {
        energy_kj_100g: e.energy_kj_100g, sugars_g_100g: e.sugars_g_100g, sat_fat_g_100g: e.sat_fat_g_100g,
        salt_g_100g: e.salt_g_100g, fibre_g_100g: e.fibre_g_100g, protein_g_100g: e.protein_g_100g, fruit_veg_legume_pct: e.fruit_veg_legume_pct,
      };
      await this.db.tx({ country }, (sql) => storeNutrition(sql, c.id, facts, "ai_estimate"));
      estimated++;
    }
    return { scanned: candidates.length, estimated, skipped };
  }
}
