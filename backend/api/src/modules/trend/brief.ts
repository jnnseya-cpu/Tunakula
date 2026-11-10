/**
 * Trend Intelligence — the Growth Brief v1 contract (spec §6 and Appendix A) and its runtime validation.
 *
 * The Growth Brief is the versioned, time-limited control payload the engine issues to existing agents (in
 * Tunakula: the growth agent, merchant copilot, site-content/SEO and the marketing copywriters). Agents treat
 * it as a CLOSED object (additionalProperties: false) and resolve it at run time; they never gain new authority
 * from it. This module validates the shape AND the rules that JSON Schema alone cannot express (§507):
 * valid_from < expires_at, valid_from ≤ now < expires_at, and channel membership. Tenant-scoped checks
 * (evidence/claims/market/locale resolve to the installation) belong to the service layer, not here.
 */

/** Allowed brief channels (spec Appendix A enum). Only seo + organic_social have draft routes in v1; the rest
 *  reserve stable routing values for future adapters and enable nothing on their own (spec §507). */
export const BRIEF_CHANNELS = ["seo", "organic_social", "sales_enablement", "owned_placement", "lifecycle", "paid"] as const;
export type BriefChannel = (typeof BRIEF_CHANNELS)[number];

export interface GrowthBriefV1 {
  readonly schema_version: 1;
  readonly brief_id: string;
  readonly brief_version: number;
  readonly tenant_id: string;
  readonly platform_id: string;
  readonly market: string;   // ISO alpha-2, or ZZ for explicitly global
  readonly locale: string;
  readonly topic_id: string;
  readonly opportunity_score: number;
  readonly confidence: number;
  readonly valid_from: string;  // RFC3339 UTC, ends in Z
  readonly expires_at: string;  // RFC3339 UTC, ends in Z
  readonly evidence_ids: readonly string[];
  readonly audience: string;
  readonly intent: string;
  readonly approved_claim_ids: readonly string[];
  readonly cta_id: string;
  readonly allowed_channels: readonly BriefChannel[];
  readonly prohibited_claims: readonly string[];
  readonly objective: string;
  readonly experiment_id: string;
  readonly policy_version: number;
}

/** The exact set of keys a brief may carry; anything else is rejected (closed object, spec §6/Appendix A). */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "schema_version", "brief_id", "brief_version", "tenant_id", "platform_id", "market", "locale", "topic_id",
  "opportunity_score", "confidence", "valid_from", "expires_at", "evidence_ids", "audience", "intent",
  "approved_claim_ids", "cta_id", "allowed_channels", "prohibited_claims", "objective", "experiment_id", "policy_version",
]);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;         // $defs/id
const MARKET_RE = /^[A-Z]{2}$/;                              // ISO alpha-2 (ZZ allowed, never matches a country lookup)
const UTC_RE = /Z$/;                                         // $defs/utc also requires date-time; checked via Date parse

export interface BriefError { readonly field: string; readonly message: string }

function isId(v: unknown): v is string { return typeof v === "string" && ID_RE.test(v); }
function isScore(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100; }
function isShortText(v: unknown): v is string { return typeof v === "string" && v.length >= 1 && v.length <= 500; }
function isUtc(v: unknown): v is string { return typeof v === "string" && UTC_RE.test(v) && !Number.isNaN(Date.parse(v)); }
function isPosInt(v: unknown): v is number { return typeof v === "number" && Number.isInteger(v) && v >= 1; }

function idList(v: unknown, field: string, minItems: number, maxItems: number, errs: BriefError[]): void {
  if (!Array.isArray(v)) { errs.push({ field, message: "must be an array" }); return; }
  if (v.length < minItems) errs.push({ field, message: `needs at least ${minItems}` });
  if (v.length > maxItems) errs.push({ field, message: `at most ${maxItems}` });
  if (new Set(v).size !== v.length) errs.push({ field, message: "must be unique" });
  if (!v.every(isId)) errs.push({ field, message: "every item must be a valid id" });
}

/**
 * Validate a candidate brief's SHAPE against the v1 schema (closed object). Returns every error found, so a
 * caller can reject a malformed payload atomically. Does NOT check temporal validity — use isActiveAt for that.
 */
export function validateBriefShape(input: unknown): { ok: boolean; errors: BriefError[] } {
  const e: BriefError[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "", message: "brief must be an object" }] };
  }
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k)) e.push({ field: k, message: "unknown field" });

  if (o.schema_version !== 1) e.push({ field: "schema_version", message: "must be 1" });
  if (!isId(o.brief_id)) e.push({ field: "brief_id", message: "invalid id" });
  if (!isPosInt(o.brief_version)) e.push({ field: "brief_version", message: "integer ≥ 1" });
  if (!isId(o.tenant_id)) e.push({ field: "tenant_id", message: "invalid id" });
  if (!isId(o.platform_id)) e.push({ field: "platform_id", message: "invalid id" });
  if (typeof o.market !== "string" || !MARKET_RE.test(o.market)) e.push({ field: "market", message: "ISO alpha-2 (A–Z x2)" });
  if (typeof o.locale !== "string" || o.locale.length < 2 || o.locale.length > 35) e.push({ field: "locale", message: "2–35 chars" });
  if (!isId(o.topic_id)) e.push({ field: "topic_id", message: "invalid id" });
  if (!isScore(o.opportunity_score)) e.push({ field: "opportunity_score", message: "number 0–100" });
  if (!isScore(o.confidence)) e.push({ field: "confidence", message: "number 0–100" });
  if (!isUtc(o.valid_from)) e.push({ field: "valid_from", message: "RFC3339 UTC ending in Z" });
  if (!isUtc(o.expires_at)) e.push({ field: "expires_at", message: "RFC3339 UTC ending in Z" });
  idList(o.evidence_ids, "evidence_ids", 1, 64, e);
  if (!isShortText(o.audience)) e.push({ field: "audience", message: "1–500 chars" });
  if (!isShortText(o.intent)) e.push({ field: "intent", message: "1–500 chars" });
  idList(o.approved_claim_ids, "approved_claim_ids", 0, 64, e);
  if (!isId(o.cta_id)) e.push({ field: "cta_id", message: "invalid id" });

  if (!Array.isArray(o.allowed_channels)) {
    e.push({ field: "allowed_channels", message: "must be an array" });
  } else {
    const ch = o.allowed_channels;
    if (ch.length < 1 || ch.length > 6) e.push({ field: "allowed_channels", message: "1–6 items" });
    if (new Set(ch).size !== ch.length) e.push({ field: "allowed_channels", message: "must be unique" });
    if (!ch.every((c) => (BRIEF_CHANNELS as readonly string[]).includes(c as string))) e.push({ field: "allowed_channels", message: "unknown channel" });
  }

  if (!Array.isArray(o.prohibited_claims)) {
    e.push({ field: "prohibited_claims", message: "must be an array" });
  } else {
    if (o.prohibited_claims.length > 32) e.push({ field: "prohibited_claims", message: "at most 32" });
    if (new Set(o.prohibited_claims).size !== o.prohibited_claims.length) e.push({ field: "prohibited_claims", message: "must be unique" });
    if (!o.prohibited_claims.every(isShortText)) e.push({ field: "prohibited_claims", message: "each 1–500 chars" });
  }
  if (!isShortText(o.objective)) e.push({ field: "objective", message: "1–500 chars" });
  if (!isId(o.experiment_id)) e.push({ field: "experiment_id", message: "invalid id" });
  if (!isPosInt(o.policy_version)) e.push({ field: "policy_version", message: "integer ≥ 1" });

  // Cross-field temporal sanity that is still pure shape (spec §507): valid_from < expires_at.
  if (isUtc(o.valid_from) && isUtc(o.expires_at) && Date.parse(o.valid_from as string) >= Date.parse(o.expires_at as string)) {
    e.push({ field: "expires_at", message: "must be after valid_from" });
  }
  return { ok: e.length === 0, errors: e };
}

/** A brief is active at `now` when valid_from ≤ now < expires_at (spec §507). Assumes shape already validated. */
export function isActiveAt(brief: GrowthBriefV1, now: Date = new Date()): boolean {
  const from = Date.parse(brief.valid_from);
  const until = Date.parse(brief.expires_at);
  const t = now.getTime();
  return from < until && from <= t && t < until;
}

/** Does this brief permit the given channel? Agents must check membership before drafting (spec §507). */
export function permitsChannel(brief: GrowthBriefV1, channel: string): channel is BriefChannel {
  return (brief.allowed_channels as readonly string[]).includes(channel);
}
