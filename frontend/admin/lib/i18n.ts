/** Console wording: French first in the DRC, English available. Keys are stable; add a language by adding a column. */
export type Lang = "fr" | "en";

const T = {
  overview: { fr: "Tableau de bord", en: "Overview" },
  orders: { fr: "Commandes", en: "Orders" },
  kitchen: { fr: "Cuisine en direct", en: "Kitchen" },
  dispatch: { fr: "Dispatch en direct", en: "Live dispatch" },
  merchants: { fr: "Restaurants et commerces", en: "Merchants" },
  team: { fr: "Équipe et rôles", en: "Team and roles" },
  markets: { fr: "Marchés", en: "Markets" },
  finance: { fr: "Finance", en: "Finance" },
  payments: { fr: "Paiements", en: "Payments" },
  audit: { fr: "Journal d'audit", en: "Audit log" },
  g_operations: { fr: "Opérations", en: "Operations" },
  g_business: { fr: "Commerce", en: "Business" },
  g_money: { fr: "Argent", en: "Money" },
  g_platform: { fr: "Plateforme", en: "Platform" },
  soon: { fr: "bientôt", en: "soon" },
  pos: { fr: "Point de vente", en: "Point of sale" },
  zones: { fr: "Zones", en: "Zones" },
  promotions: { fr: "Promotions", en: "Promotions" },
  support: { fr: "Aide et soutien", en: "Support" },
  customers: { fr: "Clients", en: "Customers" },
  riders: { fr: "Livreurs et candidatures", en: "Riders and applications" },
  payouts: { fr: "Décaissements", en: "Payouts" },
  sign_out: { fr: "Se déconnecter", en: "Sign out" },
  last_n: { fr: "{n} derniers jours", en: "Last {n} days" },
  vs_prev: { fr: "vs période précédente", en: "vs previous period" },
  no_compare: { fr: "pas de période précédente comparable", en: "no comparable previous period" },
  table: { fr: "Tableau", en: "Table" },
  chart: { fr: "Graphique", en: "Chart" },
  // KPIs
  k_orders: { fr: "Commandes passées", en: "Orders placed" },
  k_gmv: { fr: "Valeur livrée", en: "Delivered value" },
  k_aov: { fr: "Panier moyen", en: "Average order" },
  k_delivered: { fr: "Taux de livraison", en: "Delivered rate" },
  k_lost: { fr: "Commandes perdues", en: "Lost orders" },
  k_customers: { fr: "Clients actifs", en: "Active customers" },
  // Charts
  c_orders_day: { fr: "Commandes par jour", en: "Orders per day" },
  c_orders_day_sub: { fr: "Livrées, perdues et en cours", en: "Delivered, lost and in progress" },
  c_gmv_day: { fr: "Valeur livrée par jour", en: "Delivered value per day" },
  c_customers: { fr: "Clients nouveaux et fidèles", en: "New and returning customers" },
  c_customers_sub: { fr: "Clients distincts par jour", en: "Distinct customers per day" },
  c_funnel: { fr: "Entonnoir de livraison", en: "Delivery funnel" },
  c_funnel_sub: { fr: "Commandes ayant atteint chaque étape", en: "Orders that reached each stage" },
  c_heat: { fr: "Heures de pointe", en: "Busy hours" },
  c_heat_sub: { fr: "Commandes par jour de semaine et heure locale", en: "Orders by weekday and local hour" },
  c_minutes: { fr: "Délai de livraison", en: "Delivery time" },
  c_minutes_sub: { fr: "Minutes entre commande payée et remise", en: "Minutes from paid order to handover" },
  c_mix: { fr: "Répartition", en: "Mix" },
  c_mix_sub: { fr: "Type de commande et mode de paiement", en: "Order type and payment mode" },
  c_top_merchants: { fr: "Meilleurs commerces", en: "Top merchants" },
  c_top_merchants_sub: { fr: "Valeur livrée", en: "Delivered value" },
  c_top_dishes: { fr: "Plats les plus vendus", en: "Best-selling dishes" },
  c_riders: { fr: "Meilleurs livreurs", en: "Top riders" },
  c_riders_sub: { fr: "Livraisons réussies", en: "Completed deliveries" },
  c_balances: { fr: "Soldes du grand livre", en: "Ledger balances" },
  c_balances_sub: { fr: "Débit à droite, crédit à gauche", en: "Debit right, credit left" },
  c_flows: { fr: "Montants crédités par jour", en: "Amounts credited per day" },
  c_flows_sub: { fr: "Commerces, livreurs et revenus de la plateforme", en: "Merchants, riders and platform revenue" },
  c_audit: { fr: "Actions auditées par jour", en: "Audited actions per day" },
  chain_ok: { fr: "Chaîne d'audit intacte", en: "Audit chain intact" },
  chain_broken: { fr: "Chaîne d'audit rompue à l'entrée", en: "Audit chain broken at entry" },
  delivered: { fr: "Livrées", en: "Delivered" },
  lost: { fr: "Perdues", en: "Lost" },
  in_progress: { fr: "En cours", en: "In progress" },
  new_c: { fr: "Nouveaux", en: "New" },
  returning_c: { fr: "Fidèles", en: "Returning" },
  median: { fr: "Médiane", en: "Median" },
  p90: { fr: "90e centile", en: "90th percentile" },
  whole_market: { fr: "Tout le marché", en: "Whole market" },
  your_branches: { fr: "Vos établissements", en: "Your branches" },
  nothing: { fr: "Rien à afficher pour cette période.", en: "Nothing to show for this period." },
  no_access: { fr: "Votre rôle ne donne pas accès à cette page dans ce marché.", en: "Your role does not give access to this page in this market." },
} as const;

export type Key = keyof typeof T;

export function translate(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = T[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Order states and other enum values, shown in the person's language. */
const STATES: Record<string, [string, string]> = {
  DRAFT: ["Brouillon", "Draft"], PENDING_PAYMENT: ["Paiement en attente", "Awaiting payment"], PAYMENT_FAILED: ["Paiement échoué", "Payment failed"],
  PLACED: ["Passée", "Placed"], ACCEPTED: ["Acceptée", "Accepted"], PREPARING: ["En préparation", "Preparing"], PACKED: ["Emballée", "Packed"],
  READY: ["Prête", "Ready"], PICKED_UP: ["En route", "Picked up"], DELIVERED: ["Livrée", "Delivered"], REFUND_REQUESTED: ["Remboursement demandé", "Refund requested"],
  REFUNDED: ["Remboursée", "Refunded"], REJECTED: ["Refusée", "Rejected"], CANCELLED: ["Annulée", "Cancelled"], DELIVERY_FAILED: ["Livraison échouée", "Delivery failed"],
  EXPIRED: ["Expirée", "Expired"], DELIVERY: ["Livraison", "Delivery"], TAKEAWAY: ["À emporter", "Takeaway"], DINE_IN: ["Sur place", "Dine-in"],
  SCHEDULED: ["Programmée", "Scheduled"], XBO: ["Repas offert", "Send home"], PREPAID: ["Payé en ligne", "Prepaid"], CASH_ON_DELIVERY: ["Espèces", "Cash"],
  MOBILE_MONEY_PUSH: ["Mobile money", "Mobile money"], SUCCEEDED: ["Réussi", "Succeeded"], FAILED: ["Échoué", "Failed"],
  PENDING_CUSTOMER_ACTION: ["Attente client", "Awaiting customer"], PROCESSING: ["En cours", "Processing"],
};
export const stateLabel = (lang: Lang, s: string) => STATES[s]?.[lang === "fr" ? 0 : 1] ?? s;

export const WEEKDAYS: Record<Lang, string[]> = {
  fr: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
