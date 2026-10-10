/**
 * The in-house, deterministic rider copilot brain. It turns a rider's grounded facts into a few encouraging,
 * actionable tips: where the orders are right now, how the day is going, and when they'll be paid. It never
 * tells a rider to accept more jobs — on Tunakula, saying no never costs a rider jobs — so it only points to
 * demand and celebrates earnings. A hosted model can replace it behind the same port.
 */
import type { MoneyJSON } from "@tunakula/ts-money";
import type { RiderBrain, RiderFacts, RiderInsight } from "@tunakula/ts-contracts";

type Lang = "fr" | "en";
const HOURS: Record<Lang, string> = { en: ":00", fr: "h" };

function fmt(m: MoneyJSON): string {
  const minor = BigInt(m.minor);
  const whole = minor / 100n, cents = (minor % 100n).toString().padStart(2, "0");
  return `${whole}.${cents} ${m.currency}`;
}
const isZero = (m: MoneyJSON) => BigInt(m.minor) === 0n;

export class SandboxRiderBrain implements RiderBrain {
  readonly id: string;
  constructor(options: { id?: string } = {}) {
    this.id = options.id ?? "sandbox";
  }

  insights(facts: RiderFacts, lang: Lang): readonly RiderInsight[] {
    const T = (fr: string, en: string) => (lang === "en" ? en : fr);
    const out: RiderInsight[] = [];
    const add = (id: string, category: RiderInsight["category"], tone: RiderInsight["tone"], title: string, detail: string, metric?: string) =>
      out.push({ id, category, tone, title, detail, ...(metric ? { metric } : {}) });

    // Where the orders are right now — the most useful, actionable tip, so it comes first.
    const hot = facts.zones.filter((z) => z.level === "HOT");
    const busy = facts.zones.filter((z) => z.level === "BUSY");
    if (hot.length > 0) {
      const names = hot.map((z) => z.zone).join(", ");
      add("zones-hot", "ZONES", "ACTION", T("Les commandes affluent", "Orders are pouring in"), T(`${names} est très demandé en ce moment. Rapprochez-vous pour prendre plus de courses.`, `${names} is in high demand right now. Head that way to pick up more jobs.`), T(`${hot[0]!.zone} · chaud`, `${hot[0]!.zone} · hot`));
    } else if (busy.length > 0) {
      add("zones-busy", "ZONES", "ACTION", T("Ça bouge près de vous", "It's picking up near you"), T(`${busy.map((z) => z.zone).join(", ")} est occupé. C'est un bon moment pour vous positionner.`, `${busy.map((z) => z.zone).join(", ")} is busy. A good time to position yourself.`));
    } else if (facts.zones.length > 0) {
      add("zones-quiet", "ZONES", "INFO", T("Calme pour l'instant", "Quiet for now"), T("Peu de commandes en attente. Faites une pause — vous ne perdez jamais de courses en refusant.", "Few orders waiting. Take a break — you never lose jobs by saying no."));
    }

    // How the day is going — celebrate, don't pressure.
    const e = facts.earnings;
    if (e.jobsToday > 0) {
      add("earn-today", "EARNINGS", "CHEER", T("Votre journée", "Your day so far"), T(`Vous avez gagné ${fmt(e.today)} sur ${e.jobsToday} course(s) aujourd'hui. Beau travail !`, `You've earned ${fmt(e.today)} across ${e.jobsToday} job(s) today. Nice work!`), fmt(e.today));
    } else if (!isZero(e.week)) {
      add("earn-week", "EARNINGS", "INFO", T("Cette semaine", "This week"), T(`${fmt(e.week)} gagnés sur ${e.jobsWeek} course(s) cette semaine.`, `${fmt(e.week)} earned across ${e.jobsWeek} job(s) this week.`), fmt(e.week));
    }
    if (e.bestHours && e.bestHours.length > 0) {
      const hrs = e.bestHours.slice(0, 2).map((h) => `${h}${HOURS[lang]}`).join(" & ");
      add("earn-hours", "EARNINGS", "INFO", T("Vos meilleures heures", "Your best hours"), T(`Vous gagnez le plus vers ${hrs}. Planifiez vos tournées autour de ces heures.`, `You earn the most around ${hrs}. Plan your shifts around those times.`));
    }

    // When you'll be paid — clarity on the question riders ask most.
    const p = facts.payout;
    if (!isZero(p.pending)) {
      add("payout-pending", "PAYOUT", "INFO", T("Votre paie", "Your pay"), T(`${fmt(p.pending)} en attente de versement${p.nextPayoutLabel ? `, prévu ${p.nextPayoutLabel}` : ""}. Versé sur un compte à votre nom.`, `${fmt(p.pending)} pending payout${p.nextPayoutLabel ? `, due ${p.nextPayoutLabel}` : ""}. Paid to an account in your name.`), fmt(p.pending));
    } else if (p.lastPayout) {
      add("payout-last", "PAYOUT", "INFO", T("Dernier versement", "Last payout"), T(`Votre dernier versement était de ${fmt(p.lastPayout)}${p.lastPayoutAt ? ` le ${p.lastPayoutAt}` : ""}. Tout est à jour.`, `Your last payout was ${fmt(p.lastPayout)}${p.lastPayoutAt ? ` on ${p.lastPayoutAt}` : ""}. You're all settled up.`));
    }

    return out;
  }
}
