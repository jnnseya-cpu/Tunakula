import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * A dish card. When a real photograph exists in /public/photos/<slug>.(jpg|webp)
 * it is used; otherwise the card is a printed-menu panel in the dish's own colours.
 * (Server component: the photo check runs at build time.)
 */
export interface Dish {
  readonly slug: string;
  readonly name: string;
  readonly local: string;
  readonly kitchen: string;
  readonly commune: string;
  readonly minutes: string;
  readonly price: string;
  /** Background and text colour drawn from the dish itself. */
  readonly tone: { readonly bg: string; readonly fg: string };
  readonly tag?: string;
}

function photoFor(slug: string): string | undefined {
  for (const ext of ["webp", "jpg", "jpeg"]) {
    if (existsSync(join(process.cwd(), "public", "photos", `${slug}.${ext}`))) return `/photos/${slug}.${ext}`;
  }
  return undefined;
}

export function DishCard({ dish, size = "m" }: { dish: Dish; size?: "s" | "m" | "l" }) {
  const photo = photoFor(dish.slug);
  return (
    <article className={`dishcard ${size} ${photo ? "has-photo" : ""}`} style={{ background: dish.tone.bg, color: dish.tone.fg }}>
      {photo ? <img src={photo} alt={`${dish.name} from ${dish.kitchen}`} loading="lazy" /> : null}
      <div className="dc-top">
        <span className="dc-kitchen">{dish.kitchen} · {dish.commune}</span>
        {dish.tag ? <span className="dc-tag">{dish.tag}</span> : null}
      </div>
      <div className="dc-body">
        <h3 className="dc-name">{dish.name}</h3>
        <p className="dc-local">{dish.local}</p>
        <div className="dc-foot">
          <span className="price">{dish.price}</span>
          <span>{dish.minutes}</span>
        </div>
      </div>
    </article>
  );
}

export const DISHES: Record<string, Dish> = {
  moambe: { slug: "moambe", name: "Poulet à la moambe", local: "Chicken in palm-nut sauce, with rice or kwanga", kitchen: "Chez Mama Pauline", commune: "Gombe", minutes: "25–35 min", price: "16 000 FC", tone: { bg: "#9c3518", fg: "#fbefe4" } },
  pondu: { slug: "pondu", name: "Pondu na makayabu", local: "Pounded cassava leaves, slow-cooked with salted fish", kitchen: "Malewa ya Limete", commune: "Limete", minutes: "20–30 min", price: "9 000 FC", tone: { bg: "#27402a", fg: "#eef0e2" } },
  liboke: { slug: "liboke", name: "Liboke ya mbisi", local: "River fish steamed in banana leaf over coals", kitchen: "Chez Mama Pauline", commune: "Gombe", minutes: "35–45 min", price: "18 000 FC", tone: { bg: "#4f5d31", fg: "#f2f0dc" } },
  makemba: { slug: "makemba", name: "Makemba na ndunda", local: "Fried plantain with stewed beans", kitchen: "Malewa ya Limete", commune: "Limete", minutes: "20–30 min", price: "6 000 FC", tone: { bg: "#d9a441", fg: "#24170c" }, tag: "Vegan" },
  brochettes: { slug: "brochettes", name: "Brochettes de chèvre", local: "Four skewers off the grill, pili-pili on the side", kitchen: "Brochettes Kintambo", commune: "Kintambo", minutes: "30–40 min", price: "12 000 FC", tone: { bg: "#2a1d16", fg: "#f3e6d6" } },
  fumbwa: { slug: "fumbwa", name: "Fumbwa ya ngolo", local: "Wild spinach in peanut sauce with catfish", kitchen: "Malewa ya Limete", commune: "Limete", minutes: "25–35 min", price: "8 000 FC", tone: { bg: "#3c5236", fg: "#eef0e2" } },
  mbika: { slug: "mbika", name: "Liboke ya mbika", local: "Ground pumpkin seeds, steamed in leaves", kitchen: "Brochettes Kintambo", commune: "Kintambo", minutes: "30–40 min", price: "10 000 FC", tone: { bg: "#e8dcc2", fg: "#2a2017" }, tag: "Vegetarian" },
  jus: { slug: "jus", name: "Jus de gingembre", local: "Fresh ginger and pineapple, pressed this morning", kitchen: "Brochettes Kintambo", commune: "Kintambo", minutes: "15–25 min", price: "2 000 FC", tone: { bg: "#e7b23a", fg: "#24170c" }, tag: "Halal" },
};
