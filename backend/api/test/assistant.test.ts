/**
 * The deterministic assistant brain: it classifies grounded intents, answers from the order and the policy
 * corpus, cites the policy, and escalates whenever it is unsure or a human judgement is needed. No DB, no
 * network — this is the certification of the brain itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantContext, OrderFacts } from "@tunakula/ts-contracts";
import { SandboxBrain } from "../src/modules/assistant/sandbox-brain.ts";
import { KNOWLEDGE } from "../src/modules/assistant/knowledge.ts";

const brain = new SandboxBrain();
const ctx = (over: Partial<AssistantContext> = {}): AssistantContext => ({ lang: "en", knowledge: KNOWLEDGE, order: null, ...over });
const order = (over: Partial<OrderFacts> = {}): OrderFacts => ({
  orderId: "o1", state: "PREPARING", type: "DELIVERY", total: { currency: "USD", minor: "2420" },
  serviceCharge: { currency: "USD", minor: "200" }, deliveryFee: { currency: "USD", minor: "220" },
  branchName: "Chez Maman", refundInFlight: false, ...over,
});

test("explains the service charge and cites the pricing policy", () => {
  const r = brain.reply("why is there a service charge, this seems expensive", ctx());
  assert.equal(r.intent, "EXPLAIN_CHARGE");
  assert.ok(r.answer.includes("0%") || r.answer.toLowerCase().includes("commission"));
  assert.equal(r.citations[0]?.policySlug, "pricing");
  assert.equal(r.escalate, false);
  assert.ok(r.confidence >= 0.45);
});

test("uses the order's real amounts when explaining a charge", () => {
  const r = brain.reply("what is this fee on my order", ctx({ order: order() }));
  assert.equal(r.intent, "EXPLAIN_CHARGE");
  assert.ok(r.answer.includes("2.00 USD"), "quotes the actual service charge");
  assert.ok(r.answer.includes("24.20 USD"), "quotes the actual total");
});

test("reads order status from grounded facts, not a guess", () => {
  const r = brain.reply("where is my order?", ctx({ order: order({ state: "PICKED_UP" }) }));
  assert.equal(r.intent, "ORDER_STATUS");
  assert.ok(r.answer.toLowerCase().includes("on its way"));
  assert.ok(r.answer.includes("Chez Maman"));
  assert.equal(r.escalate, false);
});

test("reassures on an order that already refunds automatically — no human needed", () => {
  const r = brain.reply("my order never arrived, I want my money back", ctx({ order: order({ state: "DELIVERY_FAILED", refundInFlight: true }) }));
  assert.equal(r.intent, "REFUND_OR_PROBLEM");
  assert.equal(r.escalate, false, "an automatic refund does not need a human");
  assert.ok(r.answer.toLowerCase().includes("automatically"));
  assert.equal(r.citations[0]?.policySlug, "refunds");
});

test("escalates a discretionary refund instead of deciding it", () => {
  const r = brain.reply("the food was cold and I want a refund", ctx({ order: order({ state: "DELIVERED", refundInFlight: false }) }));
  assert.equal(r.intent, "REFUND_OR_PROBLEM");
  assert.equal(r.escalate, true, "a judgement-call refund goes to a human");
  assert.equal(r.action.type, "ESCALATE");
});

test("escalates immediately when the customer asks for a human", () => {
  const r = brain.reply("I want to speak to a person, this is a complaint", ctx());
  assert.equal(r.escalate, true);
});

test("escalates the unknown rather than guessing", () => {
  const r = brain.reply("asdfjkl zxcvbnm qwerty", ctx());
  assert.equal(r.intent, "UNKNOWN");
  assert.equal(r.escalate, true);
  assert.ok(r.confidence < 0.45);
});

test("answers Book-a-chef questions with the chef-terms policy", () => {
  const r = brain.reply("how do I book a chef for a private dinner?", ctx());
  assert.equal(r.intent, "CHEF_BOOKING");
  assert.equal(r.citations[0]?.policySlug, "chef-terms");
});

test("answers in French when asked in French", () => {
  const r = brain.reply("pourquoi ces frais de service ?", ctx({ lang: "fr" }));
  assert.equal(r.intent, "EXPLAIN_CHARGE");
  assert.ok(r.answer.includes("commission") || r.answer.includes("frais de service"));
});

test("Lingála and Swahili fall back to French, the market default", () => {
  const r = brain.reply("mbote, pourquoi ces frais", ctx({ lang: "ln" }));
  assert.ok(r.answer.includes("frais") || r.answer.includes("commission"));
});
