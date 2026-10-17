/**
 * The AI customer-service assistant port (§AI). The assistant is a pluggable "brain" behind a stable
 * interface, exactly like a PaymentConnector: a deterministic in-house brain (SandboxBrain) answers from
 * grounded facts with no external call and is what the test suite certifies, while a hosted-LLM brain can
 * be slotted in later behind an admin-managed credential. Whichever brain runs, the service that calls it
 * enforces the invariants: the brain only ever sees grounded facts (the customer's own order and the
 * published policies), it never moves money, and anything it is unsure about is escalated to a human who
 * holds `ai_chat:takeover`.
 */
import type { MoneyJSON } from "@tunakula/ts-money";

/** The four storefront languages. The brain answers in the customer's language (LN/SW fall back to FR, the market default). */
export type AssistantLang = "fr" | "en" | "ln" | "sw";

/** What the customer is asking, as classified by the brain. Drives grounding and the safe action, never a money move. */
export type SupportIntent =
  | "ORDER_STATUS"
  | "EXPLAIN_CHARGE"
  | "REFUND_OR_PROBLEM"
  | "HOW_TO"
  | "ACCOUNT_DATA"
  | "CHEF_BOOKING"
  | "GREETING"
  | "UNKNOWN";

/** Read-only facts about the customer's own order, resolved by the service before the brain runs. */
export interface OrderFacts {
  readonly orderId: string;
  readonly state: string;
  readonly type: string;
  readonly total: MoneyJSON;
  readonly serviceCharge?: MoneyJSON;
  readonly deliveryFee?: MoneyJSON;
  readonly branchName?: string;
  readonly etaMinutes?: number;
  /** True when the order is in a state where the platform already refunds automatically (no human needed). */
  readonly refundInFlight: boolean;
}

/** A grounded knowledge snippet drawn from the published policies; the brain may quote it and must cite it. */
export interface KnowledgeSnippet {
  readonly id: string;
  readonly intents: readonly SupportIntent[];
  readonly keywords: readonly string[];
  readonly title: string;
  readonly body: Readonly<Record<"fr" | "en", string>>;
  readonly policySlug?: string;
}

export interface AssistantContext {
  readonly lang: AssistantLang;
  /** The customer's own order, when the question is about one and they own it; otherwise null. */
  readonly order?: OrderFacts | null;
  /** The grounding corpus (published policies). The brain selects from it; it never invents facts. */
  readonly knowledge: readonly KnowledgeSnippet[];
  readonly customerName?: string;
}

/** A citation back to a published policy the customer can open and read in full. */
export interface AssistantCitation {
  readonly title: string;
  readonly policySlug?: string;
}

/** The one bounded action a reply may carry. None of these moves money; ESCALATE hands off to a human. */
export type AssistantActionType = "NONE" | "ESCALATE" | "SHOW_ORDER" | "OPEN_RIDER_CHAT";
export interface AssistantAction {
  readonly type: AssistantActionType;
  readonly reason?: string;
}

export interface AssistantReply {
  readonly intent: SupportIntent;
  /** 0..1. The calling service escalates below its configured threshold regardless of `escalate`. */
  readonly confidence: number;
  readonly answer: string;
  readonly citations: readonly AssistantCitation[];
  readonly action: AssistantAction;
  /** The brain's own judgement that a human is needed (a refund decision, an unknown question). */
  readonly escalate: boolean;
}

export interface AssistantBrain {
  readonly id: string;
  reply(query: string, context: AssistantContext): AssistantReply | Promise<AssistantReply>;
}
