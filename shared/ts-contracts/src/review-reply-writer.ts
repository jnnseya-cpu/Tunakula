/**
 * The review-reply copywriter port (§AI merchant copilot). When a merchant replies to a customer review, the
 * draft can be written by a pluggable "brain": a deterministic in-house writer (grounded, bilingual, tone set by
 * the rating) or a hosted model that personalises it. The writer only phrases a reply from the review's real
 * rating, comment and branch — it promises nothing the restaurant hasn't authorised (no refund, comp or
 * discount), invents no fact, and changes nothing: the merchant reviews and edits the draft before posting it.
 */
export interface ReviewReplyContext {
  /** The customer's star rating, 1–5 — sets the tone (thank praise, apologise for a complaint). */
  readonly rating: number;
  /** The customer's own words, if they left any. */
  readonly comment?: string;
  /** The customer's first name, for a warm greeting. */
  readonly reviewerName?: string;
  /** The branch the review is about. */
  readonly branchName: string;
  /** The language to write the reply in. */
  readonly lang: "fr" | "en";
}

export interface ReviewReplyDraft {
  readonly text: string;
  readonly source: "ai" | "template";
}

export interface ReviewReplyWriter {
  readonly id: string;
  /** Draft one short reply from the grounded review. Must always return usable text. */
  write(context: ReviewReplyContext): Promise<ReviewReplyDraft>;
}
