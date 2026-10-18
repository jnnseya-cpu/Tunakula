/**
 * The in-house, deterministic growth brain. It reads a customer's lifecycle from recency and frequency, and
 * ranks the candidate recommendations the service resolved from real data. No model call, no money movement —
 * a suggested win-back credit is only a suggestion the service caps and issues under a human's authority. It
 * can be replaced by a hosted-model brain behind the same `GrowthBrain` port.
 */
import type { GrowthAssessment, GrowthBrain, GrowthSignals, LifecycleSegment, RecommendationCandidate, RecommendationPick } from "@tunakula/ts-contracts";
import { Money } from "@tunakula/ts-money";

/** Recency thresholds (days) that bound each lifecycle stage. Deliberately conservative. */
const AT_RISK_AFTER = 14;
const LAPSED_AFTER = 30;
const DORMANT_AFTER = 90;
/** Reason priority when blending candidate sources: a dish you've had beats a kitchen pick beats market-popular. */
const REASON_RANK: Record<string, number> = { ORDER_AGAIN: 3, KITCHEN_PICK: 2, POPULAR: 1 };

export class SandboxGrowthBrain implements GrowthBrain {
  readonly id: string;
  /** Win-back credit is a fraction of the customer's average basket, capped by the service. */
  readonly #winBackBps: number;
  constructor(options: { id?: string; winBackBps?: number } = {}) {
    this.id = options.id ?? "sandbox";
    this.#winBackBps = options.winBackBps ?? 2000; // 20% of average basket, as a goodwill credit suggestion
  }

  assess(signals: GrowthSignals): GrowthAssessment {
    const segment = classify(signals);
    switch (segment) {
      case "NEW":
        return { segment, action: { type: "RECOMMEND", rationale: signals.orderCount === 0 ? "Never ordered — surface popular dishes to earn a first order." : "New customer — recommend to build the habit." } };
      case "ACTIVE":
        return { segment, action: { type: "RECOMMEND", rationale: "Ordering regularly — keep recommendations fresh to lift basket size." } };
      case "AT_RISK":
        return { segment, action: { type: "REMIND", rationale: `No order in ${signals.lastOrderDaysAgo} days — a gentle reminder of their favourites.` } };
      case "LAPSED":
      case "DORMANT": {
        const suggestedCredit = signals.avgBasket ? Money.fromJSON(signals.avgBasket).multiply({ numerator: BigInt(this.#winBackBps), denominator: 10_000n }, "half-up").toJSON() : undefined;
        return {
          segment,
          action: {
            type: "WIN_BACK",
            rationale: `${signals.lastOrderDaysAgo} days since the last order — win back with a small goodwill credit.`,
            ...(suggestedCredit ? { suggestedCredit } : {}),
          },
        };
      }
    }
  }

  rank(candidates: readonly RecommendationCandidate[], _signals: GrowthSignals, limit: number): readonly RecommendationPick[] {
    // One pick per item; keep the strongest reason, then the heavier weight.
    const best = new Map<string, RecommendationCandidate>();
    for (const c of candidates) {
      const prev = best.get(c.itemId);
      if (!prev || REASON_RANK[c.reason]! > REASON_RANK[prev.reason]! || (c.reason === prev.reason && c.weight > prev.weight)) best.set(c.itemId, c);
    }
    return [...best.values()]
      .sort((a, b) => REASON_RANK[b.reason]! - REASON_RANK[a.reason]! || b.weight - a.weight)
      .slice(0, Math.max(0, limit))
      .map((c, i) => ({ ...c, rank: i + 1 }));
  }
}

function classify(s: GrowthSignals): LifecycleSegment {
  if (s.lastOrderDaysAgo === null) return "NEW";
  if (s.orderCount <= 1 && s.lastOrderDaysAgo <= AT_RISK_AFTER) return "NEW";
  if (s.lastOrderDaysAgo <= AT_RISK_AFTER) return "ACTIVE";
  if (s.lastOrderDaysAgo <= LAPSED_AFTER) return "AT_RISK";
  if (s.lastOrderDaysAgo <= DORMANT_AFTER) return "LAPSED";
  return "DORMANT";
}
