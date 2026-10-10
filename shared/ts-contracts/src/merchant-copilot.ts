/**
 * The merchant copilot port (§AI). Same spine as the other agents: a deterministic in-house brain turns a
 * branch's grounded facts — its menu, its real demand, its performance and its reviews — into a ranked list of
 * plain-language insights and suggestions an owner can act on. The brain reads only facts the service resolved
 * from real data; it recommends, it never changes the menu or prices itself. A hosted model can replace it
 * behind the same port (for example to draft a dish description or translate a name) without changing that rule.
 */

/** A count-based view of menu quality for a branch; the brain turns gaps into suggestions. */
export interface MenuFacts {
  readonly total: number;
  readonly available: number;
  readonly unavailable: number;
  readonly missingSecondLanguage: number;
  readonly missingDescription: number;
  readonly missingCategory: number;
  readonly missingPhoto: number;
  readonly recommended: number;
}

export interface DishCount {
  readonly name: string;
  readonly quantity: number;
}

/** What the branch actually sells, from its own orders. */
export interface DemandFacts {
  readonly orders30d: number;
  /** 0–23, the hour with the most orders; absent if too few orders. */
  readonly busiestHour?: number;
  /** 0 (Sunday)–6, the weekday with the most orders; absent if too few orders. */
  readonly busiestWeekday?: number;
  readonly topDishes: readonly DishCount[];
  readonly slowDishes: readonly DishCount[];
}

/** From the branch's performance scorecard, when available. Rates are 0–1. */
export interface PerformanceFacts {
  readonly acceptanceRate?: number;
  readonly fulfilmentRate?: number;
  readonly avgPrepMinutes?: number;
}

/** From the branch's reviews, when available. */
export interface ReviewFacts {
  readonly count: number;
  readonly average?: number;
  readonly recentLow: number;
}

export interface BranchFacts {
  readonly branchName: string;
  readonly menu: MenuFacts;
  readonly demand: DemandFacts;
  readonly performance?: PerformanceFacts;
  readonly reviews?: ReviewFacts;
}

export type InsightCategory = "MENU" | "DEMAND" | "PERFORMANCE" | "REVIEWS";
export type InsightSeverity = "INFO" | "SUGGESTION" | "WARNING";

export interface MerchantInsight {
  readonly id: string;
  readonly category: InsightCategory;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly detail: string;
  /** An optional headline figure, already formatted (e.g. "72%", "3 dishes"). */
  readonly metric?: string;
}

export interface MerchantBrain {
  readonly id: string;
  insights(facts: BranchFacts, lang: "fr" | "en"): readonly MerchantInsight[];
}
