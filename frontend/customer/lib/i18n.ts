/**
 * Storefront languages. Kinshasa is francophone, so French is the default; English, Lingála and Kiswahili are
 * selectable. The choice is resolved once per page load (saved choice → browser language → French) and applied by
 * reloading on switch — the same pattern as the market switcher — so no provider plumbing is needed and a static
 * export stays simple. Dish names localise separately through the API's per-language `names`.
 */
export type Lang = "fr" | "en" | "ln" | "sw";
export const LANGS: { readonly code: Lang; readonly label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "ln", label: "Lingála" },
  { code: "sw", label: "Kiswahili" },
];
const DEFAULT: Lang = "fr";
const KEY = "tk-lang";

function isLang(v: string | null | undefined): v is Lang { return v === "fr" || v === "en" || v === "ln" || v === "sw"; }

export function resolveLang(): Lang {
  if (typeof window === "undefined") return DEFAULT;
  try { const o = localStorage.getItem(KEY); if (isLang(o)) return o; } catch { /* storage blocked */ }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "").slice(0, 2).toLowerCase();
  return isLang(nav) ? nav : DEFAULT;
}

let _lang: Lang | null = null;
export function lang(): Lang { return (_lang ??= resolveLang()); }

export function setLang(code: Lang): void {
  try { localStorage.setItem(KEY, code); } catch { /* storage blocked */ }
  if (typeof window !== "undefined") window.location.reload();
}

/** Translate a key into a specific language, with {var} interpolation; falls back to English then the key. */
export function translate(key: string, l: Lang, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let s = entry ? (entry[l] ?? entry.en ?? key) : key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
  return s;
}

/** Translate a key for the active (module-resolved) language. Use the `useT` hook inside components that must
 * re-render when the viewer switches language on a statically-exported page; use this for one-shot client reads. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(key, lang(), vars);
}

type Entry = Partial<Record<Lang, string>> & { en: string };
const DICT: Record<string, Entry> = {
  // ── Top navigation & common chrome ──
  "nav.deliverTo": { en: "Deliver to", fr: "Livrer à", ln: "Kotinda na", sw: "Peleka kwa" },
  "nav.search": { en: "Search food or restaurants", fr: "Chercher un plat ou un restaurant", ln: "Luka bilei to bandako ya kolia", sw: "Tafuta chakula au mgahawa" },
  "nav.myOrders": { en: "My orders", fr: "Mes commandes", ln: "Komande na ngai", sw: "Oda zangu" },
  "nav.orderNow": { en: "Order now", fr: "Commander", ln: "Komanda sikoyo", sw: "Agiza sasa" },
  "nav.signIn": { en: "Sign in", fr: "Se connecter", ln: "Kokota", sw: "Ingia" },
  "nav.signOut": { en: "Sign out", fr: "Se déconnecter", ln: "Kobima", sw: "Toka" },
  // ── Main nav links ──
  "nav.restaurants": { en: "Restaurants", fr: "Restaurants", ln: "Bandako ya kolia", sw: "Migahawa" },
  "nav.plus": { en: "Tunakula Plus", fr: "Tunakula Plus", ln: "Tunakula Plus", sw: "Tunakula Plus" },
  "nav.sendHome": { en: "Send a meal home", fr: "Envoyer un repas", ln: "Tindela bandeko bilei", sw: "Tuma mlo nyumbani" },
  "nav.forRestaurants": { en: "For restaurants", fr: "Pour les restaurants", ln: "Mpo na bandako ya kolia", sw: "Kwa migahawa" },
  "nav.ride": { en: "Ride with us", fr: "Devenez livreur", ln: "Sala motindi na biso", sw: "Kuwa dereva" },
  // ── Bottom tab bar ──
  "tab.home": { en: "Home", fr: "Accueil", ln: "Ndako", sw: "Nyumbani" },
  "tab.explore": { en: "Explore", fr: "Explorer", ln: "Luka", sw: "Gundua" },
  "tab.sendHome": { en: "Send home", fr: "Envoyer", ln: "Tinda", sw: "Tuma" },
  "tab.orders": { en: "Orders", fr: "Commandes", ln: "Komande", sw: "Oda" },
  // ── Footer: column titles & tagline ──
  "foot.order": { en: "Order", fr: "Commander", ln: "Komanda", sw: "Agiza" },
  "foot.partners": { en: "Partners", fr: "Partenaires", ln: "Baninga ya mosala", sw: "Washirika" },
  "foot.trust": { en: "Trust", fr: "Confiance", ln: "Bondimi", sw: "Uaminifu" },
  "foot.company": { en: "Company", fr: "Entreprise", ln: "Kompani", sw: "Kampuni" },
  "foot.tagline": { en: "Tunakula — get to eat. A Groupe Nseya company. Payments are collected and settled by licensed partners; Tunakula never holds your money.", fr: "Tunakula — à table. Une société du Groupe Nseya. Les paiements sont encaissés et reversés par des partenaires agréés ; Tunakula ne détient jamais votre argent.", ln: "Tunakula — tolia. Kompani ya Groupe Nseya. Mbongo ezali kozwama mpe kofutama na baninga ya ndingisa ; Tunakula asimbaka mbongo na yo te.", sw: "Tunakula — karibu kula. Kampuni ya Groupe Nseya. Malipo yanakusanywa na kulipwa na washirika walio na leseni; Tunakula haishiki pesa zako." },
  "common.change": { en: "Change", fr: "Changer", ln: "Kobongola", sw: "Badilisha" },
  "common.open": { en: "Open", fr: "Ouvert", ln: "Efungwami", sw: "Imefunguliwa" },
  "common.closedNow": { en: "Closed now", fr: "Fermé", ln: "Ekangami", sw: "Imefungwa" },
  "common.min": { en: "min", fr: "min", ln: "min", sw: "dak" },
  "common.km": { en: "km", fr: "km", ln: "km", sw: "km" },
  "common.add": { en: "Add", fr: "Ajouter", ln: "Kobakisa", sw: "Ongeza" },
  "common.loading": { en: "Loading…", fr: "Chargement…", ln: "Ezali kozela…", sw: "Inapakia…" },
  "common.soldOut": { en: "Sold out", fr: "Épuisé", ln: "Esili", sw: "Imeisha" },
  // ── Discovery (/order) ──
  "disc.hungry": { en: "What are you hungry for?", fr: "De quoi avez-vous envie ?", ln: "Olingi kolia nini ?", sw: "Una njaa ya nini?" },
  "disc.nearYou": { en: "Near you", fr: "Près de vous", ln: "Pene na yo", sw: "Karibu nawe" },
  "disc.groceries": { en: "Groceries & essentials", fr: "Épicerie & essentiels", ln: "Biloko ya ndako", sw: "Vyakula na mahitaji" },
  "disc.groceriesSub": { en: "Supermarkets, convenience stores and pharmacies delivering near you.", fr: "Supermarchés, supérettes et pharmacies qui livrent près de vous.", ln: "Ba supermarché, ba magazini mpe ba farmasi oyo ezali kotinda pene na yo.", sw: "Maduka makubwa, maduka ya karibu na maduka ya dawa yanayowasilisha karibu nawe." },
  "disc.featured": { en: "Featured", fr: "En vedette", ln: "Elakisami", sw: "Iliyoangaziwa" },
  "disc.eyebrow": { en: "delivering now · distances by road from your location", fr: "livraison en cours · distances par la route depuis votre position", ln: "kotinda sikoyo · ntaka na nzela banda esika ozali", sw: "tunawasilisha sasa · umbali kwa barabara kutoka mahali ulipo" },
  // ── Store-kind filter chips ──
  "filter.everything": { en: "Everything", fr: "Tout", ln: "Nyonso", sw: "Vyote" },
  "filter.restaurants": { en: "Restaurants", fr: "Restaurants", ln: "Bandako ya kolia", sw: "Migahawa" },
  "filter.grills": { en: "Grills", fr: "Grillades", ln: "Ba grillades", sw: "Choma" },
  "filter.malewa": { en: "Malewa", fr: "Malewa", ln: "Malewa", sw: "Malewa" },
  "filter.bakeries": { en: "Bakeries", fr: "Boulangeries", ln: "Ba boulangerie", sw: "Mikate" },
  "filter.groceries": { en: "Groceries", fr: "Épicerie", ln: "Magazini", sw: "Vyakula" },
  // ── Store page ──
  "store.yourOrder": { en: "Your order", fr: "Votre commande", ln: "Komande na yo", sw: "Oda yako" },
  "store.emptyHint": { en: "Tap + on a dish to add it.", fr: "Touchez + sur un plat pour l'ajouter.", ln: "Finá + na bilei mpo na kobakisa.", sw: "Gusa + kwenye chakula kukiongeza." },
  "store.checkout": { en: "Go to checkout", fr: "Passer à la caisse", ln: "Kende na kofuta", sw: "Nenda kulipa" },
  "store.choices": { en: "Choices available", fr: "Choix disponibles", ln: "Baponi ezali", sw: "Chaguo zipo" },
  // ── Checkout ──
  "co.title": { en: "Checkout", fr: "Paiement", ln: "Kofuta", sw: "Malipo" },
  "co.delivery": { en: "Delivery", fr: "Livraison", ln: "Kotinda", sw: "Uwasilishaji" },
  "co.takeaway": { en: "Collect it", fr: "À emporter", ln: "Kozwa yango", sw: "Jichukulie" },
  "co.payWith": { en: "Pay with", fr: "Payer avec", ln: "Futa na", sw: "Lipa kwa" },
  "co.placeOrder": { en: "Place order", fr: "Commander", ln: "Komanda", sw: "Weka oda" },
  "co.total": { en: "Total", fr: "Total", ln: "Motuya mobimba", sw: "Jumla" },
  "co.whereTo": { en: "Where to?", fr: "Où livrer ?", ln: "Esika nini ?", sw: "Wapi?" },
  // ── Order tracking / history ──
  "track.yourOrders": { en: "My orders", fr: "Mes commandes", ln: "Komande na ngai", sw: "Oda zangu" },
  "track.orderAgain": { en: "Order again", fr: "Commander à nouveau", ln: "Komanda lisusu", sw: "Agiza tena" },
  "track.noOrders": { en: "No orders yet.", fr: "Pas encore de commande.", ln: "Komande ezali naino te.", sw: "Bado hakuna oda." },
  // ── Push opt-in ──
  "push.title": { en: "Order updates on your phone", fr: "Suivi de commande sur votre téléphone", ln: "Sango ya komande na telefone na yo", sw: "Taarifa za oda kwenye simu yako" },
  "push.body": { en: "Get a notification when the kitchen accepts your order, when your rider sets off, and when it's at your door.", fr: "Recevez une notification quand la cuisine accepte votre commande, quand votre livreur part, et quand c'est à votre porte.", ln: "Zwá sango tango kuizine endimi komande na yo, tango motindi akei, mpe tango ekomi na porte na yo.", sw: "Pokea arifa pale jiko linapokubali oda yako, dereva anapoondoka, na inapofika mlangoni." },
};
