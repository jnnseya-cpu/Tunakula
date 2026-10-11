/**
 * The hosted-LLM menu writer (Anthropic Messages API), behind the same MenuWriterBrain port. It drafts a dish
 * description or translates one, grounded in the dish's real name, category and existing text, and told to write
 * nothing but the requested text — no invented prices, claims or allergens. On any failure (no key, network,
 * refusal, empty reply) it falls back to the offline template writer, which still produces a description (and
 * returns empty for a translation, so the service can tell the merchant to configure the key). The HTTP call goes
 * through an injectable transport, so this is tested offline with a fake and never makes a real request in CI.
 */
import type { MenuWriteInput, MenuWriteResult, MenuWriterBrain } from "@tunakula/ts-contracts";

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmMenuWriterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const LANG = { fr: "French", en: "English" } as const;
const SYSTEM = [
  "You write and translate short menu copy for a food-delivery platform.",
  "Write ONLY the requested text — one or two appetising sentences for a description, or a faithful translation.",
  "Never invent facts the dish does not state: no price, no delivery time, no health or allergen claim, no ingredient you were not given.",
  "Keep the dish's own name. Do not add quotes, labels, or any preamble — reply with the text only.",
].join(" ");

export class LlmMenuWriter implements MenuWriterBrain {
  readonly id = "llm";
  readonly #options: LlmMenuWriterOptions;
  readonly #fallback: MenuWriterBrain;
  readonly #transport: LlmTransport;

  constructor(options: LlmMenuWriterOptions, fallback: MenuWriterBrain) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async write(input: MenuWriteInput): Promise<MenuWriteResult> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 400,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(input) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`menu writer HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("menu writer refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) throw new Error("menu writer gave no text");
      return { text: clip(text), source: "ai" };
    } catch {
      return this.#fallback.write(input);
    }
  }
}

function promptFor(input: MenuWriteInput): string {
  if (input.task === "TRANSLATE") {
    return [
      `Translate this menu text from ${LANG[input.fromLang]} to ${LANG[input.toLang]}.`,
      `Dish name: ${input.name}`,
      `Text: ${input.sourceText}`,
    ].join("\n");
  }
  const facts = [`Dish name: ${input.name}`];
  if (input.category) facts.push(`Category: ${input.category}`);
  if (input.cuisines && input.cuisines.length) facts.push(`Cuisines: ${input.cuisines.join(", ")}`);
  if (input.sourceText.trim()) facts.push(`Existing description to improve: ${input.sourceText}`);
  return [`Write a short, appetising ${LANG[input.toLang]} description (1-2 sentences) for this dish, from only these facts:`, ...facts].join("\n");
}

const clip = (s: string) => (s.length > 600 ? s.slice(0, 600).trimEnd() + "…" : s);

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
