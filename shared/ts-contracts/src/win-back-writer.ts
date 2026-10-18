/**
 * The win-back copywriter port (§AI growth). When the growth agent re-engages a lapsed customer, the message it
 * sends can be written by a pluggable "brain": a deterministic in-house writer (grounded, bilingual, always
 * available) or a hosted-model writer that personalises the copy from the customer's own history. The writer
 * only phrases a message from facts the service already resolved — it invents no dish, no offer and no claim,
 * and it never decides or moves money; the credit is set and issued by the service, under the caps.
 */
import type { MoneyJSON } from "@tunakula/ts-money";

/** The grounded facts a win-back message may be written from. Everything here is resolved from real data. */
export interface WinBackContext {
  /** The customer's display name, for a warm greeting. */
  readonly displayName: string;
  /** Days since their most recent order; null if unknown. */
  readonly daysSinceLastOrder: number | null;
  /** Their most-ordered dishes (names only), so the copy can name a real favourite. */
  readonly favouriteDishes: readonly string[];
  /** The goodwill credit waiting for them, if any. The writer states it but never changes it. */
  readonly credit?: MoneyJSON;
  /** The language to write in. */
  readonly lang: "fr" | "en";
}

/** A written win-back message and where it came from. */
export interface WinBackCopy {
  readonly text: string;
  readonly source: "ai" | "template";
}

export interface WinBackWriter {
  readonly id: string;
  /** Write one short win-back message from the grounded context. Must always return usable text. */
  write(context: WinBackContext): Promise<WinBackCopy>;
}
