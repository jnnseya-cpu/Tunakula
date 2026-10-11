/**
 * The rider shift-outlook writer port (§AI rider copilot). Alongside the ranked tips, the copilot can open with a
 * short, friendly natural-language briefing — "here's your shift outlook" — written by a pluggable brain: a
 * deterministic in-house writer (grounded, bilingual, always available) or a hosted model that phrases it more
 * naturally. The writer only summarises the rider's own grounded facts — their earnings, where the orders are
 * right now, and their payout — inventing no number, and it never pressures the rider to accept jobs (on
 * Tunakula, saying no never costs a rider work).
 */
import type { RiderFacts } from "./rider-copilot.ts";

export interface RiderBriefResult {
  readonly text: string;
  readonly source: "ai" | "template";
}

export interface RiderBriefWriter {
  readonly id: string;
  /** Write one short shift-outlook paragraph from the grounded facts. Must always return usable text. */
  write(facts: RiderFacts, lang: "fr" | "en"): Promise<RiderBriefResult>;
}
