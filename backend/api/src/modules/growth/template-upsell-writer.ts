/**
 * The in-house, deterministic storefront upsell writer. It phrases a short, tempting one-line pitch for the dish
 * the service chose, in the customer's language, with no model call. It names only that dish and promises
 * nothing. It is the offline default and the fallback for the hosted-model writer, so a pitch is always
 * available.
 */
import type { UpsellContext, UpsellCopy, UpsellWriter } from "@tunakula/ts-contracts";

/** Category keywords that read as a drink, so the line can nudge "to go with it". */
const DRINKISH = /boisson|drink|jus|juice|soda|eau|water|bière|biere|beer/i;
const SWEETISH = /dessert|sucré|sucre|sweet|glace|ice|pâtiss|patiss|cake|gâteau|gateau/i;

export class TemplateUpsellWriter implements UpsellWriter {
  readonly id = "template";

  async write(ctx: UpsellContext): Promise<UpsellCopy> {
    const fr = ctx.lang === "fr";
    const s = ctx.suggestion;
    const cat = ctx.suggestionCategory ?? "";
    let text: string;
    if (DRINKISH.test(cat)) {
      text = fr ? `Et pour accompagner ? Ajoutez ${s} à votre commande.` : `Something to drink with that? Add ${s} to your order.`;
    } else if (SWEETISH.test(cat)) {
      text = fr ? `Gardez une place pour le dessert : ${s} vous tend les bras.` : `Save room for something sweet — ${s} is calling.`;
    } else {
      text = fr ? `Complétez votre repas avec ${s}.` : `Round off your order with ${s}.`;
    }
    return { text, source: "template" };
  }
}
