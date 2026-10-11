/**
 * The hosted-LLM storefront upsell writer (Anthropic Messages API), behind the same UpsellWriter port. It writes
 * one short, tempting line for the complementary dish the service already chose — naming only that dish, inventing
 * no price, discount or health claim, and never pressuring. On any failure (no key, network, refusal, empty
 * reply) it falls back to the deterministic template writer, so a pitch always comes back. The HTTP call goes
 * through an injectable transport, so this is tested offline with a fake and never makes a real request in CI.
 */
import type { UpsellContext, UpsellCopy, UpsellWriter } from "@tunakula/ts-contracts";

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmUpsellWriterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const LANG = { fr: "French", en: "English" } as const;
const SYSTEM = [
  "You write one short, appetising upsell line for a food-delivery storefront, suggesting ONE extra dish to a customer who already has items in their cart.",
  "Name ONLY the suggested dish you are given. Invent no price, no discount, no health claim, no ingredient, and no other dish.",
  "One friendly sentence, under 20 words, in the requested language. No pressure, no fake urgency. Reply with the line only — no quotes, labels or preamble.",
].join(" ");

export class LlmUpsellWriter implements UpsellWriter {
  readonly id = "llm";
  readonly #options: LlmUpsellWriterOptions;
  readonly #fallback: UpsellWriter;
  readonly #transport: LlmTransport;

  constructor(options: LlmUpsellWriterOptions, fallback: UpsellWriter) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async write(ctx: UpsellContext): Promise<UpsellCopy> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 120,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(ctx) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`upsell writer HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("upsell writer refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) throw new Error("upsell writer gave no text");
      return { text: clip(text), source: "ai" };
    } catch {
      return this.#fallback.write(ctx);
    }
  }
}

function promptFor(ctx: UpsellContext): string {
  const lines = [
    `Write in ${LANG[ctx.lang]}.`,
    `Restaurant: ${ctx.branchName}`,
    ctx.cartItems.length ? `Already in the cart: ${ctx.cartItems.join(", ")}` : "The cart has items.",
    `Suggest this dish (name it exactly, suggest nothing else): ${ctx.suggestion}`,
  ];
  if (ctx.suggestionCategory) lines.push(`Its category: ${ctx.suggestionCategory}`);
  return ["Write one short upsell line, from only these facts:", ...lines].join("\n");
}

const clip = (s: string) => (s.length > 160 ? s.slice(0, 160).trimEnd() + "…" : s);

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
