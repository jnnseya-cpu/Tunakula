/**
 * Trend Intelligence deterministic channel drafts (spec §2 "Generate actions", §7). Pure, no database.
 * A brief steers the draft (audience/intent/CTA/claims) and prohibited claims never leak; with no brief the
 * draft is an honestly-flagged baseline template.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoProhibited, baselineDraft, draftFromBrief } from "../src/modules/trend/draft.ts";
import type { GrowthBriefV1 } from "../src/modules/trend/brief.ts";

const BRIEF: GrowthBriefV1 = {
  schema_version: 1, brief_id: "gb_1", brief_version: 1, tenant_id: "t", platform_id: "tunakula", market: "CA",
  locale: "en-CA", topic_id: "simpler-team-onboarding", opportunity_score: 86.25, confidence: 83.5,
  valid_from: "2026-11-10T10:00:00Z", expires_at: "2026-11-17T10:00:00Z", evidence_ids: ["ev_1"],
  audience: "Small teams comparing onboarding options", intent: "evaluate how to onboard a small team",
  approved_claim_ids: ["claim_onboarding_01"], cta_id: "cta_view_onboarding_guide",
  allowed_channels: ["seo", "organic_social"], prohibited_claims: ["guaranteed onboarding time"],
  objective: "qualified trial starts per eligible session", experiment_id: "exp_1", policy_version: 1,
};

test("a brief steers the draft — audience, intent, CTA and approved claims come from the brief", () => {
  const d = draftFromBrief(BRIEF, "seo");
  assert.equal(d.degraded, false);
  assert.equal(d.topic_id, "simpler-team-onboarding");
  assert.equal(d.cta_id, "cta_view_onboarding_guide");
  assert.deepEqual(d.claims_used, ["claim_onboarding_01"]);
  assert.match(d.title, /simpler team onboarding/i);
  assert.match(d.body, /Small teams comparing onboarding options/);
  assert.match(d.body, /qualified trial starts/);
});

test("baseline draft (no brief) is a template, flagged degraded, with no CTA or claims", () => {
  const d = baselineDraft("organic_social", "poulet-braise");
  assert.equal(d.degraded, true);
  assert.equal(d.cta_id, null);
  assert.deepEqual(d.claims_used, []);
});

test("a prohibited claim appearing in the draft text is rejected (claim safety)", () => {
  const sneaky = { ...draftFromBrief(BRIEF, "seo"), body: "We promise a guaranteed onboarding time for everyone." };
  assert.throws(() => assertNoProhibited(sneaky, BRIEF), /prohibited claim/);
  // The honest draft carries no prohibited phrase.
  assert.doesNotThrow(() => assertNoProhibited(draftFromBrief(BRIEF, "seo"), BRIEF));
});
