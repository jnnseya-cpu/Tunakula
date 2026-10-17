/**
 * The hosted-LLM assistant brain: it parses and grounds the model's reply, and falls back to the deterministic
 * brain on any failure. A fake transport stands in for the Anthropic API — no network, fully offline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantContext } from "@tunakula/ts-contracts";
import { LlmAssistantBrain, type LlmTransport, type LlmTransportResponse } from "../src/modules/assistant/llm-brain.ts";
import { SandboxBrain } from "../src/modules/assistant/sandbox-brain.ts";
import { KNOWLEDGE } from "../src/modules/assistant/knowledge.ts";

const ctx = (over: Partial<AssistantContext> = {}): AssistantContext => ({ lang: "en", knowledge: KNOWLEDGE, order: null, ...over });
const fallback = new SandboxBrain();
const modelSays = (obj: unknown): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] } } satisfies LlmTransportResponse);
const brain = (transport: LlmTransport) => new LlmAssistantBrain({ apiKey: "sk-test", model: "claude-opus-5-5", transport }, fallback);

test("uses the model's grounded answer and keeps only real policy citations", async () => {
  const b = brain(modelSays({ intent: "EXPLAIN_CHARGE", confidence: 0.9, answer: "The 10% service charge funds the platform.", citations: [{ title: "Pricing", policySlug: "pricing" }, { title: "Made up", policySlug: "not-a-real-policy" }], escalate: false }));
  const r = await b.reply("why the fee?", ctx());
  assert.equal(r.intent, "EXPLAIN_CHARGE");
  assert.match(r.answer, /10% service charge/);
  assert.equal(r.citations.length, 1, "the invented citation is dropped");
  assert.equal(r.citations[0]?.policySlug, "pricing");
  assert.equal(r.escalate, false);
});

test("clamps an out-of-range confidence and normalises an unknown intent", async () => {
  const b = brain(modelSays({ intent: "WAT", confidence: 5, answer: "hello", citations: [], escalate: false }));
  const r = await b.reply("hi", ctx());
  assert.equal(r.intent, "UNKNOWN");
  assert.ok(r.confidence <= 1 && r.confidence >= 0);
  assert.equal(r.escalate, true, "an unknown intent escalates");
});

test("honours the model's own escalation", async () => {
  const b = brain(modelSays({ intent: "REFUND_OR_PROBLEM", confidence: 0.8, answer: "I'll get a specialist.", citations: [], escalate: true }));
  const r = await b.reply("the food was cold, refund me", ctx());
  assert.equal(r.escalate, true);
  assert.equal(r.action.type, "ESCALATE");
});

test("falls back to the deterministic brain on a transport error", async () => {
  const b = brain(async () => { throw new Error("network down"); });
  const r = await b.reply("why is there a service charge?", ctx());
  // Matches the deterministic brain's grounded answer, not an error.
  assert.equal(r.intent, "EXPLAIN_CHARGE");
  assert.equal(r.citations[0]?.policySlug, "pricing");
});

test("falls back on a non-200, a refusal, or an unparseable body", async () => {
  const http500 = brain(async () => ({ status: 500, body: {} }));
  assert.equal((await http500.reply("where is my order?", ctx())).intent, "ORDER_STATUS");
  const refusal = brain(async () => ({ status: 200, body: { stop_reason: "refusal", content: [] } }));
  assert.ok((await refusal.reply("asdf", ctx())).escalate);
  const garbage = brain(async () => ({ status: 200, body: { content: [{ type: "text", text: "not json at all" }] } }));
  assert.ok((await garbage.reply("asdf", ctx())).escalate);
});

test("sends the Anthropic API shape: model, system, grounded order + policies", async () => {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const capture: LlmTransport = async (req) => { sent.push({ url: req.url, headers: { ...req.headers }, body: req.body }); return { status: 200, body: { content: [{ type: "text", text: '{"intent":"ORDER_STATUS","confidence":0.8,"answer":"On its way.","citations":[],"escalate":false}' }] } }; };
  const order = { orderId: "o1", state: "PICKED_UP", type: "DELIVERY", total: { currency: "USD", minor: "2420" }, refundInFlight: false };
  await brain(capture).reply("where is my order?", ctx({ order }));
  const req = sent[0];
  assert.ok(req);
  assert.match(req.url, /\/v1\/messages$/);
  assert.equal(req.headers["x-api-key"], "sk-test");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  const payload = JSON.parse(req.body);
  assert.equal(payload.model, "claude-opus-5-5");
  assert.ok(String(payload.system).includes("ONLY from the FACTS"));
  const userMsg = payload.messages[0].content as string; // eslint-disable-line @typescript-eslint/no-unsafe-member-access
  assert.match(userMsg, /PICKED_UP/, "the order state is grounded into the prompt");
  assert.match(userMsg, /\[pricing\]/, "the policy corpus is grounded into the prompt");
});
