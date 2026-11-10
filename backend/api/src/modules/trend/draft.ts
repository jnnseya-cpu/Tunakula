/**
 * Trend Intelligence — deterministic channel drafts steered by the Growth Brief (spec §2 "Generate actions",
 * §7). This is the template path that keeps the workflow available with no AI model: given the effective brief
 * for a channel, it produces a typed draft whose audience, intent, CTA and claims come from the brief, and which
 * provably excludes every prohibited claim. With no effective brief it falls back to a baseline template and
 * flags the degraded mode. An existing agent can render or enrich these drafts; it gains no new authority.
 */
import type { BriefChannel, GrowthBriefV1 } from "./brief.ts";

export interface ChannelDraft {
  readonly channel: BriefChannel;
  readonly topic_id: string | null;
  readonly title: string;
  readonly body: string;
  readonly cta_id: string | null;
  readonly claims_used: readonly string[];
  readonly objective: string | null;
  /** true when no brief steered this draft (baseline template) or AI was unavailable — surfaced in outputs (spec §2). */
  readonly degraded: boolean;
}

/** A tiny baseline for a channel when no brief is effective — a template, honestly flagged degraded. */
export function baselineDraft(channel: BriefChannel, topicId: string | null): ChannelDraft {
  return {
    channel, topic_id: topicId,
    title: topicId ? `About ${humanize(topicId)}` : "Latest update",
    body: "Baseline content. No active Growth Brief is steering this channel, so this is a template placeholder.",
    cta_id: null, claims_used: [], objective: null, degraded: true,
  };
}

/**
 * Produce a channel draft steered by `brief`. Deterministic: the copy is assembled from the brief's own fields,
 * never invented, and `assertNoProhibited` guarantees no prohibited claim text leaks into the output (defence in
 * depth over the approval gate). `channel` must be one the brief allows — callers check permitsChannel first.
 */
export function draftFromBrief(brief: GrowthBriefV1, channel: BriefChannel): ChannelDraft {
  const title = channel === "seo"
    ? `${humanize(brief.topic_id)} — for ${brief.audience}`
    : `${humanize(brief.topic_id)}`;
  const body = [
    `For: ${brief.audience}.`,
    `Intent: ${brief.intent}.`,
    `Goal: ${brief.objective}.`,
  ].join(" ");
  const draft: ChannelDraft = {
    channel, topic_id: brief.topic_id, title, body,
    cta_id: brief.cta_id, claims_used: [...brief.approved_claim_ids], objective: brief.objective, degraded: false,
  };
  assertNoProhibited(draft, brief);
  return draft;
}

/** Throws if any prohibited claim phrase appears in the draft's visible text (spec §7/§8 claim safety). */
export function assertNoProhibited(draft: ChannelDraft, brief: GrowthBriefV1): void {
  const haystack = `${draft.title}\n${draft.body}`.toLowerCase();
  for (const phrase of brief.prohibited_claims) {
    if (phrase && haystack.includes(phrase.toLowerCase())) {
      throw new Error(`draft contains a prohibited claim: ${phrase}`);
    }
  }
}

/** topic_id (a slug) → readable phrase, e.g. "simpler-team-onboarding" → "simpler team onboarding". */
function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, " ").trim();
}
