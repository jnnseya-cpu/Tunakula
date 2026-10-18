/**
 * The storefront upsell writers: the offline template writer (tone by category, bilingual) and the hosted-LLM
 * writer (natural, falls back to the template on any failure, names only the suggested dish). Fake transport.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { UpsellContext } from "@tunakula/ts-contracts";
import { TemplateUpsellWriter } from "../src/modules/growth/template-upsell-writer.ts";
import { LlmUpsellWriter, type LlmTransport } from "../src/modules/growth/llm-upsell-writer.ts";

const ctx = (over: Partial<UpsellContext> = {}): UpsellContext => ({
  cartItems: ["Poulet à la moambe"], suggestion: "Jus de gingembre", suggestionCategory: "Boissons", branchName: "Chez Maman Gombe", lang: "en", ...over,
});

test("template upsell nudges a drink for a drink-category suggestion and names it", async () => {
  const r = await new TemplateUpsellWriter().write(ctx());
  assert.equal(r.source, "template");
  assert.match(r.text, /Jus de gingembre/);
  assert.match(r.text, /drink/i);
});

test("template upsell writes French and a generic line for a non-drink suggestion", async () => {
  const r = await new TemplateUpsellWriter().write(ctx({ lang: "fr", suggestion: "Tilapia braisé", suggestionCategory: "Grillades" }));
  assert.match(r.text, /Tilapia braisé/);
  assert.match(r.text, /Complétez/);
});

const modelSays = (text: string): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
const writer = (t: LlmTransport) => new LlmUpsellWriter({ apiKey: "sk-test", model: "claude-opus-5-5", transport: t }, new TemplateUpsellWriter());

test("LLM upsell returns the model's line, marked ai", async () => {
  const r = await writer(modelSays("A cool ginger juice would be the perfect match for your moambe.")).write(ctx());
  assert.equal(r.source, "ai");
  assert.match(r.text, /ginger juice/);
});

test("LLM upsell falls back to the template on failure and non-200", async () => {
  assert.equal((await writer(async () => { throw new Error("down"); }).write(ctx())).source, "template");
  assert.equal((await writer(async () => ({ status: 500, body: {} })).write(ctx())).source, "template");
});

test("LLM upsell sends the Anthropic shape, names only the suggestion, forbids inventing", async () => {
  const sent: string[] = [];
  const capture: LlmTransport = async (req) => { sent.push(req.body); return { status: 200, body: { content: [{ type: "text", text: "Try it!" }] } }; };
  await writer(capture).write(ctx());
  const payload = JSON.parse(sent[0]!);
  assert.equal(payload.model, "claude-opus-5-5");
  assert.match(payload.messages[0].content, /Jus de gingembre/);
  assert.match(payload.system, /Invent no price/);
});
