/**
 * The in-house, deterministic win-back copywriter. It phrases a warm, grounded re-engagement message in the
 * customer's language from the facts the service resolved — their name, a real favourite dish, and the goodwill
 * credit — with no model call. It is the offline default and the fallback for the hosted-model writer, so a
 * win-back message always goes out.
 */
import type { WinBackContext, WinBackCopy, WinBackWriter } from "@tunakula/ts-contracts";
import type { MoneyJSON } from "@tunakula/ts-money";

export class TemplateWinBackWriter implements WinBackWriter {
  readonly id = "template";

  async write(ctx: WinBackContext): Promise<WinBackCopy> {
    const fr = ctx.lang === "fr";
    const name = ctx.displayName.trim().split(/\s+/)[0] || ctx.displayName.trim();
    const dish = ctx.favouriteDishes[0];
    const credit = ctx.credit ? creditPhrase(ctx.credit, ctx.lang) : null;

    const parts: string[] = [];
    parts.push(fr ? `${name}, vous nous avez manqué !` : `${name}, we've missed you!`);
    if (dish) parts.push(fr ? `Votre ${dish} vous attend toujours.` : `Your ${dish} is still waiting for you.`);
    else parts.push(fr ? `Revenez découvrir vos plats préférés.` : `Come back and rediscover your favourites.`);
    if (credit) parts.push(fr ? `${capitalise(credit)} sur votre prochaine commande.` : `${capitalise(credit)} on your next order.`);

    return { text: parts.join(" "), source: "template" };
  }
}

function creditPhrase(m: MoneyJSON, lang: "fr" | "en"): string {
  const minor = BigInt(m.minor);
  const whole = minor / 100n, cents = (minor % 100n).toString().padStart(2, "0");
  const amount = `${whole}.${cents} ${m.currency}`;
  return lang === "fr" ? `un crédit de ${amount} vous attend` : `a ${amount} credit is waiting`;
}

const capitalise = (s: string) => (s.length ? s[0]!.toUpperCase() + s.slice(1) : s);
