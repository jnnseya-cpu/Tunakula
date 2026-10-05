/**
 * GENERATED FILE — do not edit by hand.
 * Real Tunakula RDC storefronts, imported from the live cd.tunakula.com catalogue on 2026-10-05.
 * Names, descriptions, menus, logos, covers and dish photos are the restaurants' own.
 * Prices are the restaurants' US-dollar menus, converted to Congolese francs at the live rate
 * below and rounded to the nearest 100 FC. Rebuild with:
 *   npm run fx:update       -w @tunakula/web-customer   (fetch a free live USD->CDF rate)
 *   npm run catalogue:build -w @tunakula/web-customer   (re-rate and rewrite this file)
 * At launch the same components read the live catalogue from the API (GET /v1/branches/{id}/menu).
 */
import type { Recipe } from "../components/plate";

/** USD -> CDF rate used for the prices below. Source: fallback (run `npm run fx:update` to fetch a live free rate); as of 2026-10-05. */
export const USD_TO_CDF = 2850;

export type MerchantKind = "Restaurant" | "Grill" | "Malewa" | "Bakery" | "Grocery";

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Congolese francs, whole francs (the kitchen's counter price). */
  readonly price: number;
  readonly recipe: Recipe;
  readonly tags?: readonly ("Popular" | "Spicy" | "Vegan" | "Vegetarian" | "Halal" | "New")[];
  readonly allergens?: readonly string[];
  /** For shops: the unit sold. */
  readonly unit?: string;
}

export interface Merchant {
  readonly slug: string;
  readonly name: string;
  readonly kind: MerchantKind;
  readonly cuisine: string;
  readonly commune: string;
  readonly landmark: string;
  readonly hours: string;
  readonly rating: number;
  readonly ratings: number;
  readonly location: { readonly lat: number; readonly lng: number };
  readonly prep: number;
  readonly monogram: string;
  readonly tone: { readonly bg: string; readonly fg: string; readonly accent: string };
  readonly cover: readonly [Recipe, Recipe, Recipe];
  readonly about: string;
  readonly menu: readonly { readonly section: string; readonly items: readonly MenuItem[] }[];
}

export const MERCHANTS: readonly Merchant[] = [
  {
    slug: "lagrace-cuisine",
    name: "Lagrâce Cuisine",
    kind: "Restaurant",
    cuisine: "Cuisine Kinoise, Cuisine Européenne",
    commune: "Gombe",
    landmark: "Avenue bourgmestre N4384 ,blvd 30 juin derrière waikiki gombe.kinshasha -rdcongo",
    hours: "07:00 – 20:00",
    rating: 5,
    ratings: 2,
    location: { lat: -4.309795, lng: 15.291984 },
    prep: 18,
    monogram: "LC",
    tone: { bg: "#7e2a10", fg: "#fbefe4", accent: "#e9a24a" },
    cover: ["poisson", "fruits", "brochettes"],
    about: "Restaurant",
    menu: [
      {
        section: "Biloko Ya Mboka",
        items: [
          { id: "lagrace-cuisine--2389", name: "Poisson fumé aux champignons", description: "", price: 25500, recipe: "poisson" },
          { id: "lagrace-cuisine--2384", name: "Liboke", description: "", price: 2900, recipe: "liboke" },
        ],
      },
      {
        section: "Légumes",
        items: [
          { id: "lagrace-cuisine--2388", name: "Salade de haricot vert et thon", description: "", price: 31900, recipe: "poisson" },
          { id: "lagrace-cuisine--2387", name: "Salade de pomme de terre et ton", description: "", price: 16000, recipe: "fruits" },
          { id: "lagrace-cuisine--2383", name: "Salade de choix aux landons", description: "", price: 19200, recipe: "fruits", tags: ["Popular"] },
        ],
      },
      {
        section: "Shawarma",
        items: [
          { id: "lagrace-cuisine--2386", name: "Wrap au poulet fromage", description: "", price: 16000, recipe: "brochettes", tags: ["Popular"] },
          { id: "lagrace-cuisine--318", name: "Mackloub Chawarma", description: "", price: 16000, recipe: "poisson", tags: ["Popular"] },
        ],
      },
      {
        section: "Congolaise",
        items: [
          { id: "lagrace-cuisine--2385", name: "Haricot avec poisson fumé", description: "", price: 12800, recipe: "poisson" },
          { id: "lagrace-cuisine--306", name: "Ngulu à la congolaise", description: "", price: 38300, recipe: "poisson" },
        ],
      },
      {
        section: "Fruits",
        items: [
          { id: "lagrace-cuisine--329", name: "Salade César", description: "", price: 16000, recipe: "fruits" },
          { id: "lagrace-cuisine--328", name: "Salade Mixte", description: "", price: 31900, recipe: "fruits" },
        ],
      },
      {
        section: "Hamburgers",
        items: [
          { id: "lagrace-cuisine--327", name: "Croissant aux beurre et dinde", description: "", price: 16000, recipe: "pain", tags: ["Popular"] },
          { id: "lagrace-cuisine--326", name: "Charcuterie et Fromage", description: "", price: 19200, recipe: "pain" },
          { id: "lagrace-cuisine--324", name: "Croque Madame", description: "", price: 16000, recipe: "pain" },
          { id: "lagrace-cuisine--323", name: "Croque monsieur", description: "", price: 16000, recipe: "pain", tags: ["Popular"] },
          { id: "lagrace-cuisine--322", name: "Sandwich Fromage et Dinde", description: "", price: 19200, recipe: "pain", tags: ["Popular"] },
          { id: "lagrace-cuisine--321", name: "Sandwich Fromage", description: "", price: 16000, recipe: "pain" },
          { id: "lagrace-cuisine--320", name: "Sandwich Thon", description: "", price: 16000, recipe: "poisson", tags: ["Popular"] },
          { id: "lagrace-cuisine--319", name: "Club Sandwich", description: "", price: 16000, recipe: "pain" },
        ],
      },
      {
        section: "Frites",
        items: [
          { id: "lagrace-cuisine--325", name: "Burger + Frites", description: "", price: 16000, recipe: "pain" },
        ],
      },
      {
        section: "Barbecue",
        items: [
          { id: "lagrace-cuisine--317", name: "Brochette de Poulet", description: "", price: 19200, recipe: "brochettes" },
          { id: "lagrace-cuisine--308", name: "Saucisse fraiche", description: "", price: 22300, recipe: "poisson" },
          { id: "lagrace-cuisine--304", name: "Brochette de bœuf", description: "", price: 31900, recipe: "brochettes", tags: ["Popular"] },
        ],
      },
      {
        section: "Africain",
        items: [
          { id: "lagrace-cuisine--316", name: "Cuisse de poulet désossé", description: "", price: 16000, recipe: "brochettes", tags: ["Popular"] },
          { id: "lagrace-cuisine--315", name: "Poulet entier rôtie au four", description: "", price: 25500, recipe: "brochettes" },
          { id: "lagrace-cuisine--314", name: "Poisson du chef (selon la disponibilité)", description: "", price: 38300, recipe: "poisson" },
          { id: "lagrace-cuisine--313", name: "Poisson salé aux choux et carotte", description: "", price: 22300, recipe: "poisson" },
          { id: "lagrace-cuisine--311", name: "Tranché de capitaine frit (pane)", description: "", price: 31900, recipe: "poisson", tags: ["Popular"] },
          { id: "lagrace-cuisine--309", name: "Queue de bœuf à la sauce tomate", description: "", price: 25500, recipe: "poisson", tags: ["Popular"] },
          { id: "lagrace-cuisine--305", name: "Triple de bœuf", description: "", price: 35100, recipe: "poisson" },
          { id: "lagrace-cuisine--303", name: "Ragout de bœuf", description: "", price: 38300, recipe: "poisson", tags: ["Popular"] },
          { id: "lagrace-cuisine--302", name: "Chèvre à la sauce chocolat", description: "", price: 47900, recipe: "poisson" },
          { id: "lagrace-cuisine--301", name: "Soupe vermicelle", description: "", price: 19200, recipe: "poisson" },
          { id: "lagrace-cuisine--300", name: "Soupe de poulet", description: "", price: 31900, recipe: "brochettes" },
          { id: "lagrace-cuisine--299", name: "Soupe de viandé", description: "", price: 31900, recipe: "poisson" },
          { id: "lagrace-cuisine--296", name: "Soupe aux légumes maison", description: "", price: 16000, recipe: "poisson" },
          { id: "lagrace-cuisine--293", name: "Cossa Cossa à l'ail", description: "", price: 47900, recipe: "poisson" },
        ],
      },
      {
        section: "Biloko Ya Kotumba",
        items: [
          { id: "lagrace-cuisine--312", name: "Poisson fumé aux aubergines sauvage", description: "", price: 19200, recipe: "poisson" },
        ],
      },
      {
        section: "Mexicain",
        items: [
          { id: "lagrace-cuisine--310", name: "Émincé de bœuf aux champignons", description: "", price: 41500, recipe: "poisson", tags: ["Popular"] },
          { id: "lagrace-cuisine--307", name: "Côtelette de porc", description: "", price: 31900, recipe: "brochettes", tags: ["Popular"] },
        ],
      },
      {
        section: "Emporter",
        items: [
          { id: "lagrace-cuisine--298", name: "Rouleau de printemps aux légumes", description: "", price: 19200, recipe: "jus" },
          { id: "lagrace-cuisine--297", name: "Boulette de boeuf", description: "", price: 25500, recipe: "brochettes" },
          { id: "lagrace-cuisine--295", name: "Samoussa pomme de terre", description: "", price: 19200, recipe: "fruits" },
          { id: "lagrace-cuisine--294", name: "Samoussa viandé", description: "", price: 19200, recipe: "poisson" },
        ],
      },
    ],
  },
  {
    slug: "bins-restaurant",
    name: "Bin's Restaurant",
    kind: "Restaurant",
    cuisine: "Cuisine Africaine",
    commune: "Kinshasa",
    landmark: "Cité mama mobutu, Av: de l'église, Villa 101, Mont-Ngafula",
    hours: "09:00 – 18:00",
    rating: 0,
    ratings: 0,
    location: { lat: -4.415038, lng: 15.246056 },
    prep: 18,
    monogram: "BR",
    tone: { bg: "#1f5a50", fg: "#eef6f2", accent: "#f2b84b" },
    cover: ["brochettes", "poisson", "riz"],
    about: "Restaurant Rooftop",
    menu: [
      {
        section: "Barbecue",
        items: [
          { id: "bins-restaurant--2382", name: "Brochette de bœuf", description: "Banane & Chikwange", price: 31900, recipe: "brochettes" },
          { id: "bins-restaurant--2381", name: "Brochette de Poulet", description: "Chikwange & Frites 🍟", price: 25500, recipe: "brochettes" },
        ],
      },
      {
        section: "Mexicain",
        items: [
          { id: "bins-restaurant--2379", name: "Cotise de bœuf", description: "", price: 28800, recipe: "poisson" },
          { id: "bins-restaurant--2378", name: "Riz Cantonnais", description: "", price: 33300, recipe: "riz", tags: ["Popular"] },
        ],
      },
      {
        section: "Nigérian",
        items: [
          { id: "bins-restaurant--2377", name: "Riz Djolof Au Poulet", description: "", price: 31900, recipe: "brochettes" },
        ],
      },
      {
        section: "Shawarma",
        items: [
          { id: "bins-restaurant--2376", name: "Shawarma + Boisson", description: "", price: 15100, recipe: "jus", tags: ["Popular"] },
        ],
      },
      {
        section: "Patisserie",
        items: [
          { id: "bins-restaurant--2375", name: "Crêpes au chocolat + Boissons", description: "", price: 31900, recipe: "jus", tags: ["Popular"] },
        ],
      },
    ],
  },
  {
    slug: "nickyb-ets",
    name: "NickyB ETS",
    kind: "Restaurant",
    cuisine: "Cuisine Kinoise, Cuisine Ngala, Cuisine kongo, Cuisine Luba, Cuisine Swahili",
    commune: "Kasa-Vubu",
    landmark: "Djolu No 22 , Kasa-Vubu",
    hours: "09:00 – 23:00",
    rating: 0,
    ratings: 0,
    location: { lat: -4.343114, lng: 15.310016 },
    prep: 18,
    monogram: "NE",
    tone: { bg: "#27402a", fg: "#eef0e2", accent: "#d9b24a" },
    cover: ["beignets", "poisson", "riz"],
    about: "Cuisine Kinoise, Cuisine Ngala, Cuisine kongo, Cuisine Luba, Cuisine Swahili — Djolu No 22 , Kasa-Vubu.",
    menu: [
      {
        section: "Accompa",
        items: [
          { id: "nickyb-ets--1118", name: "Sachez Sucre", description: "Sachez Sucre", price: 21300, recipe: "beignets" },
          { id: "nickyb-ets--1116", name: "Riz 25kg", description: "Riz 25kg", price: 95300, recipe: "riz" },
          { id: "nickyb-ets--1115", name: "Semoule 25kg", description: "Semoule 25kg", price: 93400, recipe: "poisson" },
          { id: "nickyb-ets--1113", name: "FRITE FRAICHE CRUE", description: "Carton FRITE FRAICHE CRUE", price: 104700, recipe: "poisson" },
        ],
      },
      {
        section: "Milk",
        items: [
          { id: "nickyb-ets--1117", name: "Lait Nido 900g", description: "Lait Nido 900g \r\nLait Nido 1800g", price: 49500, recipe: "poisson" },
        ],
      },
      {
        section: "Huile",
        items: [
          { id: "nickyb-ets--1114", name: "Huile 5L", description: "Huile 5L", price: 40800, recipe: "poisson" },
        ],
      },
      {
        section: "Vivres Frais",
        items: [
          { id: "nickyb-ets--1112", name: "Viande de Porc", description: "Carton Viande de Porc", price: 144800, recipe: "brochettes", tags: ["Popular"] },
          { id: "nickyb-ets--1111", name: "Croupions de Dinde", description: "Carton Croupions de Dinde", price: 99700, recipe: "poisson" },
          { id: "nickyb-ets--1110", name: "Poulet Nu Azur", description: "Carton Poulet Nu Azur", price: 87200, recipe: "brochettes", tags: ["Popular"] },
          { id: "nickyb-ets--1109", name: "Poulet Nu Calissa", description: "Carton Poulet Nu Calissa", price: 93400, recipe: "brochettes" },
          { id: "nickyb-ets--1108", name: "Wilki P11", description: "Carton Wilki P11", price: 147300, recipe: "poisson", tags: ["Popular"] },
          { id: "nickyb-ets--1107", name: "Wilki P10", description: "Carton Wilki P10", price: 122900, recipe: "poisson" },
          { id: "nickyb-ets--1106", name: "Poulet à Rotir", description: "Carton Poulet à Rotir", price: 181200, recipe: "brochettes", tags: ["Popular"] },
          { id: "nickyb-ets--1105", name: "Makoso", description: "Carton Makoso", price: 66500, recipe: "poisson" },
          { id: "nickyb-ets--1104", name: "Cotis de Porc (Mipanzi)", description: "Carton Cotis de Porc (Mipanzi)", price: 153000, recipe: "brochettes", tags: ["Popular"] },
          { id: "nickyb-ets--1103", name: "Gésier", description: "Carton Gésier", price: 87800, recipe: "poisson" },
          { id: "nickyb-ets--1102", name: "Cuisse à Bouillir", description: "Carton Cuisse à Bouillir", price: 90900, recipe: "poisson", tags: ["Popular"] },
          { id: "nickyb-ets--1101", name: "Cuisse à Rôtir", description: "Carton Cuisse à Rôtir", price: 82800, recipe: "poisson" },
          { id: "nickyb-ets--1100", name: "Mikila", description: "Carton Mikila", price: 203100, recipe: "poisson", tags: ["Popular"] },
          { id: "nickyb-ets--1099", name: "Tripe ( Mabumu)", description: "Carton Tripe", price: 100300, recipe: "poisson" },
          { id: "nickyb-ets--1098", name: "Foie", description: "Carton Foie", price: 86500, recipe: "poisson" },
          { id: "nickyb-ets--1097", name: "Makayabu", description: "Carton Makayabu", price: 313500, recipe: "poisson" },
          { id: "nickyb-ets--1096", name: "Poumon", description: "Carton Poumon", price: 72700, recipe: "poisson", tags: ["Popular"] },
          { id: "nickyb-ets--1095", name: "Rognon", description: "Carton Rognon", price: 75200, recipe: "poisson" },
          { id: "nickyb-ets--1092", name: "Mbanga Ngombe", description: "Carton Mbanga", price: 95300, recipe: "poisson" },
          { id: "nickyb-ets--1091", name: "Makayabu", description: "1Kg Makayabu", price: 31400, recipe: "poisson", tags: ["Popular"] },
          { id: "nickyb-ets--1090", name: "Carton Mungusu", description: "Carton Mungusu", price: 98400, recipe: "poisson" },
          { id: "nickyb-ets--1075", name: "Carton Malua", description: "Carton Malua", price: 223200, recipe: "poisson" },
          { id: "nickyb-ets--1074", name: "Carton Malangwa", description: "Carton Malangwa", price: 81500, recipe: "poisson" },
          { id: "nickyb-ets--1070", name: "Carton Tilapia", description: "Carton Tilapia", price: 90300, recipe: "poisson" },
          { id: "nickyb-ets--1068", name: "Rame poisson 20+", description: "Rame poisson 20+", price: 87800, recipe: "poisson" },
        ],
      },
    ],
  },
  {
    slug: "tacos-land",
    name: "Tacos Land",
    kind: "Restaurant",
    cuisine: "Cuisine Européenne",
    commune: "Lingwala",
    landmark: "280, Avenue kalembe-Lembe  C.Lingwala, Réf: Maiison communale de lingwala",
    hours: "11:00 – 18:00",
    rating: 0,
    ratings: 0,
    location: { lat: -4.32607, lng: 15.296808 },
    prep: 18,
    monogram: "TL",
    tone: { bg: "#2a1d16", fg: "#f3e6d6", accent: "#e0643a" },
    cover: ["brochettes", "pain", "poisson"],
    about: "Fast-food",
    menu: [
      {
        section: "Tacos",
        items: [
          { id: "tacos-land--2371", name: "Tacos Viande + Poulet", description: "", price: 29000, recipe: "brochettes", tags: ["Popular"] },
          { id: "tacos-land--2369", name: "Tacos  Viandé", description: "", price: 20500, recipe: "pain" },
          { id: "tacos-land--2368", name: "Tacos Poulet", description: "", price: 19200, recipe: "brochettes", tags: ["Popular"] },
        ],
      },
    ],
  },
];

export const merchant = (slug: string) => MERCHANTS.find((m) => m.slug === slug);

/** "16 000 FC" — French grouping with a narrow no-break space, as on a Kinshasa receipt. */
export function fc(amount: number): string {
  return `${amount.toLocaleString("fr-FR").replace(/\s/g, " ")} FC`;
}

/** The dishes people order most, across merchants, for the home page. */
export function favourites(n = 8): { merchant: Merchant; item: MenuItem }[] {
  const out: { merchant: Merchant; item: MenuItem }[] = [];
  for (const m of MERCHANTS) for (const s of m.menu) for (const item of s.items) if (item.tags?.includes("Popular")) out.push({ merchant: m, item });
  return out.slice(0, n);
}
