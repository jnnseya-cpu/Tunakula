/**
 * The storefront upsell copywriter port (§AI growth). When a customer has items in their cart, the storefront can
 * suggest one complementary dish with a short, tempting line. The dish itself is chosen by the service from the
 * branch's real, available menu — the writer only phrases the one-line pitch, naming only that dish, inventing no
 * price, claim or item. A pluggable brain writes it: a deterministic in-house writer (grounded, bilingual, always
 * available) or a hosted model that phrases it more naturally.
 */
export interface UpsellContext {
  /** Names of the dishes already in the cart, for context. */
  readonly cartItems: readonly string[];
  /** The complementary dish the service chose from the real menu — the only dish the pitch may name. */
  readonly suggestion: string;
  /** The suggested dish's category, when known (e.g. "Boissons"). */
  readonly suggestionCategory?: string;
  readonly branchName: string;
  readonly lang: "fr" | "en";
}

export interface UpsellCopy {
  readonly text: string;
  readonly source: "ai" | "template";
}

export interface UpsellWriter {
  readonly id: string;
  /** Write one short upsell line for the suggested dish. Must always return usable text. */
  write(context: UpsellContext): Promise<UpsellCopy>;
}
