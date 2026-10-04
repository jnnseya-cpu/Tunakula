/**
 * Sample storefronts for the website preview. These merchants and menus are illustrative:
 * every page that shows them says so. At launch the same components read the live catalogue
 * from the API (GET /v1/branches/{id}/menu).
 */
import type { Recipe } from "../components/plate";

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
  readonly eta: string;
  /** Profile picture: a monogram in the merchant's colours until they upload their logo. */
  readonly monogram: string;
  readonly tone: { readonly bg: string; readonly fg: string; readonly accent: string };
  /** Cover picture: three of their own dishes until they upload a cover photo. */
  readonly cover: readonly [Recipe, Recipe, Recipe];
  readonly about: string;
  readonly menu: readonly { readonly section: string; readonly items: readonly MenuItem[] }[];
}

export const MERCHANTS: readonly Merchant[] = [
  {
    slug: "chez-mama-pauline",
    name: "Chez Mama Pauline",
    kind: "Restaurant",
    cuisine: "Congolese home cooking",
    commune: "Gombe",
    landmark: "Avenue du Commerce, opposite the Sainte-Anne pharmacy",
    hours: "11:00 – 22:30",
    rating: 4.8,
    ratings: 1240,
    eta: "25–35 min",
    monogram: "MP",
    tone: { bg: "#7e2a10", fg: "#fbefe4", accent: "#e9a24a" },
    cover: ["moambe", "liboke", "pondu"],
    about: "Mama Pauline has cooked moambe on the same corner of Gombe for nineteen years. Palm-nut sauce made fresh every morning; fish from the river market at Kinkole.",
    menu: [
      {
        section: "Signatures",
        items: [
          { id: "moambe", name: "Poulet à la moambe", description: "Chicken simmered in palm-nut sauce, served with rice or kwanga. For one generous plate.", price: 16000, recipe: "moambe", tags: ["Popular"] },
          { id: "liboke", name: "Liboke ya mbisi", description: "River fish steamed in banana leaf over charcoal with tomato, onion and pili-pili.", price: 18000, recipe: "liboke", tags: ["Popular", "Spicy"] },
          { id: "poisson", name: "Poisson braisé", description: "Whole tilapia grilled over coals, with fried plantain and a fresh tomato salsa.", price: 20000, recipe: "poisson" },
          { id: "moambe-2", name: "Moambe for two", description: "Two portions of moambe, a large rice and two kwanga. The Sunday order.", price: 30000, recipe: "moambe", tags: ["New"] },
        ],
      },
      {
        section: "Greens",
        items: [
          { id: "pondu", name: "Pondu na makayabu", description: "Pounded cassava leaves cooked slowly with salted fish and palm oil.", price: 9000, recipe: "pondu" },
          { id: "saka", name: "Saka-saka", description: "Cassava leaves with aubergine and peanut paste. No fish.", price: 8000, recipe: "saka", tags: ["Vegan"], allergens: ["peanuts"] },
        ],
      },
      {
        section: "On the side",
        items: [
          { id: "riz", name: "Riz parfumé", description: "Steamed rice with a little onion and pepper.", price: 3000, recipe: "riz", tags: ["Vegan"] },
          { id: "chikwangue", name: "Chikwangue (kwanga)", description: "Fermented cassava, wrapped in leaves. Two pieces.", price: 1500, recipe: "chikwangue", tags: ["Vegan"] },
          { id: "makemba", name: "Makemba frits", description: "Ripe plantain, fried until the edges caramelise.", price: 4000, recipe: "makemba", tags: ["Vegan"] },
        ],
      },
      {
        section: "To drink",
        items: [
          { id: "tangawisi", name: "Jus de gingembre", description: "Fresh ginger and pineapple, pressed this morning. 50 cl.", price: 2000, recipe: "jus", tags: ["Vegan"] },
        ],
      },
    ],
  },
  {
    slug: "malewa-ya-limete",
    name: "Malewa ya Limete",
    kind: "Malewa",
    cuisine: "Malewa · everyday plates",
    commune: "Limete",
    landmark: "7e rue, behind the Shell station on Boulevard Lumumba",
    hours: "10:00 – 21:00",
    rating: 4.6,
    ratings: 860,
    eta: "20–30 min",
    monogram: "ML",
    tone: { bg: "#27402a", fg: "#eef0e2", accent: "#d9b24a" },
    cover: ["pondu", "fumbwa", "makemba"],
    about: "A real malewa: three pots on the fire from ten in the morning, generous plates, prices that working Kinshasa can pay.",
    menu: [
      {
        section: "Today's pots",
        items: [
          { id: "pondu", name: "Pondu na makayabu", description: "Cassava leaves with salted fish. The house plate, with kwanga.", price: 9000, recipe: "pondu", tags: ["Popular"] },
          { id: "fumbwa", name: "Fumbwa ya ngolo", description: "Wild spinach in peanut sauce with catfish.", price: 8000, recipe: "fumbwa", tags: ["Popular"], allergens: ["peanuts", "fish"] },
          { id: "makemba", name: "Makemba na ndunda", description: "Fried plantain with stewed red beans.", price: 6000, recipe: "makemba", tags: ["Vegan"] },
          { id: "saka", name: "Saka-saka", description: "Cassava leaves, aubergine, peanut.", price: 7000, recipe: "saka", tags: ["Vegan"], allergens: ["peanuts"] },
        ],
      },
      {
        section: "On the side",
        items: [
          { id: "chikwangue", name: "Chikwangue", description: "Two pieces.", price: 1500, recipe: "chikwangue", tags: ["Vegan"] },
          { id: "riz", name: "Riz", description: "A full plate of rice.", price: 2500, recipe: "riz", tags: ["Vegan"] },
        ],
      },
    ],
  },
  {
    slug: "brochettes-kintambo",
    name: "Brochettes Kintambo",
    kind: "Grill",
    cuisine: "Grill · brochettes & fish",
    commune: "Kintambo",
    landmark: "Rond-point Kintambo Magasin, the blue awning",
    hours: "16:00 – 01:00",
    rating: 4.7,
    ratings: 1015,
    eta: "30–40 min",
    monogram: "BK",
    tone: { bg: "#2a1d16", fg: "#f3e6d6", accent: "#e0643a" },
    cover: ["brochettes", "poisson", "mbika"],
    about: "Goat, beef and chicken skewers off a charcoal grill from four in the afternoon until late. Pili-pili on the side, always.",
    menu: [
      {
        section: "From the grill",
        items: [
          { id: "brochettes", name: "Brochettes de chèvre", description: "Four goat skewers with onion, pili-pili on the side.", price: 12000, recipe: "brochettes", tags: ["Popular", "Spicy", "Halal"] },
          { id: "brochettes-boeuf", name: "Brochettes de bœuf", description: "Four beef skewers, marinated overnight.", price: 12000, recipe: "brochettes", tags: ["Halal"] },
          { id: "poisson", name: "Thomson braisé", description: "Grilled mackerel with plantain and onion salad.", price: 15000, recipe: "poisson", tags: ["Popular"] },
        ],
      },
      {
        section: "Plates",
        items: [
          { id: "mbika", name: "Liboke ya mbika", description: "Ground pumpkin seeds steamed in leaves.", price: 10000, recipe: "mbika", tags: ["Vegetarian"] },
          { id: "makemba", name: "Makemba frits", description: "Fried plantain.", price: 4000, recipe: "makemba", tags: ["Vegan"] },
        ],
      },
      {
        section: "To drink",
        items: [
          { id: "tangawisi", name: "Jus de gingembre", description: "Fresh ginger and pineapple. 50 cl.", price: 2000, recipe: "jus", tags: ["Vegan"] },
        ],
      },
    ],
  },
  {
    slug: "boulangerie-victoire",
    name: "Boulangerie Victoire",
    kind: "Bakery",
    cuisine: "Bakery · bread & beignets",
    commune: "Kalamu",
    landmark: "Rond-point Victoire, next to the Matonge market entrance",
    hours: "05:30 – 20:00",
    rating: 4.7,
    ratings: 540,
    eta: "15–25 min",
    monogram: "BV",
    tone: { bg: "#8a5a22", fg: "#fff4e3", accent: "#f2c46a" },
    cover: ["pain", "beignets", "jus"],
    about: "Baguettes out of the oven every two hours from half past five. Mikate (beignets) fried to order.",
    menu: [
      {
        section: "Bread",
        items: [
          { id: "baguette", name: "Baguette", description: "Crisp crust, baked through the day.", price: 1000, recipe: "pain", tags: ["Popular", "Vegan"], unit: "1 baguette" },
          { id: "pain-mie", name: "Pain de mie", description: "Soft sandwich loaf.", price: 3500, recipe: "pain", unit: "500 g" },
        ],
      },
      {
        section: "Beignets & sweet",
        items: [
          { id: "mikate", name: "Mikate", description: "Congolese beignets, fried to order. Bag of six.", price: 2500, recipe: "beignets", tags: ["Popular", "Vegetarian"], allergens: ["gluten"] },
          { id: "mikate-12", name: "Mikate for the office", description: "Bag of twelve, still warm.", price: 4500, recipe: "beignets", tags: ["Vegetarian"], allergens: ["gluten"] },
        ],
      },
      {
        section: "To drink",
        items: [
          { id: "tangawisi", name: "Jus de gingembre", description: "50 cl.", price: 2000, recipe: "jus", tags: ["Vegan"] },
        ],
      },
    ],
  },
  {
    slug: "marche-express-ngaliema",
    name: "Marché Express Ngaliema",
    kind: "Grocery",
    cuisine: "Grocery · fresh produce & staples",
    commune: "Ngaliema",
    landmark: "Avenue Colonel Mondjiba, near the UTEXAFRICA gate",
    hours: "07:00 – 21:00",
    rating: 4.5,
    ratings: 390,
    eta: "35–50 min",
    monogram: "ME",
    tone: { bg: "#1f5a50", fg: "#eef6f2", accent: "#f2b84b" },
    cover: ["fruits", "grocery", "chikwangue"],
    about: "Fresh produce from the Kinkole and Zigida markets every morning, and the staples for the week.",
    menu: [
      {
        section: "Fresh",
        items: [
          { id: "fruits", name: "Seasonal fruit basket", description: "Mangoes, oranges, bananas and papaya, picked for this week.", price: 15000, recipe: "fruits", tags: ["Popular"], unit: "about 3 kg" },
          { id: "makemba-raw", name: "Plantain (makemba)", description: "Ripe, for frying today.", price: 5000, recipe: "makemba", unit: "bunch of 6" },
        ],
      },
      {
        section: "Staples",
        items: [
          { id: "riz-5", name: "Rice, long grain", description: "Sealed bag.", price: 22000, recipe: "riz", unit: "5 kg" },
          { id: "chikwangue-6", name: "Chikwangue", description: "From Bandundu, wrapped this week.", price: 4000, recipe: "chikwangue", unit: "6 pieces" },
          { id: "panier", name: "Week's basket", description: "Rice 5 kg, palm oil 1 L, beans 2 kg, tomatoes, onions and kwanga.", price: 65000, recipe: "grocery", tags: ["New"], unit: "1 basket" },
        ],
      },
    ],
  },
];

export const merchant = (slug: string) => MERCHANTS.find((m) => m.slug === slug);

/** "16 000 FC" — French grouping with a narrow no-break space, as on a Kinshasa receipt. */
export function fc(amount: number): string {
  return `${amount.toLocaleString("fr-FR").replace(/\s/g, " ")} FC`;
}

/** The dishes people order most, across merchants, for the home page. */
export function favourites(n = 8): { merchant: Merchant; item: MenuItem }[] {
  const out: { merchant: Merchant; item: MenuItem }[] = [];
  for (const m of MERCHANTS) for (const s of m.menu) for (const item of s.items) if (item.tags?.includes("Popular")) out.push({ merchant: m, item });
  return out.slice(0, n);
}
