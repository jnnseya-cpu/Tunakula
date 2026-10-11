/**
 * The hosted-LLM win-back copywriter (Anthropic Messages API), behind the same WinBackWriter port. It writes a
 * short, personalised re-engagement message grounded in the customer's real history — their name, a favourite
 * dish, how long they've been away, and the goodwill credit the service already decided — and is told to state
 * nothing else: no dish they didn't order, no offer or amount it wasn't given, no false urgency. On any failure
 * (no key, network, refusal, empty reply) it falls back to the deterministic template writer, so a message
 * always goes out. The HTTP call goes through an injectable transport, so this is tested offline with a fake and
 * never makes a real request in CI.
 */
import type { MoneyJSON } from "@tunakula/ts-money";
import type { WinBackContext, WinBackCopy, WinBackWriter } from "@tunakula/ts-contracts";

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmWinBackWriterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const LANG = { fr: "French", en: "English" } as const;
const SYSTEM = [
  "You write one short, warm win-back message to a lapsed food-delivery customer.",
  "Use ONLY the facts given: the customer's name, a favourite dish, how long they've been away, and the credit (if any).",
  "State the credit exactly as given — never invent, round or change an amount, and never promise a discount or credit you were not given.",
  "Name no dish the customer did not order. Add no fake urgency, no deadline, no health or delivery claim.",
  "Two or three friendly sentences, in the requested language. Reply with the message text only — no quotes, labels or preamble.",
].join(" ");

export class LlmWinBackWriter implements WinBackWriter {
  readonly id = "llm";
  readonly #options: LlmWinBackWriterOptions;
  readonly #fallback: WinBackWriter;
  readonly #transport: LlmTransport;

  constructor(options: LlmWinBackWriterOptions, fallback: WinBackWriter) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async write(ctx: WinBackContext): Promise<WinBackCopy> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 300,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(ctx) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`win-back writer HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("win-back writer refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) throw new Error("win-back writer gave no text");
      return { text: clip(text), source: "ai" };
    } catch {
      return this.#fallback.write(ctx);
    }
  }
}

function promptFor(ctx: WinBackContext): string {
  const facts = [`Write in ${LANG[ctx.lang]}.`, `Customer name: ${ctx.displayName}`];
  if (ctx.daysSinceLastOrder !== null) facts.push(`Days since their last order: ${ctx.daysSinceLastOrder}`);
  if (ctx.favouriteDishes.length) facts.push(`Favourite dish(es) they have ordered: ${ctx.favouriteDishes.join(", ")}`);
  facts.push(ctx.credit ? `Goodwill credit waiting for them: ${amount(ctx.credit)} (state it exactly).` : "No credit — win them back with warmth only, promise no discount.");
  return ["Write a short win-back message from only these facts:", ...facts].join("\n");
}

const amount = (m: MoneyJSON) => { const minor = BigInt(m.minor); return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")} ${m.currency}`; };
const clip = (s: string) => (s.length > 500 ? s.slice(0, 500).trimEnd() + "…" : s);

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
