/**
 * The deterministic rider copilot brain: where orders are now, how the day is going, and cash-out clarity —
 * and never any pressure to accept jobs. No DB, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiderFacts } from "@tunakula/ts-contracts";
import { SandboxRiderBrain } from "../src/modules/rider/sandbox-rider-brain.ts";

const brain = new SandboxRiderBrain();
const usd = (minor: string) => ({ currency: "USD", minor });
const facts = (over: Partial<RiderFacts> = {}): RiderFacts => ({
  riderName: "",
  earnings: { today: usd("1200"), week: usd("6400"), jobsToday: 4, jobsWeek: 22, tipsWeek: usd("900"), avgPerJob: usd("290"), bestHours: [20, 12] },
  zones: [{ zone: "Gombe", level: "HOT", waiting: 5 }, { zone: "Limete", level: "STEADY", waiting: 1 }],
  payout: { pending: usd("3100") },
  ...over,
});

test("points to the hot zone first, as an action", () => {
  const ins = brain.insights(facts(), "en");
  assert.equal(ins[0]!.id, "zones-hot");
  assert.equal(ins[0]!.category, "ZONES");
  assert.equal(ins[0]!.tone, "ACTION");
  assert.match(ins[0]!.detail, /Gombe/);
});

test("celebrates the day's earnings with real numbers", () => {
  const e = brain.insights(facts(), "en").find((i) => i.id === "earn-today");
  assert.ok(e);
  assert.equal(e!.tone, "CHEER");
  assert.match(e!.detail, /12\.00 USD/);
  assert.match(e!.detail, /4 job/);
});

test("surfaces best earning hours", () => {
  assert.match(brain.insights(facts(), "en").find((i) => i.id === "earn-hours")!.detail, /20:00/);
});

test("explains instant cash-out, never a schedule", () => {
  const p = brain.insights(facts(), "en").find((i) => i.id === "payout-ready");
  assert.ok(p);
  assert.match(p!.detail, /cash out whenever/i);
  assert.match(p!.detail, /31\.00 USD/);
});

test("never pressures a rider to accept jobs, even when quiet", () => {
  const ins = brain.insights(facts({ zones: [{ zone: "Gombe", level: "QUIET" }], earnings: { today: usd("0"), week: usd("0"), jobsToday: 0, jobsWeek: 0 }, payout: { pending: usd("0") } }), "en");
  const text = ins.map((i) => `${i.title} ${i.detail}`).join(" ").toLowerCase();
  assert.ok(!/accept more|should accept|accept the/.test(text), "no nudge to accept jobs");
  assert.match(ins.find((i) => i.id === "zones-quiet")!.detail, /never lose jobs/i);
});

test("answers in French", () => {
  assert.match(brain.insights(facts(), "fr")[0]!.detail, /Gombe/);
  assert.match(brain.insights(facts(), "fr").find((i) => i.id === "earn-today")!.detail, /gagné/);
});
