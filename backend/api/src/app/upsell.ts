/**
 * The storefront upsell service (§AI growth). Given a cart (the branch and the item ids already in it), it picks
 * ONE complementary dish from the branch's real, available menu — preferring a recommended dish in a category the
 * cart doesn't already have (a drink to go with mains) — and has the upsell writer phrase a short pitch for it.
 * It is grounded and read-only: the dish is a real catalogue item, the writer names only it, and nothing is
 * added to any cart (the customer decides). Returns null when there is nothing sensible to suggest.
 */
import type { UpsellWriter } from "@tunakula/ts-contracts";
import type { CatalogueService } from "./catalogue.ts";

interface MenuItem {
  id: string;
  names: Record<string, string>;
  category?: string | null;
  available: boolean;
  recommended: boolean;
  image_id?: string | null;
  prices: Record<string, { amount_minor: string; currency: string }>;
}

export class UpsellService {
  private readonly catalogue: CatalogueService;
  private readonly writer: UpsellWriter;

  constructor(catalogue: CatalogueService, writer: UpsellWriter) {
    this.catalogue = catalogue;
    this.writer = writer;
  }

  async suggest(country: string, branchId: string, cartItemIds: readonly string[], lang: "fr" | "en" = "fr") {
    const menu = await this.catalogue.menu(country, branchId);
    const items = menu.items as unknown as MenuItem[];
    const inCart = new Set(cartItemIds.map(String));
    if (inCart.size === 0) return { suggestion: null };

    const cartItems = items.filter((i) => inCart.has(i.id));
    const cartCategories = new Set(cartItems.map((i) => (i.category ?? "").toLowerCase()).filter(Boolean));
    const candidates = items.filter((i) => i.available && !inCart.has(i.id));
    if (candidates.length === 0) return { suggestion: null };

    // Priority: a recommended dish in a new category, then any recommended, then any new-category dish, then any.
    const score = (i: MenuItem) => {
      const newCat = !cartCategories.has((i.category ?? "").toLowerCase()) ? 1 : 0;
      return (i.recommended ? 2 : 0) + newCat;
    };
    const pick = [...candidates].sort((a, b) => score(b) - score(a) || name(a.names, lang).localeCompare(name(b.names, lang)))[0]!;

    const copy = await this.writer.write({
      cartItems: cartItems.map((i) => name(i.names, lang)).filter(Boolean),
      suggestion: name(pick.names, lang),
      ...(pick.category ? { suggestionCategory: pick.category } : {}),
      branchName: (menu.branch as { name?: string })?.name ?? "",
      lang,
    });

    return {
      suggestion: {
        item_id: pick.id,
        name: name(pick.names, lang),
        category: pick.category ?? null,
        image_id: pick.image_id ?? null,
        price: priceOf(pick.prices),
        pitch: copy.text,
        source: copy.source,
      },
    };
  }
}

const name = (names: Record<string, string>, lang: string) => names[lang] ?? names["fr"] ?? names["en"] ?? Object.values(names)[0] ?? "";

function priceOf(prices: Record<string, { amount_minor: string; currency: string }>) {
  const first = Object.values(prices)[0];
  return first ? { amount_minor: first.amount_minor, currency: first.currency } : null;
}
