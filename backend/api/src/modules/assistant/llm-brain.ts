/**
 * A hosted-LLM assistant brain (Anthropic Messages API), behind the same `AssistantBrain` port as the in-house
 * deterministic brain. It is grounded exactly like the sandbox brain — it is handed only the customer's own
 * order and the published policy corpus, and is told to answer from those alone, never invent a fact, never
 * promise a refund, and escalate when unsure. Whatever it returns is then sanitised against the same facts:
 * invented policy citations are dropped and confidence is clamped, so a hallucination cannot leak through. On
 * any failure — no key, a network error, a refusal, an unparseable reply — it falls back to the deterministic
 * brain, so the assistant always answers. The HTTP call goes through an injectable transport, so this is tested
 * offline with a fake and never makes a real request in CI.
 */
import type { AssistantBrain, AssistantContext, AssistantReply, AssistantCitation, KnowledgeSnippet, SupportIntent } from "@tunakula/ts-contracts";

const INTENTS: readonly SupportIntent[] = ["ORDER_STATUS", "EXPLAIN_CHARGE", "REFUND_OR_PROBLEM", "HOW_TO", "ACCOUNT_DATA", "CHEF_BOOKING", "GREETING", "UNKNOWN"];

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmBrainOptions {
  readonly apiKey: string;
  /** The model id (e.g. claude-opus-5-5). The operator sets it from the Integrations panel. */
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const SYSTEM = [
  "You are the Tunakula customer-service assistant for a food-delivery platform.",
  "Answer ONLY from the FACTS block you are given — the customer's own order (if any) and the platform's published policies.",
  "Never invent an order detail, a price, a policy, or a promise. Never say a refund has been or will be issued; a refund is decided by a human.",
  "If you are unsure, if the question needs a human judgement (a discretionary refund, a complaint), or if the facts do not cover it, set escalate to true.",
  "Reply ONLY with a single JSON object, no prose around it, with exactly these keys:",
  '{"intent": one of ORDER_STATUS|EXPLAIN_CHARGE|REFUND_OR_PROBLEM|HOW_TO|ACCOUNT_DATA|CHEF_BOOKING|GREETING|UNKNOWN,',
  ' "confidence": a number 0..1, "answer": a short helpful reply in the requested language,',
  ' "citations": an array of {"title": string, "policySlug": string} drawn only from the POLICIES you were given,',
  ' "escalate": boolean}.',
].join("\n");

export class LlmAssistantBrain implements AssistantBrain {
  readonly id = "llm";
  readonly #options: LlmBrainOptions;
  readonly #fallback: AssistantBrain;
  readonly #transport: LlmTransport;

  constructor(options: LlmBrainOptions, fallback: AssistantBrain) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async reply(query: string, context: AssistantContext): Promise<AssistantReply> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 1024,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(query, context) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`assistant model HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("assistant model refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      const parsed = parseJsonObject(text);
      if (!parsed || typeof parsed["answer"] !== "string" || !parsed["answer"].trim()) throw new Error("assistant model gave no usable answer");
      return sanitise(parsed, context);
    } catch {
      // Any failure — no key, network, refusal, bad JSON — falls back to the grounded deterministic brain.
      return this.#fallback.reply(query, context);
    }
  }
}

/** Serialises the grounded facts the model may use: the customer's own order and the policy corpus. */
function promptFor(query: string, ctx: AssistantContext): string {
  const lines: string[] = [`LANGUAGE: ${ctx.lang}`, `QUESTION: ${query}`, ""];
  if (ctx.order) {
    const o = ctx.order;
    lines.push("ORDER (the customer's own):");
    lines.push(`- state: ${o.state}`, `- type: ${o.type}`, `- total: ${money(o.total)}`);
    if (o.serviceCharge) lines.push(`- service charge: ${money(o.serviceCharge)}`);
    if (o.deliveryFee) lines.push(`- delivery fee: ${money(o.deliveryFee)}`);
    if (o.branchName) lines.push(`- restaurant: ${o.branchName}`);
    lines.push(`- refund already automatic for this state: ${o.refundInFlight ? "yes" : "no"}`, "");
  } else {
    lines.push("ORDER: none provided (the customer did not reference an order you can see).", "");
  }
  lines.push("POLICIES (quote and cite only these; use the slug exactly):");
  for (const k of ctx.knowledge) lines.push(`- [${k.policySlug ?? k.id}] ${k.title}: ${k.body[ctx.lang === "en" ? "en" : "fr"]}`);
  return lines.join("\n");
}

/** Clamps and grounds the model's reply: a valid intent, confidence in range, and only real policy citations. */
function sanitise(obj: Record<string, unknown>, ctx: AssistantContext): AssistantReply {
  const slugs = new Set(ctx.knowledge.map((k) => k.policySlug).filter(Boolean) as string[]);
  const bySlug = new Map(ctx.knowledge.filter((k) => k.policySlug).map((k) => [k.policySlug as string, k] as [string, KnowledgeSnippet]));
  const intent: SupportIntent = INTENTS.includes(obj["intent"] as SupportIntent) ? (obj["intent"] as SupportIntent) : "UNKNOWN";
  let confidence = Number(obj["confidence"]);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  const citations: AssistantCitation[] = Array.isArray(obj["citations"])
    ? (obj["citations"] as { title?: unknown; policySlug?: unknown }[])
        .filter((c) => typeof c?.policySlug === "string" && slugs.has(c.policySlug))
        .map((c) => ({ title: bySlug.get(c.policySlug as string)?.title ?? String(c.title ?? c.policySlug), policySlug: c.policySlug as string }))
    : [];
  const escalate = obj["escalate"] === true || intent === "UNKNOWN";
  return {
    intent,
    confidence,
    answer: String(obj["answer"]).trim(),
    citations,
    action: escalate ? { type: "ESCALATE" } : { type: "NONE" },
    escalate,
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const money = (m: { minor: bigint | string; currency: string }) => {
  const minor = BigInt(m.minor);
  const whole = minor / 100n, cents = (minor % 100n).toString().padStart(2, "0");
  return `${whole}.${cents} ${m.currency}`;
};

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
