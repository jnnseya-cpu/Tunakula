/**
 * Trend Intelligence deterministic core — scoring (spec §5/§17) and the Growth Brief v1 contract (§6/Appendix A).
 * Pure, no database. Covers conformance scenario TI-03 (the worked example returns exactly 86.25 / 83.5, unrounded
 * before the decision) and the shape/temporal rules a closed brief must satisfy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confidence, corroborationFor, decide, demandFromZ, hasVeto, logLift, mad, median,
  opportunityScore, passesCountGate, robustZ, round2,
} from "../src/modules/trend/scoring.ts";
import { isActiveAt, permitsChannel, validateBriefShape, type GrowthBriefV1 } from "../src/modules/trend/brief.ts";

test("TI-03: the worked example scores exactly 86.25 opportunity and 83.5 confidence, unrounded", () => {
  const score = opportunityScore({ demand: 80, fit: 95, intent: 85, timing: 90, readiness: 80 });
  assert.equal(score, 86.25);
  const conf = confidence({ sourceQuality: 90, corroboration: 80, coverage: 70, freshness: 90 }, 2);
  assert.equal(conf, 83.5);
  // The decision uses the full-precision values; result is a reviewable brief.
  assert.equal(decide(score, conf), "BRIEF");
});

test("per-source movement: log lift and robust z match the spec formulas", () => {
  assert.equal(logLift(0, 0), 0);
  assert.ok(Math.abs(logLift(20, 4) - Math.log(21 / 5)) < 1e-12);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(mad([2, 2, 2]), 0);
  // zero-variance history is floored by 0.2, not division by zero
  assert.ok(Number.isFinite(robustZ(30, [2, 2, 2, 2])));
});

test("count-feed gate needs c≥20 and z≥2; z maps to a 0–100 demand score", () => {
  assert.equal(passesCountGate(20, 2), true);
  assert.equal(passesCountGate(19, 5), false);
  assert.equal(passesCountGate(100, 1.9), false);
  assert.equal(demandFromZ(3), 80);     // clamp(50 + 30)
  assert.equal(demandFromZ(10), 100);   // clamped
  assert.equal(demandFromZ(-10), 0);    // clamped
});

test("confidence caps a single uncorroborated source family at 69", () => {
  const i = { sourceQuality: 100, corroboration: 0, coverage: 100, freshness: 100 };
  assert.equal(confidence(i, 1), 69, "one family is capped");
  assert.ok(confidence(i, 2) > 69, "two families lift the cap");
  assert.equal(corroborationFor(1), 0);
  assert.equal(corroborationFor(2), 80);
  assert.equal(corroborationFor(5), 100);
});

test("decision bands and vetoes (spec §5 table)", () => {
  assert.equal(decide(59, 90), "ARCHIVE");
  assert.equal(decide(90, 54), "ARCHIVE");
  assert.equal(decide(70, 70), "WATCH");
  assert.equal(decide(80, 80), "BRIEF");
  assert.equal(decide(90, 90, { autoOptIn: true }), "AUTO_ELIGIBLE");
  assert.equal(decide(90, 90), "BRIEF", "no opt-in stays at BRIEF");
  assert.equal(decide(90, 90, { autoOptIn: true, veto: true }), "WATCH", "a veto never rises above WATCH");
  // missing readiness is itself a veto
  assert.equal(hasVeto({}, 0), true);
  assert.equal(hasVeto({ outOfMarket: true }, 50), true);
  assert.equal(hasVeto({}, 50), false);
  assert.equal(round2(86.254), 86.25);
});

// The canonical positive fixture from spec §6.
const FIXTURE: GrowthBriefV1 = {
  schema_version: 1, brief_id: "gb_104", brief_version: 3, tenant_id: "tenant_demo", platform_id: "fixture_platform_a",
  market: "CA", locale: "en-CA", topic_id: "simpler-team-onboarding", opportunity_score: 86.25, confidence: 83.5,
  valid_from: "2026-11-10T10:00:00Z", expires_at: "2026-11-17T10:00:00Z", evidence_ids: ["ev_341", "ev_342"],
  audience: "Small teams comparing onboarding options", intent: "evaluate how to onboard a small team",
  approved_claim_ids: ["claim_onboarding_01"], cta_id: "cta_view_onboarding_guide",
  allowed_channels: ["seo", "organic_social"], prohibited_claims: ["guaranteed onboarding time", "unsupported third-party endorsements"],
  objective: "qualified trial starts per eligible session", experiment_id: "exp_91", policy_version: 5,
};

test("the §6 canonical fixture validates as a closed Growth Brief v1", () => {
  const r = validateBriefShape(FIXTURE);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test("a brief with an unknown extra field is rejected (closed object)", () => {
  const r = validateBriefShape({ ...FIXTURE, sneaky: "x" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === "sneaky"));
});

test("shape rejects bad market, score out of range, empty evidence, bad channel, and expiry ≤ valid_from", () => {
  assert.equal(validateBriefShape({ ...FIXTURE, market: "CAN" }).ok, false);
  assert.equal(validateBriefShape({ ...FIXTURE, opportunity_score: 101 }).ok, false);
  assert.equal(validateBriefShape({ ...FIXTURE, evidence_ids: [] }).ok, false);
  assert.equal(validateBriefShape({ ...FIXTURE, allowed_channels: ["telepathy"] }).ok, false);
  assert.equal(validateBriefShape({ ...FIXTURE, expires_at: FIXTURE.valid_from }).ok, false);
});

test("temporal activeness and channel membership (spec §507)", () => {
  const during = new Date("2026-11-12T00:00:00Z");
  const before = new Date("2026-11-09T00:00:00Z");
  const after = new Date("2026-11-18T00:00:00Z");
  assert.equal(isActiveAt(FIXTURE, during), true);
  assert.equal(isActiveAt(FIXTURE, before), false);
  assert.equal(isActiveAt(FIXTURE, after), false);
  assert.equal(permitsChannel(FIXTURE, "seo"), true);
  assert.equal(permitsChannel(FIXTURE, "paid"), false);
});
