/**
 * Trend Intelligence service — the control layer embedded in the existing Tunakula platform (spec §6, §16).
 *
 * It runs on the same DB, country tenancy (FORCE RLS), RBAC (authorize) and audit chain as every other service,
 * and is wired into the same dependency-injection container and HTTP app. Market admins author and approve
 * Growth Briefs; Tunakula's existing agents resolve the effective brief at run time to adapt their work. Server
 * resolves identities and stamps authoritative fields — a caller never asserts tenant/platform/market itself.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, forbidden, notFound, unprocessable } from "./errors.ts";
import { opportunityScore, confidence as confidenceScore, decide, hasVeto, type Band } from "../modules/trend/scoring.ts";
import { permitsChannel, validateBriefShape, type BriefChannel, type GrowthBriefV1 } from "../modules/trend/brief.ts";
import { baselineDraft, draftFromBrief, type ChannelDraft } from "../modules/trend/draft.ts";
import { corroborationFor, demandFromZ, logLift, robustZ, round2 } from "../modules/trend/scoring.ts";
import {
  approveBrief as approveBriefRow, branchMeta, branchOrderBuckets, countBranchOrders, effectiveBrief as resolveBrief,
  ingestObservations, lastSweepAt, latestApprovedBrief, recordSweepRun, saveBriefDraft, saveOpportunity, type ObservationInput,
} from "../persistence/trend.ts";

/** Deterministic proxies the autonomous sweep uses for the inputs it cannot read from a single order signal.
 *  Honest and conservative: orders are in-market completed purchases (high fit/intent), the signal is from the
 *  just-closed window (fresh), and a single first-party family caps confidence at 69 (so the sweep watches, it
 *  never silently makes a live change). Readiness is real: a branch with no available dish is vetoed. */
const SWEEP_FIT = 100;
const SWEEP_INTENT = 80;
const SWEEP_TIMING = 100;
const SWEEP_SOURCE_QUALITY = 80;
const SWEEP_ORIGIN = "2020-01-01T00:00:00Z"; // date_bin alignment origin
const SWEEP_COUNT_MIN = 10;                   // minimum current-window orders to consider a branch (per-source gate)

/** Authorable brief fields; the server stamps schema_version, ids, market and version (spec §6 "IDs resolve server-side"). */
export interface BriefDraftInput {
  readonly topic_id: string;
  readonly locale: string;
  readonly opportunity_score: number;
  readonly confidence: number;
  readonly valid_from: string;
  readonly expires_at: string;
  readonly evidence_ids: readonly string[];
  readonly audience: string;
  readonly intent: string;
  readonly approved_claim_ids: readonly string[];
  readonly cta_id: string;
  readonly allowed_channels: readonly BriefChannel[];
  readonly prohibited_claims?: readonly string[];
  readonly objective: string;
  readonly experiment_id: string;
  readonly policy_version: number;
  readonly opportunity_id?: string;
}

const SCORING_VERSION = 1;

export class TrendService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  /** Resolve the published market and check an ops capability, the same way the growth tools do. */
  #assertOps(principal: Principal, country: string, action: Action = "campaign:write") {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    if (!authorize(principal, action, { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) {
      throw forbidden("Trend tools are managed by a market admin");
    }
    return v;
  }

  /** POST /v1/observations:batch — scoped ingestion with accepted/duplicate/conflict counts (spec §16). */
  async ingest(country: string, principal: Principal, rows: readonly ObservationInput[]) {
    this.#assertOps(principal, country);
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest("EMPTY_BATCH", "Send at least one observation");
    if (rows.length > 500) throw badRequest("BATCH_TOO_LARGE", "At most 500 observations per batch");
    const result = await this.db.tx({ country }, (sql) => ingestObservations(sql, rows));
    return { accepted: result.accepted, duplicate: result.duplicate, conflict: result.conflict, conflicts: result.conflicts };
  }

  /** GET /v1/opportunities — list scored opportunities with breakdown, confidence and band (spec §16). */
  async opportunities(country: string, principal: Principal, filter: { topic?: string; status?: Band; limit?: number } = {}) {
    this.#assertOps(principal, country);
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<Record<string, unknown>>(
        `SELECT id::text, topic_id, market, locale, window_end, opportunity_score, confidence, band, breakdown, vetoes, created_at
           FROM trend.opportunity
          WHERE ($1::text IS NULL OR topic_id = $1) AND ($2::text IS NULL OR band = $2)
          ORDER BY created_at DESC LIMIT $3`,
        [filter.topic ?? null, filter.status ?? null, limit],
      );
      return { data: rows };
    });
  }

  /**
   * Score a topic from supplied component inputs and freeze the opportunity (spec §5). Deterministic: the five
   * opportunity inputs and four confidence inputs come from the detection layer; this computes the 0–100 scores,
   * the band and the veto, then freezes the snapshot idempotently on its input digest.
   */
  async score(
    country: string,
    principal: Principal,
    input: {
      topic_id: string; market?: string; locale: string; window_end: string;
      demand: number; fit: number; intent: number; timing: number; readiness: number;
      sourceQuality: number; corroboration: number; coverage: number; freshness: number;
      independentFamilies: number; veto?: boolean; autoOptIn?: boolean; evidence_ids?: readonly string[];
    },
  ) {
    this.#assertOps(principal, country);
    const market = (input.market ?? country).toUpperCase();
    const score = opportunityScore(input);
    const conf = confidenceScore(input, input.independentFamilies);
    const veto = hasVeto({}, input.readiness) || !!input.veto;
    const band = decide(score, conf, { veto, ...(input.autoOptIn !== undefined ? { autoOptIn: input.autoOptIn } : {}) });
    const breakdown = {
      inputs: { demand: input.demand, fit: input.fit, intent: input.intent, timing: input.timing, readiness: input.readiness },
      confidence_inputs: { sourceQuality: input.sourceQuality, corroboration: input.corroboration, coverage: input.coverage, freshness: input.freshness },
      independent_families: input.independentFamilies,
    };
    const digest = Buffer.from(JSON.stringify({ ...breakdown, score, conf, veto })).toString("base64").slice(0, 64);
    const saved = await this.db.tx({ country }, (sql) => saveOpportunity(sql, {
      topic_id: input.topic_id, market, locale: input.locale, window_end: input.window_end,
      scoring_version: SCORING_VERSION, input_digest: digest, opportunity_score: score, confidence: conf, band,
      breakdown, vetoes: veto ? ["readiness_or_policy"] : [], evidence_ids: input.evidence_ids ?? [],
    }));
    return { id: saved.id, frozen: saved.frozen, opportunity_score: score, confidence: conf, band };
  }

  /** POST /v1/briefs — assemble a server-stamped Growth Brief draft from authorable fields and validate it (spec §16). */
  async createBrief(country: string, principal: Principal, input: BriefDraftInput) {
    const v = this.#assertOps(principal, country);
    const brief: GrowthBriefV1 = {
      schema_version: 1,
      brief_id: `gb_${randomUUID().slice(0, 12)}`,
      brief_version: 1,
      tenant_id: `tnk_${country.toLowerCase()}`,
      platform_id: v.profile.experience.brand_id,
      market: country.toUpperCase(),
      locale: input.locale,
      topic_id: input.topic_id,
      opportunity_score: input.opportunity_score,
      confidence: input.confidence,
      valid_from: input.valid_from,
      expires_at: input.expires_at,
      evidence_ids: input.evidence_ids,
      audience: input.audience,
      intent: input.intent,
      approved_claim_ids: input.approved_claim_ids,
      cta_id: input.cta_id,
      allowed_channels: input.allowed_channels,
      prohibited_claims: input.prohibited_claims ?? [],
      objective: input.objective,
      experiment_id: input.experiment_id,
      policy_version: input.policy_version,
    };
    const check = validateBriefShape(brief);
    if (!check.ok) throw unprocessable("INVALID_BRIEF", `Brief failed validation: ${check.errors.map((e) => `${e.field} ${e.message}`).join("; ")}`);
    const { id } = await this.db.tx({ country }, (sql) => saveBriefDraft(sql, brief, input.opportunity_id ?? null));
    await this.db.tx({}, (sql) => audit(sql, { actor: principal.userId, action: "trend.brief_drafted", target: `brief:${brief.brief_id}`, country, detail: { topic: brief.topic_id } }));
    return { id, brief_id: brief.brief_id, brief_version: brief.brief_version, status: "DRAFT" };
  }

  /** POST /v1/briefs/{id}:approve — approve an exact revision; supersedes the prior active brief in scope (spec §16). */
  async approveBrief(country: string, principal: Principal, briefId: string, briefVersion: number) {
    this.#assertOps(principal, country, "agent_autonomy:set"); // approval is the privileged activation gate
    const res = await this.db.tx({ country }, (sql) => approveBriefRow(sql, briefId, briefVersion, principal.userId));
    if (!res.approved) throw notFound(`Brief ${briefId} v${briefVersion}`);
    await this.db.tx({}, (sql) => audit(sql, { actor: principal.userId, action: "trend.brief_approved", target: `brief:${briefId}`, country, detail: { version: briefVersion } }));
    return { brief_id: briefId, brief_version: briefVersion, status: "APPROVED" };
  }

  /**
   * GET /v1/briefs:effective — resolve the one approved, fresh, channel-matching brief that steers an agent, or
   * null → the agent uses its baseline behaviour. This is the method Tunakula's existing agents call at run time.
   */
  async effectiveBrief(country: string, scope: { market?: string; locale: string; topic_id: string; channel: string }): Promise<GrowthBriefV1 | null> {
    if (!this.registry.published(country)) return null;
    return this.db.tx({ country }, (sql) => resolveBrief(sql, {
      market: (scope.market ?? country).toUpperCase(), locale: scope.locale, topic_id: scope.topic_id, channel: scope.channel, now: this.now(),
    }));
  }

  /**
   * Generate a deterministic channel draft for a topic, steered by the effective brief (spec §2 "Generate
   * actions", §7). This is how an existing agent's output is shaped by the control layer: the draft's audience,
   * intent, CTA and claims come from the approved brief and exclude every prohibited claim; with no effective
   * brief (or a channel the brief does not allow) it returns an honestly-flagged baseline template. No AI — the
   * template path keeps the workflow available during a model outage.
   */
  async draft(country: string, principal: Principal, scope: { locale: string; topic_id: string; channel: BriefChannel; market?: string }): Promise<ChannelDraft> {
    this.#assertOps(principal, country);
    const brief = await this.effectiveBrief(country, scope);
    if (brief && permitsChannel(brief, scope.channel)) return draftFromBrief(brief, scope.channel);
    return baselineDraft(scope.channel, scope.topic_id);
  }

  /**
   * Propose a brief-steered version of the EXISTING storefront content (spec §7 owned placement). This steers
   * what customers see only through Tunakula's existing CMS and ONLY as a proposal — it never writes: a market
   * admin reviews and applies it through the existing SiteContentService.save (the current approval path), so
   * there is no new visible surface and no silent publish. The hero subtitle is enriched from the effective
   * brief's audience and intent; prohibited claims can never appear. With no effective brief the current content
   * is returned unchanged (steered_by null).
   */
  async proposeSiteContent(country: string, principal: Principal, scope: { locale: string; topic_id: string }): Promise<{ steered_by: string | null; home: Record<string, unknown> }> {
    this.#assertOps(principal, country);
    const brief = (await this.effectiveBrief(country, { ...scope, channel: "owned_placement" }))
      ?? (await this.effectiveBrief(country, { ...scope, channel: "seo" }));
    const current = await this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ value: Record<string, unknown> }>("SELECT value FROM comms.site_content WHERE key = 'home'");
      return rows[0]?.value ?? {};
    });
    if (!brief) return { steered_by: null, home: current };

    const hero = (current.hero ?? {}) as Record<string, unknown>;
    const steeredSubtitle = `${brief.audience} — ${brief.intent}.`.slice(0, 240);
    const haystack = `${String(hero.title ?? "")}\n${steeredSubtitle}`.toLowerCase();
    for (const phrase of brief.prohibited_claims) {
      if (phrase && haystack.includes(phrase.toLowerCase())) throw unprocessable("PROHIBITED_CLAIM", `Proposal would contain a prohibited claim: ${phrase}`);
    }
    const home = { ...current, hero: { ...hero, subtitle: steeredSubtitle } };
    return { steered_by: brief.brief_id, home };
  }

  /**
   * Measure the effect of an approved brief and recommend continue / revise / rollback (spec §10, §18). Invisible
   * and READ-ONLY: it compares the first-party outcome (non-cancelled orders on the topic's branch) in the
   * treated window since the brief took effect against a MATCHED baseline window of equal length just before it,
   * and reports the lift. It never acts — a rollback still goes through the existing approval path. Honest about
   * evidence: below a minimum sample, or with no approved brief / no first-party outcome source, it returns
   * `inconclusive` rather than a false signal (spec §10 "record inconclusive").
   */
  async measure(country: string, principal: Principal, scope: { topic_id: string; now?: Date; minSample?: number }) {
    this.#assertOps(principal, country);
    const now = scope.now ?? this.now();
    const minSample = scope.minSample ?? 20;
    const nowIso = now.toISOString();
    return this.db.tx({ country }, async (sql) => {
      const brief = await latestApprovedBrief(sql, scope.topic_id);
      if (!brief) return { recommendation: "inconclusive" as const, reason: "no approved brief for this topic", sufficient: false };
      // First-party outcome source: the sweep names branch topics `branch-<uuid>`.
      const branchId = scope.topic_id.startsWith("branch-") ? scope.topic_id.slice("branch-".length) : null;
      if (!branchId) return { recommendation: "inconclusive" as const, reason: "no first-party outcome source for this topic", sufficient: false, brief_id: brief.brief_id };

      const sinceMs = Date.parse(brief.valid_from);
      const lengthMs = now.getTime() - sinceMs;
      if (lengthMs <= 0) return { recommendation: "inconclusive" as const, reason: "brief has not taken effect yet", sufficient: false, brief_id: brief.brief_id };
      const baselineFromIso = new Date(sinceMs - lengthMs).toISOString();

      const treated = await countBranchOrders(sql, branchId, brief.valid_from, nowIso);
      const baseline = await countBranchOrders(sql, branchId, baselineFromIso, brief.valid_from);
      const lift = logLift(treated, baseline); // ln((treated+1)/(baseline+1))
      const sufficient = treated + baseline >= minSample;
      const recommendation = !sufficient ? "inconclusive" as const
        : lift > Math.log(1.1) ? "continue" as const      // ≥ ~10% up
        : lift < Math.log(0.9) ? "rollback" as const      // ≥ ~10% down
        : "revise" as const;                               // flat
      return {
        brief_id: brief.brief_id, objective: brief.objective, recommendation, sufficient,
        treated, baseline, lift: round2(lift),
        treated_window: { from: brief.valid_from, to: nowIso },
        baseline_window: { from: baselineFromIso, to: brief.valid_from },
      };
    });
  }

  /**
   * The autonomous background sweep (spec §2 automatic reading, §5 detection). Runs HEADLESS and INVISIBLE in the
   * operations loop — no UI, nothing user-visible: it reads Tunakula's own first-party order signal, measures
   * each published branch's demand this complete window against its prior windows (robust z), and freezes a
   * scored opportunity for every branch that passes the gate. A single first-party family caps confidence at 69,
   * so the sweep WATCHES demand; it never silently approves or activates a live, user-facing change. A cadence
   * guard keeps it to roughly one run per interval per country. No principal: this is a system job.
   */
  async sweep(
    country: string,
    opts: { dryRun?: boolean; now?: Date; intervalMinutes?: number; historyWindows?: number; force?: boolean } = {},
  ): Promise<{ ran: boolean; observations: number; opportunities: number; briefs: number; window_end: string | null }> {
    if (!this.registry.published(country)) return { ran: false, observations: 0, opportunities: 0, briefs: 0, window_end: null };
    const dryRun = opts.dryRun ?? false;
    const interval = opts.intervalMinutes ?? 60;
    const historyWindows = opts.historyWindows ?? 8;
    const now = opts.now ?? this.now();

    return this.db.tx({ country }, async (sql) => {
      if (!opts.force && !dryRun) {
        const last = await lastSweepAt(sql);
        if (last && now.getTime() - last.getTime() < interval * 60_000) {
          return { ran: false, observations: 0, opportunities: 0, briefs: 0, window_end: null };
        }
      }
      const intervalMs = interval * 60_000;
      const originMs = Date.parse(SWEEP_ORIGIN);
      const k = Math.floor((now.getTime() - originMs) / intervalMs); // bucket index containing `now` (incomplete)
      const currentStartMs = originMs + (k - 1) * intervalMs;        // the latest COMPLETE window
      const windowEndMs = originMs + k * intervalMs;
      const sinceMs = originMs + (k - 1 - historyWindows) * intervalMs;

      const buckets = await branchOrderBuckets(sql, { intervalMinutes: interval, since: new Date(sinceMs).toISOString(), origin: SWEEP_ORIGIN });
      const meta = new Map((await branchMeta(sql)).map((m) => [m.branch_id, m]));

      // Group each branch's window counts by bucket start.
      const byBranch = new Map<string, Map<number, number>>();
      for (const b of buckets) {
        const t = Date.parse(b.bucket);
        if (!byBranch.has(b.branch_id)) byBranch.set(b.branch_id, new Map());
        byBranch.get(b.branch_id)!.set(t, b.n);
      }

      let observations = 0, opportunities = 0, briefs = 0;
      const windowEndIso = new Date(windowEndMs).toISOString();
      for (const [branchId, m] of meta) {
        const counts = byBranch.get(branchId) ?? new Map<number, number>();
        const current = counts.get(currentStartMs) ?? 0;
        if (current < SWEEP_COUNT_MIN) continue;
        const history: number[] = [];
        for (let i = 1; i <= historyWindows; i++) history.push(counts.get(currentStartMs - i * intervalMs) ?? 0);
        const z = robustZ(current, history);
        if (z < 2) continue; // not a rising signal

        const readiness = m.status === "OPEN" && m.available_items > 0 ? 100 : 0;
        const demand = demandFromZ(z);
        const score = opportunityScore({ demand, fit: SWEEP_FIT, intent: SWEEP_INTENT, timing: SWEEP_TIMING, readiness });
        const conf = confidenceScore({ sourceQuality: SWEEP_SOURCE_QUALITY, corroboration: corroborationFor(1), coverage: 100, freshness: 100 }, 1);
        const veto = hasVeto({}, readiness);
        const band = decide(score, conf, { veto });
        if (band === "ARCHIVE") continue;

        const topicId = `branch-${branchId}`;
        const breakdown = { demand, fit: SWEEP_FIT, intent: SWEEP_INTENT, timing: SWEEP_TIMING, readiness, current, history, z, source: "first_party_orders" };
        const digest = Buffer.from(JSON.stringify({ topicId, windowEndIso, breakdown })).toString("base64").slice(0, 64);

        if (!dryRun) {
          await ingestObservations(sql, [{
            source_id: "first_party_orders", source_family: "first_party", source_record_id: `${branchId}@${windowEndIso}`,
            observed_at: windowEndIso, window_start: new Date(currentStartMs).toISOString(), window_end: windowEndIso,
            metric: "orders", value: current, evidence_hash: digest,
          }]);
          observations++;
          const saved = await saveOpportunity(sql, {
            topic_id: topicId, market: country.toUpperCase(), locale: "und", window_end: windowEndIso,
            scoring_version: SCORING_VERSION, input_digest: digest, opportunity_score: score, confidence: conf,
            band, breakdown, vetoes: veto ? ["readiness"] : [], evidence_ids: [],
          });
          if (!saved.frozen) opportunities++;
        } else {
          opportunities++;
        }
      }
      if (!dryRun) await recordSweepRun(sql, { dry_run: false, observations, opportunities, briefs, window_end: windowEndIso });
      return { ran: true, observations, opportunities, briefs, window_end: windowEndIso };
    });
  }
}
