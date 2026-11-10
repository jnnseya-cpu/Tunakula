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
import {
  approveBrief as approveBriefRow, effectiveBrief as resolveBrief, ingestObservations,
  saveBriefDraft, saveOpportunity, type ObservationInput,
} from "../persistence/trend.ts";

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
}
