/**
 * Trend Intelligence — deterministic detection & scoring (spec §5, §17).
 *
 * Pure, model-free math: per-source movement (log lift + robust z), the 0–100 opportunity score and the
 * independent 0–100 confidence, plus the decision band. No AI is required for any of this — it is the
 * deterministic core the whole workflow stands on, so an inference outage never blocks detection or scoring
 * (spec §2 "Deterministic" path). Keep full precision; round only for display.
 *
 * Tenancy note: this module is pure arithmetic and holds no tenant data. In Tunakula the tenant boundary is the
 * country (country_iso2 + FORCE RLS), which the persistence/service layer carries — not this file.
 */

/** Natural-log lift of a comparable current count `c` over a baseline median `b`. spec §5.3 */
export function logLift(c: number, b: number): number {
  return Math.log((c + 1) / (b + 1));
}

/** median of a numeric array (no mutation of the input). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, z) => a - z);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median absolute deviation about the median. spec §5.3 uses MAD(log1p(x)). */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Robust anomaly score of the current count against historical counts (spec §5.3):
 *   z = (log1p(c) − median(log1p(x))) / max(1.4826 × MAD(log1p(x)), 0.2)
 * The 1.4826 scales MAD to a σ estimate for normal data; the 0.2 floor stops a zero-variance history from
 * exploding the score.
 */
export function robustZ(c: number, history: readonly number[]): number {
  const lx = history.map((x) => Math.log1p(x));
  const denom = Math.max(1.4826 * mad(lx), 0.2);
  return (Math.log1p(c) - median(lx)) / denom;
}

/** A count-feed signal passes the detection gate when c ≥ cMin and z ≥ zMin (spec §5.3, defaults c≥20, z≥2). */
export function passesCountGate(c: number, z: number, cMin = 20, zMin = 2): boolean {
  return c >= cMin && z >= zMin;
}

/** Reference monotone mapping from a count-feed z to a 0–100 demand score (spec §17): clamp(50 + 10z, 0, 100). */
export function demandFromZ(z: number): number {
  return clamp(50 + 10 * z, 0, 100);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** The five 0–100 inputs to the opportunity score (spec §5.4). Missing readiness (0) blocks live activation. */
export interface OpportunityInputs {
  readonly demand: number;    // 25% — calibrated from source scores
  readonly fit: number;       // 25% — tenant product/category, geography, persona
  readonly intent: number;    // 20% — explicit behaviour + taxonomy
  readonly timing: number;    // 15% — remaining actionable window
  readonly readiness: number; // 15% — stock, partner coverage, capacity, approved assets
}

/** 0–100 opportunity score: 25% demand, 25% fit, 20% intent, 15% timing, 15% readiness (spec §5.4). */
export function opportunityScore(i: OpportunityInputs): number {
  return 0.25 * i.demand + 0.25 * i.fit + 0.2 * i.intent + 0.15 * i.timing + 0.15 * i.readiness;
}

/** The four 0–100 inputs to confidence (spec §5.5). Deliberately excludes model certainty. */
export interface ConfidenceInputs {
  readonly sourceQuality: number;  // 35% — mean configured quality of contributing families
  readonly corroboration: number;  // 25% — 0 one family, 80 two, 100 three+ (spec §17)
  readonly coverage: number;       // 20% — mean valid observed/expected window ratio × 100
  readonly freshness: number;      // 20% — per-family 100 at window close → 0 at stale-after
}

/**
 * 0–100 confidence: 35% source quality, 25% corroboration, 20% coverage, 20% freshness (spec §5.5).
 * With only one independent source family the result is capped at 69 (spec §5.5), reflecting that a single
 * uncorroborated family cannot justify high confidence.
 */
export function confidence(i: ConfidenceInputs, independentFamilies: number): number {
  const raw = 0.35 * i.sourceQuality + 0.25 * i.corroboration + 0.2 * i.coverage + 0.2 * i.freshness;
  return independentFamilies <= 1 ? Math.min(raw, 69) : raw;
}

/** Corroboration score from the count of independent source families (spec §17). */
export function corroborationFor(independentFamilies: number): number {
  if (independentFamilies >= 3) return 100;
  if (independentFamilies === 2) return 80;
  return 0;
}

/**
 * Hard vetoes that block live activation regardless of score (spec §5.4). `readiness` here is the same 0–100
 * readiness input: a 0 readiness is itself a veto ("missing readiness blocks activation").
 */
export interface Vetoes {
  readonly outOfMarket?: boolean;
  readonly unsupportedClaim?: boolean;
  readonly restrictedTopic?: boolean;
  readonly unavailableInventory?: boolean;
  readonly illegalTargeting?: boolean;
}

export function hasVeto(v: Vetoes, readiness: number): boolean {
  return readiness <= 0 || !!(v.outOfMarket || v.unsupportedClaim || v.restrictedTopic || v.unavailableInventory || v.illegalTargeting);
}

/** The decision band an opportunity falls into (spec §5 table). */
export type Band = "ARCHIVE" | "WATCH" | "BRIEF" | "AUTO_ELIGIBLE";

/**
 * Decide the band from score, confidence, veto and the tenant's opt-in for bounded automation (spec §5 table):
 *   score<60 OR conf<55                         → ARCHIVE
 *   both above archive, up to 74                 → WATCH (draft internally, no live change)
 *   score≥75 AND conf≥75, no veto                → BRIEF (reviewable brief)
 *   score≥85 AND conf≥85, opt-in, no veto        → AUTO_ELIGIBLE (bounded auto action, low-risk classes only)
 * A veto never lets a result rise above WATCH.
 */
export function decide(score: number, conf: number, opts: { veto?: boolean; autoOptIn?: boolean } = {}): Band {
  if (score < 60 || conf < 55) return "ARCHIVE";
  const veto = !!opts.veto;
  if (!veto && score >= 85 && conf >= 85 && opts.autoOptIn) return "AUTO_ELIGIBLE";
  if (!veto && score >= 75 && conf >= 75) return "BRIEF";
  return "WATCH";
}

/** Round to 2 decimals for display only (never before a decision). */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
