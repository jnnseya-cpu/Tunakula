/**
 * The growth agent port (§AI). Like the support assistant, growth is a pluggable "brain" behind a stable
 * interface: a deterministic in-house brain ranks recommendations and reads a customer's lifecycle from
 * grounded signals (their own order history), and a hosted-model brain can replace it later. The brain only
 * ranks and classifies what the service already resolved from real data; it invents no items and grants no
 * money — a win-back credit is issued by the service, under a human's authority, through the ledger.
 */
import type { MoneyJSON } from "@tunakula/ts-money";

/** Where a candidate recommendation came from. The reason is shown to the customer, so it must be truthful. */
export type RecommendationReason = "ORDER_AGAIN" | "POPULAR" | "KITCHEN_PICK";

/** A candidate the service resolved from real catalogue + order data; the brain ranks these, never invents them. */
export interface RecommendationCandidate {
  readonly itemId: string;
  readonly name: string;
  readonly branchId: string;
  readonly branchName?: string;
  readonly price?: MoneyJSON;
  readonly reason: RecommendationReason;
  /** How many times this customer has ordered the item (ORDER_AGAIN), or its market order count (POPULAR). */
  readonly weight: number;
}

/** A ranked pick returned to the customer. */
export interface RecommendationPick extends RecommendationCandidate {
  readonly rank: number;
}

/** Grounded signals about one customer, resolved from their own orders. */
export interface GrowthSignals {
  readonly orderCount: number;
  /** Days since the customer's most recent order; null if they have never ordered. */
  readonly lastOrderDaysAgo: number | null;
  readonly distinctItems: number;
  readonly avgBasket?: MoneyJSON;
}

/** The customer's lifecycle stage, from recency and frequency. Drives the next best action. */
export type LifecycleSegment = "NEW" | "ACTIVE" | "AT_RISK" | "LAPSED" | "DORMANT";

export type GrowthActionType = "NONE" | "RECOMMEND" | "REMIND" | "WIN_BACK";
export interface GrowthAction {
  readonly type: GrowthActionType;
  /** A short reason an operator (or an autonomous run under caps) can act on. */
  readonly rationale: string;
  /** A suggested goodwill credit for a win-back, in the customer's currency. The service caps and issues it. */
  readonly suggestedCredit?: MoneyJSON;
}

export interface GrowthAssessment {
  readonly segment: LifecycleSegment;
  readonly action: GrowthAction;
}

export interface GrowthBrain {
  readonly id: string;
  /** Classify the customer's lifecycle and the next best action from grounded signals. */
  assess(signals: GrowthSignals): GrowthAssessment;
  /** Rank and cap the resolved candidates into the customer's "for you" list. */
  rank(candidates: readonly RecommendationCandidate[], signals: GrowthSignals, limit: number): readonly RecommendationPick[];
}
