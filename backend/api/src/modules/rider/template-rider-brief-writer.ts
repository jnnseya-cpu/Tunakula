/**
 * The in-house, deterministic rider shift-outlook writer. It composes a short, friendly briefing from the rider's
 * grounded facts — today's earnings and jobs, the busiest zone right now, and the balance ready to cash out — in
 * the rider's language, with no model call. It never pressures the rider to accept jobs. It is the offline
 * default and the fallback for the hosted-model writer, so a brief is always available.
 */
import type { MoneyJSON } from "@tunakula/ts-money";
import type { RiderBriefResult, RiderBriefWriter, RiderFacts, ZoneLevel } from "@tunakula/ts-contracts";

const money = (m: MoneyJSON) => { const minor = BigInt(m.minor); return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")} ${m.currency}`; };
const RANK: Record<ZoneLevel, number> = { HOT: 3, BUSY: 2, STEADY: 1, QUIET: 0 };

export class TemplateRiderBriefWriter implements RiderBriefWriter {
  readonly id = "template";

  async write(facts: RiderFacts, lang: "fr" | "en"): Promise<RiderBriefResult> {
    const fr = lang === "fr";
    const e = facts.earnings;
    const parts: string[] = [];

    if (e.jobsToday > 0) {
      parts.push(fr
        ? `Aujourd'hui, ${money(e.today)} pour ${e.jobsToday} course${e.jobsToday > 1 ? "s" : ""} — beau travail.`
        : `So far today: ${money(e.today)} over ${e.jobsToday} ${e.jobsToday > 1 ? "deliveries" : "delivery"} — nice work.`);
    } else {
      parts.push(fr ? "Pas encore de course aujourd'hui." : "No deliveries yet today.");
    }

    const top = [...facts.zones].filter((z) => RANK[z.level] >= 2).sort((a, b) => RANK[b.level] - RANK[a.level])[0];
    if (top) {
      const waiting = top.waiting ? (fr ? ` (${top.waiting} en attente)` : ` (${top.waiting} waiting)`) : "";
      parts.push(fr
        ? `La demande est forte à ${top.zone} en ce moment${waiting} si vous cherchez votre prochaine course.`
        : `Demand is strong in ${top.zone} right now${waiting} if you're looking for your next trip.`);
    } else if (e.bestHours && e.bestHours.length > 0) {
      const hrs = e.bestHours.map((h) => `${h}h`).join(" & ");
      parts.push(fr ? `Vos meilleures heures sont souvent autour de ${hrs}.` : `Your strongest hours tend to be around ${hrs}.`);
    }

    const pending = BigInt(facts.payout.pending.minor);
    if (pending > 0n) {
      parts.push(fr
        ? `${money(facts.payout.pending)} sont prêts à être retirés quand vous voulez.`
        : `${money(facts.payout.pending)} is ready to cash out whenever you like.`);
    }

    return { text: parts.join(" "), source: "template" };
  }
}
