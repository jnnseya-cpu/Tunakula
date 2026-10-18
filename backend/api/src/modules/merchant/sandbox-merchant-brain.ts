/**
 * The in-house, deterministic merchant copilot brain. It turns a branch's grounded facts into ranked,
 * plain-language insights — menu gaps to fill, demand to staff for, performance to watch, reviews to answer.
 * Every number comes from the facts the service resolved; the brain only phrases and prioritises. It changes
 * nothing. A hosted-model brain can replace it behind the same port (e.g. to draft descriptions) later.
 */
import type { BranchFacts, InsightSeverity, MerchantBrain, MerchantInsight } from "@tunakula/ts-contracts";

type Lang = "fr" | "en";
const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};
const SEVERITY_ORDER: Record<InsightSeverity, number> = { WARNING: 3, SUGGESTION: 2, INFO: 1 };

export class SandboxMerchantBrain implements MerchantBrain {
  readonly id: string;
  constructor(options: { id?: string } = {}) {
    this.id = options.id ?? "sandbox";
  }

  insights(facts: BranchFacts, lang: Lang): readonly MerchantInsight[] {
    const T = (fr: string, en: string) => (lang === "en" ? en : fr);
    const out: MerchantInsight[] = [];
    const add = (id: string, category: MerchantInsight["category"], severity: InsightSeverity, title: string, detail: string, metric?: string) =>
      out.push({ id, category, severity, title, detail, ...(metric ? { metric } : {}) });
    const m = facts.menu;

    // Menu quality — concrete gaps an owner can fix in the console.
    if (m.total === 0) {
      add("menu-empty", "MENU", "WARNING", T("Votre menu est vide", "Your menu is empty"), T("Ajoutez vos plats pour commencer à recevoir des commandes.", "Add your dishes to start taking orders."));
    } else {
      if (m.missingPhoto > 0) add("menu-photo", "MENU", "SUGGESTION", T("Ajoutez des photos", "Add photos"), T(`${m.missingPhoto} plat(s) n’ont pas de photo. Les plats avec photo se commandent bien plus.`, `${m.missingPhoto} dish(es) have no photo. Dishes with a photo are ordered far more often.`), `${m.missingPhoto}`);
      if (m.missingSecondLanguage > 0) add("menu-lang", "MENU", "SUGGESTION", T("Traduisez vos plats", "Translate your dishes"), T(`${m.missingSecondLanguage} plat(s) ne sont nommés que dans une langue. Ajoutez l’autre pour toucher plus de clients.`, `${m.missingSecondLanguage} dish(es) are named in one language only. Add the other to reach more customers.`), `${m.missingSecondLanguage}`);
      if (m.missingDescription > 0) add("menu-desc", "MENU", "SUGGESTION", T("Décrivez vos plats", "Describe your dishes"), T(`${m.missingDescription} plat(s) n’ont pas de description. Une courte description aide le client à choisir.`, `${m.missingDescription} dish(es) have no description. A short description helps customers choose.`), `${m.missingDescription}`);
      if (m.missingCategory > 0) add("menu-cat", "MENU", "INFO", T("Classez vos plats", "Categorise your dishes"), T(`${m.missingCategory} plat(s) ne sont pas classés. Des catégories claires rendent le menu plus facile à parcourir.`, `${m.missingCategory} dish(es) are uncategorised. Clear categories make the menu easier to browse.`), `${m.missingCategory}`);
      if (m.unavailable > 0) add("menu-unavail", "MENU", "INFO", T("Plats désactivés", "Dishes switched off"), T(`${m.unavailable} plat(s) sont désactivés et invisibles. Réactivez-les s’ils sont de nouveau disponibles.`, `${m.unavailable} dish(es) are switched off and hidden. Switch them back on when they're available again.`), `${m.unavailable}`);
    }

    // Demand — what to prep and when, from real orders.
    const d = facts.demand;
    if (d.orders30d === 0) {
      add("demand-none", "DEMAND", "INFO", T("Pas encore de commandes", "No orders yet"), T("Dès que les commandes arrivent, vos heures de pointe et vos meilleures ventes s’affichent ici.", "As orders come in, your busy times and best sellers will show up here."));
    } else {
      if (d.busiestWeekday !== undefined && d.busiestHour !== undefined) {
        const day = WEEKDAYS[lang][d.busiestWeekday];
        add("demand-peak", "DEMAND", "INFO", T("Votre heure de pointe", "Your busy time"), T(`Vous recevez le plus de commandes le ${day} vers ${d.busiestHour}h. Prévoyez le personnel et le stock en conséquence.`, `You get the most orders on ${day} around ${d.busiestHour}:00. Staff and stock up accordingly.`));
      }
      if (d.topDishes.length > 0) add("demand-top", "DEMAND", "INFO", T("Vos meilleures ventes", "Your best sellers"), T(`Les plus commandés : ${d.topDishes.map((x) => x.name).join(", ")}. Ne tombez jamais en rupture.`, `Most ordered: ${d.topDishes.map((x) => x.name).join(", ")}. Never run out of these.`));
      if (d.slowDishes.length > 0) add("demand-slow", "DEMAND", "SUGGESTION", T("Plats qui se vendent peu", "Slow movers"), T(`Rarement commandés : ${d.slowDishes.map((x) => x.name).join(", ")}. Une photo, une meilleure description ou un prix revu pourraient aider — sinon, pensez à les retirer.`, `Rarely ordered: ${d.slowDishes.map((x) => x.name).join(", ")}. A photo, a better description or a revised price could help — otherwise consider removing them.`));
    }

    // Performance — from the scorecard, when present.
    const p = facts.performance;
    if (p) {
      if (p.acceptanceRate !== undefined && p.acceptanceRate < 0.9) add("perf-accept", "PERFORMANCE", "WARNING", T("Taux d’acceptation faible", "Low acceptance rate"), T(`Vous acceptez ${Math.round(p.acceptanceRate * 100)}% des commandes. Les refus déçoivent les clients et pèsent sur votre visibilité.`, `You accept ${Math.round(p.acceptanceRate * 100)}% of orders. Rejections disappoint customers and hurt your visibility.`), `${Math.round(p.acceptanceRate * 100)}%`);
      if (p.fulfilmentRate !== undefined && p.fulfilmentRate < 0.95) add("perf-fulfil", "PERFORMANCE", "WARNING", T("Commandes non honorées", "Unfulfilled orders"), T(`${Math.round((1 - p.fulfilmentRate) * 100)}% des commandes acceptées ne sont pas honorées. Vérifiez vos disponibilités et vos horaires.`, `${Math.round((1 - p.fulfilmentRate) * 100)}% of accepted orders aren't fulfilled. Check your availability and opening hours.`), `${Math.round(p.fulfilmentRate * 100)}%`);
      if (p.avgPrepMinutes !== undefined && p.avgPrepMinutes > 25) add("perf-prep", "PERFORMANCE", "SUGGESTION", T("Temps de préparation long", "Long prep time"), T(`Votre préparation prend en moyenne ${Math.round(p.avgPrepMinutes)} min. Des temps plus courts améliorent la note de livraison.`, `Your prep averages ${Math.round(p.avgPrepMinutes)} min. Shorter times improve the delivery rating.`), `${Math.round(p.avgPrepMinutes)} min`);
    }

    // Reviews — nudge to engage.
    const r = facts.reviews;
    if (r && r.count > 0) {
      if (r.average !== undefined && r.average < 4) add("rev-low", "REVIEWS", "WARNING", T("Note en baisse", "Rating slipping"), T(`Votre note moyenne est de ${r.average.toFixed(1)}/5. Lisez les avis récents pour voir ce qui revient.`, `Your average rating is ${r.average.toFixed(1)}/5. Read recent reviews to see what keeps coming up.`), `${r.average.toFixed(1)}/5`);
      if (r.recentLow > 0) add("rev-reply", "REVIEWS", "SUGGESTION", T("Répondez aux avis", "Reply to reviews"), T(`${r.recentLow} avis faible(s) récent(s). Une réponse attentionnée récupère souvent le client.`, `${r.recentLow} recent low review(s). A thoughtful reply often wins the customer back.`), `${r.recentLow}`);
    }

    return out.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  }
}
