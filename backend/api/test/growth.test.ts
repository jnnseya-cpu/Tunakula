/**
 * The deterministic growth brain: it reads lifecycle from recency/frequency, suggests a next best action, and
 * ranks candidate recommendations (your dishes first, then kitchen picks, then market-popular), deduping items.
 * No DB, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GrowthSignals, RecommendationCandidate } from "@tunakula/ts-contracts";
import { SandboxGrowthBrain } from "../src/modules/growth/sandbox-growth-brain.ts";

const brain = new SandboxGrowthBrain();
const sig = (over: Partial<GrowthSignals> = {}): GrowthSignals => ({ orderCount: 5, lastOrderDaysAgo: 3, distinctItems: 7, avgBasket: { currency: "USD", minor: "2000" }, ...over });

test("classifies the lifecycle from recency and frequency", () => {
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: null, orderCount: 0 })).segment, "NEW");
  assert.equal(brain.assess(sig({ orderCount: 1, lastOrderDaysAgo: 2 })).segment, "NEW");
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: 5 })).segment, "ACTIVE");
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: 20 })).segment, "AT_RISK");
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: 45 })).segment, "LAPSED");
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: 200 })).segment, "DORMANT");
});

test("recommends for the active, reminds the at-risk, wins back the lapsed with a capped suggested credit", () => {
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: 5 })).action.type, "RECOMMEND");
  assert.equal(brain.assess(sig({ lastOrderDaysAgo: 20 })).action.type, "REMIND");
  const win = brain.assess(sig({ lastOrderDaysAgo: 60, avgBasket: { currency: "USD", minor: "2000" } }));
  assert.equal(win.action.type, "WIN_BACK");
  // 20% of a $20 average basket = $4.00.
  assert.equal(win.action.suggestedCredit?.minor, "400");
  assert.equal(win.action.suggestedCredit?.currency, "USD");
});

test("ranks your own dishes above kitchen picks above market-popular, and dedupes by item", () => {
  const c: RecommendationCandidate[] = [
    { itemId: "a", name: "Moambe", branchId: "b1", reason: "POPULAR", weight: 99 },
    { itemId: "a", name: "Moambe", branchId: "b1", reason: "ORDER_AGAIN", weight: 4 },
    { itemId: "b", name: "Pondu", branchId: "b1", reason: "KITCHEN_PICK", weight: 1 },
    { itemId: "c", name: "Brochettes", branchId: "b2", reason: "POPULAR", weight: 50 },
  ];
  const picks = brain.rank(c, sig(), 8);
  assert.equal(picks.length, 3, "item a deduped to one pick");
  assert.equal(picks[0]?.itemId, "a");
  assert.equal(picks[0]?.reason, "ORDER_AGAIN", "the stronger reason for a wins over its POPULAR duplicate");
  assert.equal(picks[1]?.reason, "KITCHEN_PICK");
  assert.equal(picks[2]?.reason, "POPULAR");
  assert.deepEqual(picks.map((p) => p.rank), [1, 2, 3]);
});

test("respects the limit", () => {
  const many: RecommendationCandidate[] = Array.from({ length: 20 }, (_, i) => ({ itemId: `i${i}`, name: `x${i}`, branchId: "b", reason: "POPULAR", weight: i }));
  assert.equal(brain.rank(many, sig(), 5).length, 5);
});
