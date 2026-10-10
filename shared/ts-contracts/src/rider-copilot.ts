/**
 * The rider copilot port (§AI). Same spine as the other agents: a deterministic in-house brain turns a rider's
 * grounded facts — their own earnings, where the orders are right now, and their payout status — into a few
 * encouraging, actionable tips. It reads only; it never accepts a job for the rider and never pressures them to
 * accept one (on Tunakula, saying no never costs a rider jobs). A hosted model can replace it behind the port.
 */
import type { MoneyJSON } from "@tunakula/ts-money";

export type ZoneLevel = "QUIET" | "STEADY" | "BUSY" | "HOT";

export interface ZoneDemand {
  readonly zone: string;
  readonly level: ZoneLevel;
  /** Orders waiting for a rider in the zone right now, when known. */
  readonly waiting?: number;
}

export interface EarningsFacts {
  readonly today: MoneyJSON;
  readonly week: MoneyJSON;
  readonly jobsToday: number;
  readonly jobsWeek: number;
  readonly tipsWeek?: MoneyJSON;
  readonly avgPerJob?: MoneyJSON;
  /** Hours (0–23, market time) the rider has historically earned the most, best first. */
  readonly bestHours?: readonly number[];
}

export interface PayoutFacts {
  readonly pending: MoneyJSON;
  /** A human label for the next scheduled payout, e.g. "tomorrow" or "Monday"; absent if unknown. */
  readonly nextPayoutLabel?: string;
  readonly lastPayout?: MoneyJSON;
  readonly lastPayoutAt?: string;
}

export interface RiderFacts {
  readonly riderName: string;
  readonly earnings: EarningsFacts;
  readonly zones: readonly ZoneDemand[];
  readonly payout: PayoutFacts;
}

export type RiderInsightCategory = "ZONES" | "EARNINGS" | "PAYOUT";
export type RiderInsightTone = "ACTION" | "INFO" | "CHEER";

export interface RiderInsight {
  readonly id: string;
  readonly category: RiderInsightCategory;
  readonly tone: RiderInsightTone;
  readonly title: string;
  readonly detail: string;
  readonly metric?: string;
}

export interface RiderBrain {
  readonly id: string;
  insights(facts: RiderFacts, lang: "fr" | "en"): readonly RiderInsight[];
}
