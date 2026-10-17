/**
 * The rider shift-outlook writers: the offline template writer (grounded, bilingual, no pressure to accept) and
 * the hosted-LLM writer (natural, falls back to the template on any failure). Fake transport — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiderFacts } from "@tunakula/ts-contracts";
import { TemplateRiderBriefWriter } from "../src/modules/rider/template-rider-brief-writer.ts";
import { LlmRiderBriefWriter, type LlmTransport } from "../src/modules/rider/llm-rider-brief-writer.ts";

const usd = (minor: string) => ({ currency: "USD", minor });
const facts = (over: Partial<RiderFacts> = {}): RiderFacts => ({
  riderName: "Jean",
  earnings: { today: usd("1850"), week: usd("9400"), jobsToday: 4, jobsWeek: 21, avgPerJob: usd("447"), bestHours: [12, 19] },
  zones: [{ zone: "Gombe", level: "HOT", waiting: 6 }, { zone: "Limete", level: "STEADY", waiting: 1 }],
  payout: { pending: usd("1850") },
  ...over,
});

test("template brief grounds today's earnings, the hot zone and the cash-out balance (EN)", async () => {
  const r = await new TemplateRiderBriefWriter().write(facts(), "en");
  assert.equal(r.source, "template");
  assert.match(r.text, /18\.50 USD/);
  assert.match(r.text, /4 deliveries/);
  assert.match(r.text, /Gombe/);
  assert.match(r.text, /cash out/i);
});

test("template brief writes French and handles a day with no deliveries yet", async () => {
  const r = await new TemplateRiderBriefWriter().write(facts({ earnings: { today: usd("0"), week: usd("9400"), jobsToday: 0, jobsWeek: 21 } }), "fr");
  assert.match(r.text, /Pas encore de course/);
  assert.match(r.text, /Gombe/);
});

const modelSays = (text: string): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
const writer = (t: LlmTransport) => new LlmRiderBriefWriter({ apiKey: "sk-test", model: "claude-opus-5-5", transport: t }, new TemplateRiderBriefWriter());

test("LLM brief returns the model's text, marked ai", async () => {
  const r = await writer(modelSays("Solid start, Jean — 18.50 USD in already. Gombe is hopping if you want your next trip.")).write(facts(), "en");
  assert.equal(r.source, "ai");
  assert.match(r.text, /Gombe is hopping/);
});

test("LLM brief falls back to the template on failure and on a non-200", async () => {
  assert.equal((await writer(async () => { throw new Error("down"); }).write(facts(), "en")).source, "template");
  assert.equal((await writer(async () => ({ status: 500, body: {} })).write(facts(), "en")).source, "template");
});

test("LLM brief sends the Anthropic shape, grounds the figures, and forbids pressure", async () => {
  const sent: string[] = [];
  const capture: LlmTransport = async (req) => { sent.push(req.body); return { status: 200, body: { content: [{ type: "text", text: "Nice start." }] } }; };
  await writer(capture).write(facts(), "en");
  const payload = JSON.parse(sent[0]!);
  assert.equal(payload.model, "claude-opus-5-5");
  assert.match(payload.messages[0].content, /18\.50 USD/);
  assert.match(payload.messages[0].content, /Gombe \(HOT/);
  assert.match(payload.system, /[Nn]ever pressure the rider/);
});
