/**
 * Service level objectives and error budgets (PRD §28.2). When an area's
 * budget is exhausted, feature releases for that area pause until reliability
 * work restores it.
 */
import { parseDecimal } from "@tunakula/ts-money";

export interface SloDefinition {
  readonly id: string;
  /** Release area the SLO protects, e.g. "ordering", "payments", "dispatch". */
  readonly area: string;
  /** Target success ratio as a percentage string, e.g. "99.9". */
  readonly targetPercent: string;
}

export interface SloWindow {
  /** Valid events in the window (e.g. valid requests at the gateway). */
  readonly total: number;
  /** Good events (e.g. successful requests). */
  readonly good: number;
}

export interface ErrorBudget {
  readonly sloId: string;
  readonly area: string;
  /** Bad events the target allows in this window. */
  readonly allowedBad: number;
  readonly bad: number;
  /** Share of the budget left, 0–1 (negative when overspent). */
  readonly remaining: number;
  readonly exhausted: boolean;
}

export function errorBudget(slo: SloDefinition, window: SloWindow): ErrorBudget {
  if (!Number.isInteger(window.total) || !Number.isInteger(window.good) || window.good < 0 || window.good > window.total) {
    throw new RangeError("good must be a whole number between 0 and total");
  }
  const target = parseDecimal(slo.targetPercent);
  // Allowed bad events = total × (100 − target) / 100, computed exactly.
  const allowedNumerator = BigInt(window.total) * (100n * target.denominator - target.numerator);
  const allowedDenominator = 100n * target.denominator;
  if (allowedNumerator < 0n) throw new RangeError("Target cannot exceed 100%");
  const bad = window.total - window.good;
  const allowedBad = Number(allowedNumerator) / Number(allowedDenominator);
  const remaining = allowedBad === 0 ? (bad === 0 ? 1 : -Infinity) : 1 - bad / allowedBad;
  return {
    sloId: slo.id,
    area: slo.area,
    allowedBad,
    bad,
    remaining,
    exhausted: BigInt(bad) * allowedDenominator > allowedNumerator,
  };
}

/** Areas whose feature releases are frozen because an SLO budget is exhausted. */
export function releaseFreeze(budgets: readonly ErrorBudget[]): { frozen: string[]; reasons: Record<string, string[]> } {
  const reasons: Record<string, string[]> = {};
  for (const b of budgets) if (b.exhausted) (reasons[b.area] ??= []).push(b.sloId);
  return { frozen: Object.keys(reasons).sort(), reasons };
}

/** §28.2 SLOs that are ratios of events. */
export const PLATFORM_SLOS: readonly SloDefinition[] = [
  { id: "api-availability-ordering", area: "ordering", targetPercent: "99.9" },
  { id: "api-availability-payments", area: "payments", targetPercent: "99.9" },
  { id: "api-availability-dispatch", area: "dispatch", targetPercent: "99.9" },
  { id: "order-placement-success", area: "ordering", targetPercent: "99.5" },
  { id: "crash-free-sessions", area: "apps", targetPercent: "99.5" },
];
