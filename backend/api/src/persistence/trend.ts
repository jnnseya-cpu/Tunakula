/**
 * Trend Intelligence persistence (spec §5, §6, §15, §16). All functions run inside a country transaction, so
 * FORCE RLS scopes every read and write to the active country — the caller sets it with db.tx({ country }).
 * Ingestion is idempotent on the source-version key; opportunities freeze on their input digest; one approved
 * brief is active per (market, locale, topic) scope.
 */
import type { Sql } from "../db/db.ts";
import type { Band } from "../modules/trend/scoring.ts";
import type { GrowthBriefV1 } from "../modules/trend/brief.ts";

export interface ObservationInput {
  readonly source_id: string;
  readonly source_family: string;
  readonly source_record_id: string;
  readonly revision?: number;
  readonly observed_at: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly geography?: string | null;
  readonly locale?: string | null;
  readonly segment?: string | null;
  readonly metric: string;
  readonly value: number;
  readonly unit?: string | null;
  readonly scaling_scope?: string | null;
  readonly coverage?: number | null;
  readonly evidence_uri?: string | null;
  readonly evidence_hash: string;
  readonly terms_version?: string | null;
}

export interface IngestResult { accepted: number; duplicate: number; conflict: number; conflicts: string[] }

/**
 * Ingest a batch of observations (spec POST /v1/observations:batch). Each row is idempotent on
 * (source_id, source_record_id, revision): an exact replay (same evidence_hash) is a DUPLICATE no-op; the same
 * key with a DIFFERENT evidence_hash is a CONFLICT (never a silent overwrite). Returns per-class counts.
 */
export async function ingestObservations(sql: Sql, rows: readonly ObservationInput[]): Promise<IngestResult> {
  const r: IngestResult = { accepted: 0, duplicate: 0, conflict: 0, conflicts: [] };
  for (const o of rows) {
    const rev = o.revision ?? 1;
    const inserted = await sql.query<{ id: string }>(
      `INSERT INTO trend.observation
         (country_iso2, source_id, source_family, source_record_id, revision, observed_at, window_start, window_end,
          geography, locale, segment, metric, value, unit, scaling_scope, coverage, evidence_uri, evidence_hash, terms_version)
       VALUES (platform.current_country(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (country_iso2, source_id, source_record_id, revision) DO NOTHING
       RETURNING id`,
      [o.source_id, o.source_family, o.source_record_id, rev, o.observed_at, o.window_start, o.window_end,
       o.geography ?? null, o.locale ?? null, o.segment ?? null, o.metric, o.value, o.unit ?? null,
       o.scaling_scope ?? null, o.coverage ?? null, o.evidence_uri ?? null, o.evidence_hash, o.terms_version ?? null],
    );
    if (inserted.length === 1) { r.accepted++; continue; }
    const [existing] = await sql.query<{ evidence_hash: string }>(
      "SELECT evidence_hash FROM trend.observation WHERE source_id = $1 AND source_record_id = $2 AND revision = $3",
      [o.source_id, o.source_record_id, rev],
    );
    if (existing && existing.evidence_hash === o.evidence_hash) r.duplicate++;
    else { r.conflict++; r.conflicts.push(`${o.source_id}/${o.source_record_id}#${rev}`); }
  }
  return r;
}

export interface OpportunityRecord {
  readonly topic_id: string;
  readonly market: string;
  readonly locale: string;
  readonly window_end: string;
  readonly scoring_version: number;
  readonly input_digest: string;
  readonly opportunity_score: number;
  readonly confidence: number;
  readonly band: Band;
  readonly breakdown: unknown;
  readonly vetoes?: unknown;
  readonly evidence_ids?: readonly string[];
}

/**
 * Freeze a scored opportunity (spec §5, §15). Idempotent on
 * (topic, window_end, scoring_version, input_digest): the same inputs always resolve to the same frozen row, so
 * re-scoring never produces a second snapshot or shifts a decision already taken. Returns the frozen row's id.
 */
export async function saveOpportunity(sql: Sql, o: OpportunityRecord): Promise<{ id: string; frozen: boolean }> {
  const inserted = await sql.query<{ id: string }>(
    `INSERT INTO trend.opportunity
       (country_iso2, topic_id, market, locale, window_end, scoring_version, input_digest,
        opportunity_score, confidence, band, breakdown, vetoes, evidence_ids)
     VALUES (platform.current_country(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (country_iso2, topic_id, window_end, scoring_version, input_digest) DO NOTHING
     RETURNING id`,
    [o.topic_id, o.market, o.locale, o.window_end, o.scoring_version, o.input_digest,
     o.opportunity_score, o.confidence, o.band, JSON.stringify(o.breakdown), JSON.stringify(o.vetoes ?? []), o.evidence_ids ?? []],
  );
  if (inserted.length === 1) return { id: inserted[0]!.id, frozen: false };
  const [existing] = await sql.query<{ id: string }>(
    "SELECT id FROM trend.opportunity WHERE topic_id = $1 AND window_end = $2 AND scoring_version = $3 AND input_digest = $4",
    [o.topic_id, o.window_end, o.scoring_version, o.input_digest],
  );
  return { id: existing!.id, frozen: true };
}

/** Insert a Growth Brief as a DRAFT (spec POST /v1/briefs). The payload is the validated closed v1 object. */
export async function saveBriefDraft(sql: Sql, brief: GrowthBriefV1, opportunityId: string | null): Promise<{ id: string }> {
  const [row] = await sql.query<{ id: string }>(
    `INSERT INTO trend.growth_brief
       (country_iso2, brief_id, brief_version, topic_id, market, locale, status, payload, valid_from, expires_at, opportunity_id, policy_version)
     VALUES (platform.current_country(), $1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10)
     RETURNING id`,
    [brief.brief_id, brief.brief_version, brief.topic_id, brief.market, brief.locale,
     JSON.stringify(brief), brief.valid_from, brief.expires_at, opportunityId, brief.policy_version],
  );
  return { id: row!.id };
}

/**
 * Approve an exact brief revision (spec POST /v1/briefs/{id}:approve). Atomically supersedes any currently
 * APPROVED brief for the same (market, locale, topic) scope, then marks this one APPROVED — so the active
 * pointer is replaced, never duplicated (the partial unique index guarantees it).
 */
export async function approveBrief(sql: Sql, briefId: string, briefVersion: number, approverId: string): Promise<{ approved: boolean }> {
  const [target] = await sql.query<{ market: string; locale: string; topic_id: string; status: string }>(
    "SELECT market, locale, topic_id, status FROM trend.growth_brief WHERE brief_id = $1 AND brief_version = $2",
    [briefId, briefVersion],
  );
  if (!target) return { approved: false };
  await sql.query(
    `UPDATE trend.growth_brief SET status = 'SUPERSEDED'
       WHERE status = 'APPROVED' AND market = $1 AND locale = $2 AND topic_id = $3`,
    [target.market, target.locale, target.topic_id],
  );
  await sql.query(
    "UPDATE trend.growth_brief SET status = 'APPROVED', approved_by = $3, approved_at = now() WHERE brief_id = $1 AND brief_version = $2",
    [briefId, briefVersion, approverId],
  );
  return { approved: true };
}

/**
 * Resolve the one approved, fresh brief that steers an agent for a scope (spec GET /v1/briefs:effective). Returns
 * the brief payload only when it is APPROVED, time-valid at `now`, and permits `channel`; otherwise null (the
 * agent falls back to its baseline behaviour). Expiry is enforced here on every lookup.
 */
export async function effectiveBrief(
  sql: Sql,
  scope: { market: string; locale: string; topic_id: string; channel: string; now?: Date },
): Promise<GrowthBriefV1 | null> {
  const now = (scope.now ?? new Date()).toISOString();
  const [row] = await sql.query<{ payload: GrowthBriefV1 }>(
    `SELECT payload FROM trend.growth_brief
       WHERE status = 'APPROVED' AND market = $1 AND locale = $2 AND topic_id = $3
         AND valid_from <= $4 AND expires_at > $4
         AND payload -> 'allowed_channels' ? $5
       LIMIT 1`,
    [scope.market, scope.locale, scope.topic_id, now, scope.channel],
  );
  return row?.payload ?? null;
}
