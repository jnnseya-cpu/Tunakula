/**
 * The hosted-LLM rider shift-outlook writer (Anthropic Messages API), behind the same RiderBriefWriter port. It
 * phrases a short, friendly briefing from the rider's grounded facts — today's earnings and jobs, the busiest
 * zones right now, their best hours, and the balance ready to cash out — inventing no number and never pressuring
 * the rider to accept jobs. On any failure (no key, network, refusal, empty reply) it falls back to the
 * deterministic template writer, so a brief always comes back. The HTTP call goes through an injectable
 * transport, so this is tested offline with a fake and never makes a real request in CI.
 */
import type { MoneyJSON } from "@tunakula/ts-money";
import type { RiderBriefResult, RiderBriefWriter, RiderFacts } from "@tunakula/ts-contracts";

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmRiderBriefWriterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const LANG = { fr: "French", en: "English" } as const;
const SYSTEM = [
  "You write one short, upbeat shift-outlook briefing for a delivery rider on a food-delivery app.",
  "Use ONLY the figures given: earnings so far, number of deliveries, the busiest zones right now, the rider's best hours, and the balance ready to cash out.",
  "Invent no number and state none the facts don't give. Never pressure the rider to accept jobs or go online — on this platform, declining never costs a rider work; zones and hours are offered as help, not a push.",
  "Two or three warm, encouraging sentences, in the requested language. Reply with the briefing text only — no quotes, labels or preamble.",
].join(" ");

export class LlmRiderBriefWriter implements RiderBriefWriter {
  readonly id = "llm";
  readonly #options: LlmRiderBriefWriterOptions;
  readonly #fallback: RiderBriefWriter;
  readonly #transport: LlmTransport;

  constructor(options: LlmRiderBriefWriterOptions, fallback: RiderBriefWriter) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async write(facts: RiderFacts, lang: "fr" | "en"): Promise<RiderBriefResult> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 300,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(facts, lang) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`rider brief writer HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("rider brief writer refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) throw new Error("rider brief writer gave no text");
      return { text: clip(text), source: "ai" };
    } catch {
      return this.#fallback.write(facts, lang);
    }
  }
}

const money = (m: MoneyJSON) => { const minor = BigInt(m.minor); return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")} ${m.currency}`; };

function promptFor(facts: RiderFacts, lang: "fr" | "en"): string {
  const e = facts.earnings;
  const lines = [
    `Write in ${LANG[lang]}.`,
    `Earned today: ${money(e.today)} over ${e.jobsToday} deliveries.`,
    `This week: ${money(e.week)} over ${e.jobsWeek} deliveries.`,
  ];
  if (e.avgPerJob) lines.push(`Average per delivery: ${money(e.avgPerJob)}.`);
  if (e.bestHours && e.bestHours.length) lines.push(`Their strongest hours (24h, local): ${e.bestHours.join(", ")}.`);
  const busy = facts.zones.filter((z) => z.level === "HOT" || z.level === "BUSY").map((z) => `${z.zone} (${z.level}${z.waiting ? `, ${z.waiting} waiting` : ""})`);
  lines.push(busy.length ? `Busiest zones right now: ${busy.join("; ")}.` : "No standout busy zone right now.");
  lines.push(`Balance ready to cash out: ${money(facts.payout.pending)}.`);
  return ["Write a short shift-outlook briefing for the rider, from only these facts:", ...lines].join("\n");
}

const clip = (s: string) => (s.length > 500 ? s.slice(0, 500).trimEnd() + "…" : s);

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
