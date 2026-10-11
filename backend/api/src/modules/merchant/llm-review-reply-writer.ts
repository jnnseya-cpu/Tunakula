/**
 * The hosted-LLM review-reply writer (Anthropic Messages API), behind the same ReviewReplyWriter port. It drafts
 * a short, warm, professional reply from the restaurant, grounded in the review's real rating and comment: it
 * thanks for praise and apologises sincerely for a complaint, but promises nothing the restaurant hasn't
 * authorised — no refund, comp, discount or specific remedy — and invents no fact the review doesn't state. On
 * any failure (no key, network, refusal, empty reply) it falls back to the deterministic template writer, so a
 * draft always comes back. The HTTP call goes through an injectable transport, so this is tested offline with a
 * fake and never makes a real request in CI. The merchant reviews and edits the draft before posting it.
 */
import type { ReviewReplyContext, ReviewReplyDraft, ReviewReplyWriter } from "@tunakula/ts-contracts";

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmReviewReplyWriterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const LANG = { fr: "French", en: "English" } as const;
const SYSTEM = [
  "You draft one short reply from a restaurant to a customer's review on a food-delivery app.",
  "Be warm, human and professional. Thank the customer for praise; for a complaint, apologise sincerely and say the team will look into it.",
  "Promise NOTHING the restaurant has not authorised: no refund, no free item, no discount, no specific compensation or deadline.",
  "Use only what the review says — invent no detail, name no dish or fact the customer did not mention.",
  "Two or three sentences, in the requested language, signed as the restaurant (no placeholder names). Reply with the message text only — no quotes, labels or preamble.",
].join(" ");

export class LlmReviewReplyWriter implements ReviewReplyWriter {
  readonly id = "llm";
  readonly #options: LlmReviewReplyWriterOptions;
  readonly #fallback: ReviewReplyWriter;
  readonly #transport: LlmTransport;

  constructor(options: LlmReviewReplyWriterOptions, fallback: ReviewReplyWriter) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async write(ctx: ReviewReplyContext): Promise<ReviewReplyDraft> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 350,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(ctx) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`review reply writer HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("review reply writer refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) throw new Error("review reply writer gave no text");
      return { text: clip(text), source: "ai" };
    } catch {
      return this.#fallback.write(ctx);
    }
  }
}

function promptFor(ctx: ReviewReplyContext): string {
  const facts = [
    `Write the reply in ${LANG[ctx.lang]}.`,
    `Restaurant: ${ctx.branchName}`,
    `Star rating: ${ctx.rating} out of 5`,
  ];
  if (ctx.reviewerName) facts.push(`Customer's first name: ${ctx.reviewerName}`);
  facts.push(ctx.comment && ctx.comment.trim() ? `Their comment: "${ctx.comment.trim()}"` : "They left a rating but no written comment.");
  return ["Draft a reply from the restaurant to this review, from only these facts:", ...facts].join("\n");
}

const clip = (s: string) => (s.length > 1000 ? s.slice(0, 1000).trimEnd() + "…" : s);

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
