/**
 * The in-house, deterministic review-reply writer. It drafts a warm, grounded reply whose tone follows the
 * rating — thanks for praise, a sincere apology and an invitation back for a complaint — in the customer's
 * language, with no model call and no promise the restaurant hasn't authorised. It is the offline default and
 * the fallback for the hosted-model writer, so a reply draft is always available.
 */
import type { ReviewReplyContext, ReviewReplyDraft, ReviewReplyWriter } from "@tunakula/ts-contracts";

export class TemplateReviewReplyWriter implements ReviewReplyWriter {
  readonly id = "template";

  async write(ctx: ReviewReplyContext): Promise<ReviewReplyDraft> {
    const fr = ctx.lang === "fr";
    const name = (ctx.reviewerName ?? "").trim();
    const hi = fr ? (name ? `Bonjour ${name},` : "Bonjour,") : (name ? `Hi ${name},` : "Hello,");
    const parts: string[] = [hi];

    if (ctx.rating >= 4) {
      parts.push(fr
        ? `merci beaucoup pour votre note et vos encouragements — toute l'équipe de ${ctx.branchName} est ravie de vous avoir régalé·e.`
        : `thank you so much for your rating and kind words — the whole team at ${ctx.branchName} is delighted you enjoyed it.`);
      parts.push(fr ? "Au plaisir de vous revoir très bientôt !" : "We can't wait to welcome you back soon!");
    } else if (ctx.rating === 3) {
      parts.push(fr
        ? `merci d'avoir pris le temps de nous laisser votre avis. Nous prenons note de vos remarques pour nous améliorer chez ${ctx.branchName}.`
        : `thank you for taking the time to share your feedback. We're noting your comments so we can keep improving at ${ctx.branchName}.`);
      parts.push(fr ? "Nous espérons vous offrir une meilleure expérience la prochaine fois." : "We hope to give you an even better experience next time.");
    } else {
      parts.push(fr
        ? `nous sommes vraiment désolés que votre expérience chez ${ctx.branchName} n'ait pas été à la hauteur.`
        : `we're truly sorry your experience at ${ctx.branchName} fell short.`);
      parts.push(fr
        ? "Vos retours sont précieux : nous allons les examiner avec l'équipe pour que cela ne se reproduise pas, et nous aimerions beaucoup vous accueillir à nouveau."
        : "Your feedback matters: we'll review it with the team so it doesn't happen again, and we'd love the chance to welcome you back.");
    }

    return { text: parts.join(" "), source: "template" };
  }
}
