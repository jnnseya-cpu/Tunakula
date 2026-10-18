/**
 * The in-house, deterministic assistant brain. It classifies the question by grounded keyword cues, answers
 * from the customer's own order and the policy corpus, and escalates whenever it is unsure or the question
 * calls for a human judgement (a discretionary refund, a complaint, anything unknown). It makes no external
 * call and moves no money, so it is safe to run everywhere and is what the test suite certifies. A hosted-LLM
 * brain can replace it behind the same `AssistantBrain` port without changing the service that enforces these
 * same guarantees.
 */
import type { AssistantBrain, AssistantContext, AssistantReply, AssistantCitation, KnowledgeSnippet, SupportIntent } from "@tunakula/ts-contracts";
import type { MoneyJSON } from "@tunakula/ts-money";
import { HUMAN_WANTED } from "./knowledge.ts";

const CUES: Record<Exclude<SupportIntent, "UNKNOWN" | "GREETING">, readonly string[]> = {
  ORDER_STATUS: ["where", "status", "track", "when will", "how long", "arrive", "coming", "ou est", "ou en est", "suivi", "quand", "livreur", "rider"],
  EXPLAIN_CHARGE: ["charge", "fee", "fees", "service charge", "why so much", "expensive", "overcharged", "price", "total", "frais", "pourquoi", "cher", "coute", "prix", "facture"],
  REFUND_OR_PROBLEM: ["refund", "money back", "reimburse", "missing", "cold", "wrong order", "wrong item", "never arrived", "didnt arrive", "spoiled", "remboursement", "rembourser", "manquant", "manque", "froid", "mauvais", "jamais recu", "pas recu", "abime", "probleme"],
  HOW_TO: ["how do i", "how can i", "can i", "change", "cancel", "pay", "update address", "comment", "puis je", "annuler", "changer", "payer", "modifier"],
  ACCOUNT_DATA: ["my data", "privacy", "delete account", "delete my", "personal data", "mes donnees", "confidentialite", "supprimer mon compte", "supprimer mes"],
  CHEF_BOOKING: ["chef", "book a chef", "private dining", "meal prep", "cooking class", "reserver un chef", "cuisinier", "consultation"],
};
const GREETINGS = ["hi", "hello", "hey", "good morning", "good evening", "bonjour", "bonsoir", "salut", "mbote", "jambo", "habari"];

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const hits = (text: string, terms: readonly string[]) => terms.reduce((n, t) => (text.includes(strip(t)) ? n + 1 : n), 0);

function fmt(m: MoneyJSON): string {
  const minor = BigInt(m.minor);
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${cents} ${m.currency}`;
}

const L = (lang: AssistantLangLocal, en: string, fr: string) => (lang === "en" ? en : fr);
type AssistantLangLocal = "fr" | "en" | "ln" | "sw";

export class SandboxBrain implements AssistantBrain {
  readonly id: string;
  readonly #threshold: number;
  constructor(options: { id?: string; escalateBelow?: number } = {}) {
    this.id = options.id ?? "sandbox";
    this.#threshold = options.escalateBelow ?? 0.45;
  }

  reply(query: string, ctx: AssistantContext): AssistantReply {
    const lang = ctx.lang;
    const text = strip(query);
    const wantsHuman = hits(text, HUMAN_WANTED) > 0;

    // Classify by strongest keyword signal; ties favour the more specific intent, not the status fallback.
    const PRIORITY: Record<string, number> = { REFUND_OR_PROBLEM: 6, EXPLAIN_CHARGE: 5, ACCOUNT_DATA: 4, CHEF_BOOKING: 3, HOW_TO: 2, ORDER_STATUS: 1 };
    const scores = (Object.entries(CUES) as [Exclude<SupportIntent, "UNKNOWN" | "GREETING">, readonly string[]][])
      .map(([intent, terms]) => [intent, hits(text, terms)] as const)
      .sort((a, b) => b[1] - a[1] || (PRIORITY[b[0]] ?? 0) - (PRIORITY[a[0]] ?? 0));
    const [topIntent, topScore] = scores[0] ?? (["HOW_TO", 0] as const);
    let intent: SupportIntent = topScore > 0 ? topIntent : hits(text, GREETINGS) > 0 && text.length <= 40 ? "GREETING" : "UNKNOWN";
    if (intent === "UNKNOWN" && ctx.order && topScore === 0) intent = "ORDER_STATUS";

    const cite = (slug?: string, title?: string): AssistantCitation[] => (slug ? [{ title: title ?? slug, ...(slug ? { policySlug: slug } : {}) }] : []);
    const snippetFor = (i: SupportIntent): KnowledgeSnippet | undefined => {
      const pool = ctx.knowledge.filter((k) => k.intents.includes(i));
      if (pool.length === 0) return undefined;
      return pool.map((k) => [k, hits(text, k.keywords)] as const).sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    const snippetBody = (k: KnowledgeSnippet) => (lang === "en" ? k.body.en : k.body.fr);

    // A reply the service can escalate on; the brain also sets `escalate` for its own judgement calls.
    const build = (answer: string, confidence: number, opts: { citations?: AssistantCitation[]; escalate?: boolean; action?: AssistantReply["action"] } = {}): AssistantReply => ({
      intent,
      confidence,
      answer,
      citations: opts.citations ?? [],
      action: opts.action ?? (opts.escalate ? { type: "ESCALATE" } : { type: "NONE" }),
      escalate: opts.escalate ?? false,
    });

    if (wantsHuman) {
      return build(
        L(lang, "Of course — I'm connecting you with a specialist from our team, who can see this conversation and your order. They'll follow up here.", "Bien sûr — je vous mets en relation avec un spécialiste de notre équipe, qui voit cette conversation et votre commande. Il vous répondra ici."),
        0.9, { escalate: true },
      );
    }

    switch (intent) {
      case "GREETING":
        return build(
          L(lang, `Hello${ctx.customerName ? " " + ctx.customerName : ""}! I'm the Tunakula assistant. I can check an order, explain a charge, help with a refund or answer a question. What do you need?`,
            `Bonjour${ctx.customerName ? " " + ctx.customerName : ""} ! Je suis l’assistant Tunakula. Je peux suivre une commande, expliquer des frais, aider pour un remboursement ou répondre à une question. Que puis-je faire ?`),
          0.7,
        );

      case "ORDER_STATUS": {
        if (!ctx.order) {
          return build(
            L(lang, "I can check that for you — open the order from “My orders” and ask again there, or tell me the order number. You can also message your rider directly once one is assigned.",
              "Je peux vérifier cela — ouvrez la commande depuis « Mes commandes » et reposez la question, ou donnez-moi le numéro de commande. Vous pouvez aussi écrire directement à votre livreur une fois qu’il est assigné."),
            0.5, { action: { type: "SHOW_ORDER" } },
          );
        }
        const o = ctx.order;
        const eta = o.etaMinutes ? L(lang, ` Estimated arrival is about ${o.etaMinutes} minutes.`, ` L’arrivée est estimée à environ ${o.etaMinutes} minutes.`) : "";
        return build(
          L(lang, `Your order${o.branchName ? " from " + o.branchName : ""} is currently ${prettyState(o.state, "en")}.${eta} You give your four-digit code at the door, and only then is it delivered.`,
            `Votre commande${o.branchName ? " de " + o.branchName : ""} est actuellement ${prettyState(o.state, "fr")}.${eta} Vous donnez votre code à quatre chiffres à la porte, et ce n’est qu’alors qu’elle est livrée.`),
          0.85, { citations: cite("terms", L(lang, "Terms of Use", "Terms of Use")), action: { type: "SHOW_ORDER" } },
        );
      }

      case "EXPLAIN_CHARGE": {
        const k = snippetFor("EXPLAIN_CHARGE");
        let lines = "";
        if (ctx.order?.serviceCharge) {
          lines = L(lang,
            ` On this order the service charge is ${fmt(ctx.order.serviceCharge)}${ctx.order.deliveryFee ? `, the delivery fee ${fmt(ctx.order.deliveryFee)}` : ""}, for a total of ${fmt(ctx.order.total)}.`,
            ` Sur cette commande, les frais de service sont de ${fmt(ctx.order.serviceCharge)}${ctx.order.deliveryFee ? `, les frais de livraison ${fmt(ctx.order.deliveryFee)}` : ""}, pour un total de ${fmt(ctx.order.total)}.`);
        }
        return build((k ? snippetBody(k) : "") + lines, 0.82, { citations: cite(k?.policySlug ?? "pricing", k?.title ?? "How pricing works") });
      }

      case "REFUND_OR_PROBLEM": {
        const k = snippetFor("REFUND_OR_PROBLEM");
        const base = k ? snippetBody(k) : "";
        if (ctx.order?.refundInFlight) {
          return build(
            base + L(lang, " Good news: your order already qualifies, so your refund is on its way automatically — no need to do anything.",
              " Bonne nouvelle : votre commande y est déjà éligible, votre remboursement est donc en route automatiquement — vous n’avez rien à faire."),
            0.8, { citations: cite(k?.policySlug ?? "refunds", k?.title ?? "Refunds and cancellations") },
          );
        }
        // A discretionary refund is a human judgement — never decided by the assistant.
        return build(
          base + L(lang, " I've flagged this to a specialist who can look at your order and make it right. They'll reply here shortly.",
            " J’ai transmis ceci à un spécialiste qui peut examiner votre commande et arranger les choses. Il vous répondra ici sous peu."),
          0.78, { citations: cite(k?.policySlug ?? "refunds", k?.title ?? "Refunds and cancellations"), escalate: true },
        );
      }

      case "HOW_TO":
      case "ACCOUNT_DATA":
      case "CHEF_BOOKING": {
        const k = snippetFor(intent);
        if (!k) break;
        return build(snippetBody(k), 0.75, { citations: cite(k.policySlug, k.title) });
      }
    }

    // Unknown, or an intent with no grounded snippet — hand to a human rather than guess.
    return build(
      L(lang, "I want to get this right rather than guess, so I'm passing you to a specialist from our team. They can see this conversation and will reply here shortly.",
        "Je préfère bien faire plutôt que deviner, je vous mets donc en relation avec un spécialiste de notre équipe. Il voit cette conversation et vous répondra ici sous peu."),
      0.3, { escalate: true },
    );
  }
}

const STATE_WORDS: Record<string, { en: string; fr: string }> = {
  PLACED: { en: "placed and waiting for the restaurant to accept", fr: "passée, en attente d’acceptation par le restaurant" },
  ACCEPTED: { en: "accepted by the restaurant", fr: "acceptée par le restaurant" },
  PREPARING: { en: "being prepared in the kitchen", fr: "en préparation en cuisine" },
  PACKED: { en: "packed and ready for pickup", fr: "emballée, prête pour l’enlèvement" },
  READY: { en: "ready", fr: "prête" },
  PICKED_UP: { en: "on its way with your rider", fr: "en route avec votre livreur" },
  DELIVERED: { en: "delivered", fr: "livrée" },
  CANCELLED: { en: "cancelled", fr: "annulée" },
  REJECTED: { en: "declined by the restaurant", fr: "refusée par le restaurant" },
  DELIVERY_FAILED: { en: "marked as a failed delivery", fr: "marquée comme livraison échouée" },
  REFUND_REQUESTED: { en: "under a refund review", fr: "en cours d’examen de remboursement" },
  REFUNDED: { en: "refunded", fr: "remboursée" },
  PENDING_PAYMENT: { en: "waiting for payment", fr: "en attente de paiement" },
  PAYMENT_FAILED: { en: "stopped on a failed payment — you can try another method", fr: "bloquée sur un paiement échoué — vous pouvez essayer un autre moyen" },
};
function prettyState(state: string, lang: "en" | "fr"): string {
  return STATE_WORDS[state]?.[lang] ?? (lang === "en" ? state.toLowerCase().replace(/_/g, " ") : state.toLowerCase().replace(/_/g, " "));
}
