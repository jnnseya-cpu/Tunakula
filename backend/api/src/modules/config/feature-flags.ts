/**
 * Feature flags per market, city, brand and user segment (PRD §28.5). Every
 * flag has an owner and a removal date; overdue flags are reported so they
 * get cleaned up. Percentage rollouts are sticky per user.
 */
import { createHash } from "node:crypto";

export interface FlagRule {
  readonly when: {
    readonly country?: string;
    readonly cityId?: string;
    readonly brandId?: string;
    readonly segment?: string;
  };
  readonly value: boolean;
  /** Share of matching users who get `value` (0–100); the rest get the default. */
  readonly rolloutPercent?: number;
}

export interface FeatureFlag {
  readonly key: string;
  readonly description: string;
  readonly owner: string;
  /** ISO date by which the flag must be removed from code and config. */
  readonly removeBy: string;
  readonly defaultValue: boolean;
  /** Evaluated in order; the first matching rule wins. List specific rules first. */
  readonly rules: readonly FlagRule[];
}

export interface FlagContext {
  readonly country: string;
  readonly cityId?: string;
  readonly brandId?: string;
  readonly segments?: readonly string[];
  /** Pseudonymous user id, for sticky percentage rollouts. */
  readonly userId?: string;
}

export class FlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlagError";
  }
}

const KEY = /^[a-z][a-z0-9_.-]{2,63}$/;

export class FeatureFlags {
  readonly #flags = new Map<string, FeatureFlag>();
  readonly #now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  define(flag: FeatureFlag): void {
    if (!KEY.test(flag.key)) throw new FlagError(`Invalid flag key "${flag.key}"`);
    if (!flag.owner.trim()) throw new FlagError(`Flag ${flag.key} needs an owner`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flag.removeBy) || Number.isNaN(Date.parse(flag.removeBy))) throw new FlagError(`Flag ${flag.key} needs a removal date (YYYY-MM-DD)`);
    if (Date.parse(flag.removeBy) <= this.#now().getTime() && !this.#flags.has(flag.key)) throw new FlagError(`Flag ${flag.key} removal date is in the past`);
    for (const r of flag.rules) {
      if (r.rolloutPercent !== undefined && !(Number.isInteger(r.rolloutPercent) && r.rolloutPercent >= 0 && r.rolloutPercent <= 100)) {
        throw new FlagError(`Flag ${flag.key}: rollout must be a whole percentage`);
      }
      if (r.when.country && !/^[A-Z]{2}$/.test(r.when.country)) throw new FlagError(`Flag ${flag.key}: invalid country ${r.when.country}`);
    }
    this.#flags.set(flag.key, flag);
  }

  isEnabled(key: string, ctx: FlagContext): boolean {
    const flag = this.#flags.get(key);
    // Unknown flags are off: code paths behind a missing flag never switch on by accident.
    if (!flag) return false;
    for (const rule of flag.rules) {
      if (!matches(rule, ctx)) continue;
      if (rule.rolloutPercent === undefined) return rule.value;
      if (!ctx.userId) return flag.defaultValue;
      return bucket(flag.key, ctx.userId) < rule.rolloutPercent ? rule.value : flag.defaultValue;
    }
    return flag.defaultValue;
  }

  /** Flags past their removal date, for the weekly clean-up report. */
  overdue(): FeatureFlag[] {
    const now = this.#now().getTime();
    return [...this.#flags.values()].filter((f) => Date.parse(f.removeBy) <= now);
  }
}

function matches(rule: FlagRule, ctx: FlagContext): boolean {
  const w = rule.when;
  if (w.country && w.country !== ctx.country) return false;
  if (w.cityId && w.cityId !== ctx.cityId) return false;
  if (w.brandId && w.brandId !== ctx.brandId) return false;
  if (w.segment && !(ctx.segments ?? []).includes(w.segment)) return false;
  return true;
}

/** Stable 0–99 bucket per (flag, user). */
function bucket(key: string, userId: string): number {
  return createHash("sha256").update(`${key}:${userId}`).digest().readUInt32BE(0) % 100;
}
