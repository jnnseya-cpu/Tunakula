/**
 * The assistant's grounding corpus: short, factual snippets drawn from the published policies, each citing the
 * policy slug the customer can open to read in full. The brain may quote these and must cite them; it never
 * invents facts beyond this corpus and the customer's own order. Bodies are authored in French (the market
 * default) and English; Lingála and Swahili answers fall back to French, as the storefront does.
 */
import type { KnowledgeSnippet } from "@tunakula/ts-contracts";

export const KNOWLEDGE: readonly KnowledgeSnippet[] = [
  {
    id: "service-charge",
    intents: ["EXPLAIN_CHARGE"],
    keywords: ["charge", "fee", "service", "10%", "why so much", "expensive", "frais", "service", "pourquoi", "cher", "commission"],
    title: "How pricing works",
    policySlug: "pricing",
    body: {
      en: "Restaurants pay Tunakula 0% commission, so the food keeps its counter price. Tunakula is funded by a 10% service charge, shown as its own line on your bill, plus a delivery fee set by distance. Food prices and the service charge are never raised for busy times and are never personalised to you.",
      fr: "Les restaurants ne paient aucune commission à Tunakula : le prix des plats reste celui du comptoir. Tunakula se finance par des frais de service de 10 %, affichés sur une ligne distincte, plus des frais de livraison selon la distance. Le prix des plats et les frais de service n’augmentent jamais aux heures de pointe et ne sont jamais personnalisés.",
    },
  },
  {
    id: "delivery-fee",
    intents: ["EXPLAIN_CHARGE", "HOW_TO"],
    keywords: ["delivery fee", "livraison", "distance", "rider fee", "weather", "météo"],
    title: "How pricing works",
    policySlug: "pricing",
    body: {
      en: "The delivery fee is set by distance. A higher fee in bad weather or at busy times is shown, with the reason, before you pay. The rider keeps 70% of the delivery fee and all of your tip.",
      fr: "Les frais de livraison dépendent de la distance. Des frais plus élevés par mauvais temps ou aux heures de pointe sont indiqués, avec la raison, avant le paiement. Le livreur conserve 70 % des frais de livraison et la totalité de votre pourboire.",
    },
  },
  {
    id: "refunds",
    intents: ["REFUND_OR_PROBLEM"],
    keywords: ["refund", "money back", "remboursement", "rembourser", "missing", "manquant", "cold", "froid", "wrong", "mauvais", "late", "retard", "failed", "échec", "cancel"],
    title: "Refunds and cancellations",
    policySlug: "refunds",
    body: {
      en: "You can cancel free of charge until the restaurant accepts the order. If a delivery fails or an item is missing, you are refunded automatically — to your wallet instantly, or back to your card or mobile money. Anything that needs a judgement call is handled by a specialist.",
      fr: "Vous pouvez annuler gratuitement tant que le restaurant n’a pas accepté la commande. Si une livraison échoue ou qu’un article manque, vous êtes remboursé automatiquement — sur votre portefeuille immédiatement, ou sur votre carte ou mobile money. Tout cas nécessitant une appréciation est traité par un spécialiste.",
    },
  },
  {
    id: "handover-code",
    intents: ["HOW_TO", "ORDER_STATUS"],
    keywords: ["code", "door", "porte", "handover", "receive", "recevoir", "pin"],
    title: "Terms of Use",
    policySlug: "terms",
    body: {
      en: "Give the rider your four-digit code at the door — the order is not complete until the code is confirmed, so your food reaches you and not a neighbour. Gifts and high-value orders always require the recipient's code.",
      fr: "Donnez votre code à quatre chiffres au livreur à la porte — la commande n’est complète qu’une fois le code confirmé, pour que votre repas vous parvienne à vous et non à un voisin. Les cadeaux et les commandes de grande valeur exigent toujours le code du destinataire.",
    },
  },
  {
    id: "paying",
    intents: ["HOW_TO"],
    keywords: ["pay", "payer", "mobile money", "m-pesa", "orange", "airtel", "card", "carte", "cash", "wallet", "portefeuille"],
    title: "Terms of Use",
    policySlug: "terms",
    body: {
      en: "Pay with mobile money (M-Pesa, Orange Money, Airtel Money), card, your Tunakula wallet, or — where approved — cash on delivery. You see every line and the total before you approve. Licensed partners collect and settle payments; Tunakula never holds your money.",
      fr: "Payez par mobile money (M-Pesa, Orange Money, Airtel Money), carte, votre portefeuille Tunakula ou — là où c’est autorisé — en espèces à la livraison. Vous voyez chaque ligne et le total avant d’approuver. Des partenaires agréés encaissent et reversent les paiements ; Tunakula ne détient jamais votre argent.",
    },
  },
  {
    id: "data",
    intents: ["ACCOUNT_DATA"],
    keywords: ["data", "privacy", "données", "confidentialité", "delete", "supprimer", "account", "compte", "personal"],
    title: "Privacy",
    policySlug: "privacy",
    body: {
      en: "You can see and export your data, and delete your account, from the app. Some records (such as receipts and ledger entries) are kept as long as the law requires. See the Privacy policy, or write to info@tunakula.com for a data request.",
      fr: "Vous pouvez consulter et exporter vos données, et supprimer votre compte, depuis l’application. Certaines informations (comme les reçus et les écritures comptables) sont conservées aussi longtemps que la loi l’exige. Consultez la politique de confidentialité, ou écrivez à info@tunakula.com pour une demande relative à vos données.",
    },
  },
  {
    id: "allergens",
    intents: ["HOW_TO", "REFUND_OR_PROBLEM"],
    keywords: ["allergy", "allergen", "allergie", "allergène", "halal", "vegan", "vegetarian", "nuts", "arachide"],
    title: "Allergens and food safety",
    policySlug: "food-safety",
    body: {
      en: "Allergen and dietary tags come from the restaurant and are shown before you add an item. Set an allergy as a requirement, not a note — the kitchen must acknowledge it, label the order and pack it separately. Report any reaction and it is investigated every time.",
      fr: "Les étiquettes d’allergènes et de régime proviennent du restaurant et sont affichées avant l’ajout d’un article. Indiquez une allergie comme une exigence, pas comme une note — la cuisine doit la confirmer, étiqueter la commande et l’emballer séparément. Signalez toute réaction : elle est examinée à chaque fois.",
    },
  },
  {
    id: "chef",
    intents: ["CHEF_BOOKING"],
    keywords: ["chef", "book a chef", "booking", "réserver", "cuisinier", "private dining", "meal prep", "class", "consultation"],
    title: "Book a chef",
    policySlug: "chef-terms",
    body: {
      en: "Book an approved private chef for a dinner, meal prep, an event, a class or a consultation. You see the full quote first — the chef's fee plus a 10% service charge — and the chef keeps 100% of their fee. A booking is final only once the chef accepts it; nothing is owed on a declined request.",
      fr: "Réservez un chef privé agréé pour un dîner, de la préparation de repas, un événement, un cours ou une consultation. Vous voyez d’abord le devis complet — les honoraires du chef plus des frais de service de 10 % — et le chef conserve 100 % de ses honoraires. Une réservation n’est définitive qu’une fois acceptée par le chef ; rien n’est dû sur une demande refusée.",
    },
  },
  {
    id: "send-home",
    intents: ["HOW_TO", "CHEF_BOOKING"],
    keywords: ["send home", "abroad", "diaspora", "envoyer", "étranger", "gift", "cadeau", "london", "paris"],
    title: "Sending a meal home",
    policySlug: "send-home-terms",
    body: {
      en: "From abroad you can pay for a meal delivered to someone in a Tunakula market. The exchange rate and our margin are shown before you pay and held while you pay. The recipient confirms with a code, and you get the photo.",
      fr: "Depuis l’étranger, vous pouvez payer un repas livré à un proche dans un marché Tunakula. Le taux de change et notre marge sont affichés avant le paiement et bloqués pendant le paiement. Le destinataire confirme avec un code, et vous recevez la photo.",
    },
  },
];

/** Words that signal the customer wants a human regardless of intent (safety, legal, strong dissatisfaction). */
export const HUMAN_WANTED = ["human", "agent", "person", "complaint", "complain", "humain", "personne", "réclamation", "plainte", "lawyer", "avocat", "police", "sue", "manager"];
