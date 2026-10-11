/**
 * The review-reply writers: the offline template writer (tone by rating, bilingual) and the hosted-LLM writer
 * (personalised, falls back to the template on any failure, promises nothing). Fake transport — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReviewReplyContext } from "@tunakula/ts-contracts";
import { TemplateReviewReplyWriter } from "../src/modules/merchant/template-review-reply-writer.ts";
import { LlmReviewReplyWriter, type LlmTransport } from "../src/modules/merchant/llm-review-reply-writer.ts";

const ctx = (over: Partial<ReviewReplyContext> = {}): ReviewReplyContext => ({
  rating: 5, comment: "Delicious moambe, fast delivery!", reviewerName: "Joelle", branchName: "Chez Maman Gombe", lang: "en", ...over,
});

test("template writer thanks warmly for a high rating and names the branch", async () => {
  const r = await new TemplateReviewReplyWriter().write(ctx({ rating: 5 }));
  assert.equal(r.source, "template");
  assert.match(r.text, /Joelle/);
  assert.match(r.text, /Chez Maman Gombe/);
  assert.match(r.text, /thank you/i);
});

test("template writer apologises for a low rating (FR)", async () => {
  const r = await new TemplateReviewReplyWriter().write(ctx({ rating: 1, lang: "fr" }));
  assert.match(r.text, /désolés/i);
  assert.match(r.text, /Chez Maman Gombe/);
});

test("template writer handles a rating with no comment and no name", async () => {
  const r = await new TemplateReviewReplyWriter().write({ rating: 3, branchName: "Chez Maman Gombe", lang: "en" });
  assert.ok(r.text.length > 0);
  assert.match(r.text, /feedback/i);
});

const modelSays = (text: string): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
const writer = (t: LlmTransport) => new LlmReviewReplyWriter({ apiKey: "sk-test", model: "claude-opus-5-5", transport: t }, new TemplateReviewReplyWriter());

test("LLM writer returns the model's reply, marked ai", async () => {
  const r = await writer(modelSays("Thank you so much, Joelle — we're thrilled you loved the moambe!")).write(ctx());
  assert.equal(r.source, "ai");
  assert.match(r.text, /thrilled you loved/);
});

test("LLM writer falls back to the template on failure", async () => {
  const r = await writer(async () => { throw new Error("down"); }).write(ctx({ rating: 2 }));
  assert.equal(r.source, "template");
});

test("LLM writer falls back on a non-200 too", async () => {
  const r = await writer(async () => ({ status: 500, body: {} })).write(ctx());
  assert.equal(r.source, "template");
});

test("LLM writer sends the Anthropic shape, grounding the rating and the comment", async () => {
  const sent: string[] = [];
  const capture: LlmTransport = async (req) => { sent.push(req.body); return { status: 200, body: { content: [{ type: "text", text: "Thanks!" }] } }; };
  await writer(capture).write(ctx({ rating: 2, comment: "Order arrived cold." }));
  const payload = JSON.parse(sent[0]!);
  assert.equal(payload.model, "claude-opus-5-5");
  assert.match(payload.messages[0].content, /2 out of 5/);
  assert.match(payload.messages[0].content, /arrived cold/);
  assert.match(payload.system, /Promise NOTHING/);
});
