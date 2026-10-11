/**
 * The menu writer brains: the offline template writer (describes, can't translate) and the hosted-LLM writer
 * (describes + translates, falls back to the template on failure). Fake transport — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MenuWriteInput } from "@tunakula/ts-contracts";
import { TemplateMenuWriter } from "../src/modules/merchant/template-menu-writer.ts";
import { LlmMenuWriter, type LlmTransport } from "../src/modules/merchant/llm-menu-writer.ts";

const describe = (over: Partial<MenuWriteInput> = {}): MenuWriteInput => ({ task: "DESCRIBE", name: "Chicken moambe", category: "Local", sourceText: "", fromLang: "en", toLang: "en", ...over });
const translate = (over: Partial<MenuWriteInput> = {}): MenuWriteInput => ({ task: "TRANSLATE", name: "Poulet à la moambe", sourceText: "Poulet mijoté dans une sauce de noix de palme.", fromLang: "fr", toLang: "en", ...over });

test("template writer drafts a grounded description from name + category", async () => {
  const r = await new TemplateMenuWriter().write(describe());
  assert.equal(r.source, "template");
  assert.match(r.text, /Chicken moambe/);
  assert.match(r.text, /local/i);
});

test("template writer returns empty for a translation — it needs a model", async () => {
  const r = await new TemplateMenuWriter().write(translate());
  assert.equal(r.text, "");
  assert.equal(r.source, "template");
});

const modelSays = (text: string): LlmTransport => async () => ({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
const writer = (t: LlmTransport) => new LlmMenuWriter({ apiKey: "sk-test", model: "claude-opus-5-5", transport: t }, new TemplateMenuWriter());

test("LLM writer returns the model's text, marked ai", async () => {
  const r = await writer(modelSays("Tender chicken simmered in a rich palm-nut sauce, a Kinshasa classic.")).write(describe());
  assert.equal(r.source, "ai");
  assert.match(r.text, /palm-nut sauce/);
});

test("LLM writer translates through the model", async () => {
  const r = await writer(modelSays("Chicken simmered in a palm-nut sauce.")).write(translate());
  assert.equal(r.source, "ai");
  assert.match(r.text, /Chicken simmered/);
});

test("LLM writer falls back to the template for a description on failure", async () => {
  const r = await writer(async () => { throw new Error("down"); }).write(describe());
  assert.equal(r.source, "template", "a description still comes back offline");
  assert.match(r.text, /Chicken moambe/);
});

test("LLM writer falls back to empty for a translation on failure (so the service can prompt for a key)", async () => {
  const r = await writer(async () => ({ status: 500, body: {} })).write(translate());
  assert.equal(r.text, "");
  assert.equal(r.source, "template");
});

test("LLM writer sends the Anthropic shape with the dish grounded in the prompt", async () => {
  const sent: string[] = [];
  const capture: LlmTransport = async (req) => { sent.push(req.body); return { status: 200, body: { content: [{ type: "text", text: "A tasty dish." }] } }; };
  await writer(capture).write(describe());
  const payload = JSON.parse(sent[0]!);
  assert.equal(payload.model, "claude-opus-5-5");
  assert.match(payload.messages[0].content, /Chicken moambe/);
  assert.match(payload.messages[0].content, /Category: Local/);
});
