/**
 * The rider copilot service (§AI). It composes the rider's own grounded data — their earnings and jobs, and the
 * live demand heatmap — into the facts the brain needs, then returns a few encouraging, actionable tips. It adds
 * no new data source and moves no money: everything comes from DispatchService, which already enforces that the
 * caller is a rider acting on their own resource. It never nudges a rider to accept jobs.
 */
import type { MoneyJSON } from "@tunakula/ts-money";
import type { RiderBrain, RiderBriefWriter, RiderFacts, ZoneDemand } from "@tunakula/ts-contracts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { DispatchService } from "./dispatch.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { forbidden } from "./errors.ts";

type Wire = { amount_minor: string; currency: string };
const toJ = (w: Wire): MoneyJSON => ({ currency: w.currency, minor: w.amount_minor });
const WEEK_MS = 7 * 86_400_000;

export class RiderCopilotService {
  private readonly registry: CountryConfigRegistry;
  private readonly brain: RiderBrain;
  private readonly briefer: RiderBriefWriter;
  private readonly dispatch: DispatchService;
  private readonly now: () => Date;

  constructor(registry: CountryConfigRegistry, brain: RiderBrain, briefer: RiderBriefWriter, dispatch: DispatchService, now: () => Date = () => new Date()) {
    this.registry = registry; this.brain = brain; this.briefer = briefer; this.dispatch = dispatch; this.now = now;
  }

  async coach(country: string, principal: Principal, lang: "fr" | "en" = "fr") {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    const tz = v.profile.country.timezones?.[0] ?? "UTC";

    // All three enforce rider-ness (riderZones) and own-resource scoping inside DispatchService.
    const [earnings, jobs, heatmap] = await Promise.all([
      this.dispatch.earnings(principal, country),
      this.dispatch.jobs(principal, country),
      this.dispatch.riderHeatmap(principal, country),
    ]);

    const orders = earnings.orders as { at: string; total: Wire; tip: Wire }[];
    const cutoff = this.now().getTime() - WEEK_MS;
    const week = orders.filter((o) => new Date(o.at).getTime() >= cutoff);
    const sum = (rows: { total: Wire }[]) => rows.reduce((n, o) => n + BigInt(o.total.amount_minor), 0n);
    const ccy = earnings.available.currency;
    const weekMinor = sum(week);
    const tipsWeekMinor = week.reduce((n, o) => n + BigInt(o.tip.amount_minor), 0n);

    // Best earning hours, bucketed in the market's timezone over recent jobs.
    const byHour = new Map<number, bigint>();
    for (const o of orders) { const h = hourIn(tz, o.at); byHour.set(h, (byHour.get(h) ?? 0n) + BigInt(o.total.amount_minor)); }
    const bestHours = orders.length >= 5 ? [...byHour.entries()].sort((a, b) => Number(b[1] - a[1])).slice(0, 2).map(([h]) => h) : [];

    const today = jobs.today as { deliveries: number; earnings: Wire };
    const zones: ZoneDemand[] = (heatmap.zones as { zone: string; level: ZoneDemand["level"]; waiting: number }[]).map((z) => ({ zone: z.zone, level: z.level, waiting: z.waiting }));

    const facts: RiderFacts = {
      riderName: "",
      earnings: {
        today: toJ(today.earnings),
        week: { currency: ccy, minor: weekMinor.toString() },
        jobsToday: today.deliveries,
        jobsWeek: week.length,
        ...(tipsWeekMinor > 0n ? { tipsWeek: { currency: ccy, minor: tipsWeekMinor.toString() } } : {}),
        ...(week.length > 0 ? { avgPerJob: { currency: ccy, minor: (weekMinor / BigInt(week.length)).toString() } } : {}),
        ...(bestHours.length > 0 ? { bestHours } : {}),
      },
      zones,
      payout: { pending: toJ(earnings.available) },
    };

    const briefing = await this.briefer.write(facts, lang);
    return {
      tips: this.brain.insights(facts, lang),
      // A short natural-language shift outlook, written from the same grounded facts.
      brief: briefing.text, brief_source: briefing.source,
      // The raw numbers power the panel's header (wire money), the tips are the coaching.
      summary: {
        today: { amount_minor: facts.earnings.today.minor, currency: facts.earnings.today.currency },
        week: { amount_minor: facts.earnings.week.minor, currency: facts.earnings.week.currency },
        jobs_today: facts.earnings.jobsToday, jobs_week: facts.earnings.jobsWeek,
        available: earnings.available, tier: earnings.tier,
      },
    };
  }
}

function hourIn(tz: string, iso: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(iso))) % 24;
  } catch {
    return new Date(iso).getUTCHours();
  }
}
