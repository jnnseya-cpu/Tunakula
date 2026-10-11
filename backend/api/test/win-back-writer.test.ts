/**
 * The win-back copywriters: the offline template writer (grounded, bilingual, always available) and the
 * hosted-LLM writer (personalised, falls back to the template on any failure). Fake transport — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { WinBackContext } from "@tunakula/ts-contracts";
import { TemplateWinBackWriter } from "../src/modules/growth/template-win-back-writer.ts";
import { LlmWinBackWriter, type LlmTransport } from "../src/modules/growth/llm-win-back-writer.ts";

const ctx = (over: Partial<WinBackContext> = {}): WinBackContext => ({
  displayName: "Joelle M.", daysSinceLastOrder: 42, favouriteDishes: ["Poulet à la moambe"],
  credit: { currency: "USD", minor: "200" }, lang: "fr", ...over,
});

test("template writer grounds the message in the name, a real dish and the credit (FR)", async () => {
  const r = await new TemplateWinBackWriter().write(ctx());
  assert.equal(r.source, "template");
  assert.match(r.text, /Joelle/);
  assert.match(r.text, /moambe/);
  assert.match(r.text, /2\.00 USD/);
});

test("template writer writes English when asked", async () => {
  const r = await new TemplateWinBackWriter().write(ctx({ lang: "en" }));
  assert.match(r.text, /missed you/i);
  assert.match(r.text, /2\.00 USD credit/);
});

test("template writer promises no credit when there is none", async () => {
  const r = await new TemplateWinBackWriter().write({ displayName: "Joelle M.", daysSinceLastOrder: 42, favouriteDishes: [], lang: "fr" });
  assert.ok(!/credit/i.test(r.text) && !/crédit/i.test(r.text), "no credit is promised");
  assert.match(r.text, /Joelle/);
});

const modelSays = (text: string): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
const writer = (t: LlmTransport) => new LlmWinBackWriter({ apiKey: "sk-test", model: "claude-opus-5-5", transport: t }, new TemplateWinBackWriter());

test("LLM writer returns the model's personalised copy, marked ai", async () => {
  const r = await writer(modelSays("Joelle, your moambe misses you — here's 2.00 USD to come back.")).write(ctx());
  assert.equal(r.source, "ai");
  assert.match(r.text, /moambe misses you/);
});

test("LLM writer falls back to the template on failure, so a message always goes out", async () => {
  const r = await writer(async () => { throw new Error("down"); }).write(ctx());
  assert.equal(r.source, "template");
  assert.match(r.text, /Joelle/);
});

test("LLM writer falls back on a non-200 too", async () => {
  const r = await writer(async () => ({ status: 500, body: {} })).write(ctx());
  assert.equal(r.source, "template");
});

test("LLM writer sends the Anthropic shape, grounding the dish and the exact credit", async () => {
  const sent: string[] = [];
  const capture: LlmTransport = async (req) => { sent.push(req.body); return { status: 200, body: { content: [{ type: "text", text: "A warm note." }] } }; };
  await writer(capture).write(ctx());
  const payload = JSON.parse(sent[0]!);
  assert.equal(payload.model, "claude-opus-5-5");
  assert.match(payload.messages[0].content, /Poulet à la moambe/);
  assert.match(payload.messages[0].content, /2\.00 USD/);
  assert.match(payload.messages[0].content, /Joelle M\./);
});
