/**
 * The hosted-LLM nutrition estimator (Anthropic Messages API), behind the NutritionEstimatorBrain port. It
 * estimates per-100 g/ml figures for a dish from its name, category and ingredients, and returns strict JSON that
 * is then VALIDATED and CLAMPED to plausible ranges — a reply that is missing a field, non-numeric, out of range,
 * or unparseable is rejected and falls back to "no estimate" rather than producing a bad health label. Every
 * accepted estimate is marked source "ai" so it is stored and shown as estimated, never measured. The HTTP call
 * goes through an injectable transport, so this is tested offline with a fake and never makes a real request in CI.
 */
import type { NutritionEstimate, NutritionEstimateInput, NutritionEstimateResult, NutritionEstimatorBrain } from "@tunakula/ts-contracts";

export interface LlmTransportRequest { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface LlmTransportResponse { readonly status: number; readonly body: unknown }
export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmNutritionEstimatorOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly transport?: LlmTransport;
}

const SYSTEM = [
  "You are a nutrition estimator for a food-delivery platform.",
  "Estimate the nutrition of ONE dish PER 100 g (or per 100 ml for a drink), from only the facts you are given.",
  "Be realistic and conservative; do not overstate how healthy a dish is. These are estimates, not lab values.",
  "Reply with ONLY a single JSON object, no prose, with exactly these numeric keys:",
  '{"energy_kj_100g","sugars_g_100g","sat_fat_g_100g","salt_g_100g","fibre_g_100g","protein_g_100g","fruit_veg_legume_pct","confidence"}.',
  "fruit_veg_legume_pct is 0-100 (share of fruit, vegetables, pulses, nuts). confidence is 0-1.",
  'If you genuinely cannot estimate the dish, reply exactly {"unknown": true}.',
].join("\n");

// Plausible per-100 g bounds; a value outside these is a bad reply, not a real food.
const BOUNDS: Record<keyof Omit<NutritionEstimate, "confidence">, readonly [number, number]> = {
  energy_kj_100g: [0, 4000], sugars_g_100g: [0, 100], sat_fat_g_100g: [0, 100], salt_g_100g: [0, 30],
  fibre_g_100g: [0, 50], protein_g_100g: [0, 100], fruit_veg_legume_pct: [0, 100],
};

export class LlmNutritionEstimator implements NutritionEstimatorBrain {
  readonly id = "llm";
  readonly #options: LlmNutritionEstimatorOptions;
  readonly #fallback: NutritionEstimatorBrain;
  readonly #transport: LlmTransport;

  constructor(options: LlmNutritionEstimatorOptions, fallback: NutritionEstimatorBrain) {
    this.#options = options;
    this.#fallback = fallback;
    this.#transport = options.transport ?? fetchTransport();
  }

  async estimate(input: NutritionEstimateInput): Promise<NutritionEstimateResult> {
    try {
      const res = await this.#transport({
        url: `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        headers: { "x-api-key": this.#options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#options.model,
          max_tokens: this.#options.maxTokens ?? 300,
          system: SYSTEM,
          messages: [{ role: "user", content: promptFor(input) }],
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`nutrition estimator HTTP ${res.status}`);
      const body = res.body as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason === "refusal") throw new Error("nutrition estimator refused");
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      const estimate = parseEstimate(text);
      if (!estimate) throw new Error("no usable estimate");
      return { estimate, source: "ai" };
    } catch {
      return this.#fallback.estimate(input);
    }
  }
}

/** Parse the model's JSON, reject anything missing/out-of-range, and clamp confidence to 0..1. Null → fall back. */
export function parseEstimate(text: string): NutritionEstimate | null {
  let obj: Record<string, unknown>;
  try {
    const start = text.indexOf("{"); const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch { return null; }
  if (obj.unknown === true) return null;
  const out: Record<string, number> = {};
  for (const [key, [lo, hi]] of Object.entries(BOUNDS)) {
    const v = Number(obj[key]);
    if (!Number.isFinite(v) || v < lo || v > hi) return null;
    out[key] = Math.round(v * 10) / 10;
  }
  const confidence = Math.min(Math.max(Number(obj.confidence ?? 0.5), 0), 1);
  return { ...(out as unknown as Omit<NutritionEstimate, "confidence">), confidence };
}

function promptFor(input: NutritionEstimateInput): string {
  const facts = [`Dish name: ${input.name}`, `Type: ${input.kind}`];
  if (input.category) facts.push(`Category: ${input.category}`);
  if (input.cuisines?.length) facts.push(`Cuisines: ${input.cuisines.join(", ")}`);
  if (input.description?.trim()) facts.push(`Description: ${input.description}`);
  if (input.ingredients?.length) facts.push(`Components: ${input.ingredients.join(", ")}`);
  return `Estimate the per-100 ${input.kind === "beverage" ? "ml" : "g"} nutrition of this dish:\n${facts.join("\n")}`;
}

function fetchTransport(): LlmTransport {
  return async (req) => {
    const res = await fetch(req.url, { method: "POST", headers: { ...req.headers }, body: req.body, signal: AbortSignal.timeout(20_000) });
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
  };
}
