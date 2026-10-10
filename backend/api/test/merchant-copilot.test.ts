/**
 * The deterministic merchant copilot brain: it turns a branch's grounded facts into ranked insights, phrasing
 * numbers it is given and never inventing them. No DB, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BranchFacts } from "@tunakula/ts-contracts";
import { SandboxMerchantBrain } from "../src/modules/merchant/sandbox-merchant-brain.ts";

const brain = new SandboxMerchantBrain();
const facts = (over: Partial<BranchFacts> = {}): BranchFacts => ({
  branchName: "Chez Maman Gombe",
  menu: { total: 10, available: 9, unavailable: 1, missingSecondLanguage: 4, missingDescription: 6, missingCategory: 0, missingPhoto: 7, recommended: 2 },
  demand: { orders30d: 120, busiestHour: 20, busiestWeekday: 5, topDishes: [{ name: "Moambe", quantity: 40 }], slowDishes: [{ name: "Tilapia", quantity: 0 }] },
  performance: { acceptanceRate: 0.8, fulfilmentRate: 0.9, avgPrepMinutes: 32 },
  reviews: { count: 25, average: 3.6, recentLow: 3 },
  ...over,
});

test("surfaces menu gaps with the exact counts it was given", () => {
  const ins = brain.insights(facts(), "en");
  const photo = ins.find((i) => i.id === "menu-photo");
  assert.ok(photo, "a photo insight is produced");
  assert.equal(photo!.metric, "7");
  assert.match(photo!.detail, /7 dish/);
  assert.ok(ins.find((i) => i.id === "menu-lang"));
  assert.ok(ins.find((i) => i.id === "menu-desc"));
});

test("reads demand: busy time, top sellers, slow movers", () => {
  const ins = brain.insights(facts(), "en");
  const peak = ins.find((i) => i.id === "demand-peak");
  assert.ok(peak);
  assert.match(peak!.detail, /Friday/);
  assert.match(peak!.detail, /20:00/);
  assert.match(ins.find((i) => i.id === "demand-top")!.detail, /Moambe/);
  assert.ok(ins.find((i) => i.id === "demand-slow"));
});

test("flags weak performance as warnings, and ranks warnings first", () => {
  const ins = brain.insights(facts(), "en");
  const accept = ins.find((i) => i.id === "perf-accept");
  assert.ok(accept);
  assert.equal(accept!.severity, "WARNING");
  assert.equal(accept!.metric, "80%");
  // Warnings sort ahead of suggestions/info.
  assert.equal(ins[0]!.severity, "WARNING");
});

test("flags a slipping rating and nudges review replies", () => {
  const ins = brain.insights(facts(), "en");
  assert.equal(ins.find((i) => i.id === "rev-low")!.metric, "3.6/5");
  assert.equal(ins.find((i) => i.id === "rev-reply")!.metric, "3");
});

test("a complete, healthy branch produces no warnings", () => {
  const ins = brain.insights(facts({
    menu: { total: 10, available: 10, unavailable: 0, missingSecondLanguage: 0, missingDescription: 0, missingCategory: 0, missingPhoto: 0, recommended: 3 },
    performance: { acceptanceRate: 0.98, fulfilmentRate: 0.99, avgPrepMinutes: 18 },
    reviews: { count: 25, average: 4.7, recentLow: 0 },
  }), "en");
  assert.equal(ins.filter((i) => i.severity === "WARNING").length, 0);
});

test("answers in French", () => {
  const ins = brain.insights(facts(), "fr");
  assert.match(ins.find((i) => i.id === "demand-peak")!.detail, /vendredi/);
});
