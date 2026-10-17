/**
 * The AI customer-service assistant service (§AI). It grounds the assistant brain on facts it is allowed to
 * see — the customer's own order and the published policy corpus — runs the brain, and persists the
 * conversation. It enforces the invariants the brain must never break: it only ever passes a customer their
 * own order, it never moves money (a discretionary refund is escalated, not issued), and it escalates to a
 * human whenever the brain is unsure (below the confidence threshold) or asks for one. Humans who hold
 * `ai_chat:takeover` read and answer escalated conversations.
 */
import type { AssistantBrain, AssistantLang, OrderFacts } from "@tunakula/ts-contracts";
import type { MoneyJSON } from "@tunakula/ts-money";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { audit } from "../persistence/identity.ts";
import { KNOWLEDGE } from "../modules/assistant/knowledge.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";

const LANGS: readonly AssistantLang[] = ["fr", "en", "ln", "sw"];
const REFUND_IN_FLIGHT = new Set(["CANCELLED", "REJECTED", "DELIVERY_FAILED", "REFUND_REQUESTED", "REFUNDED"]);
/** Below this, the service escalates even if the brain did not ask to. */
const ESCALATE_BELOW = 0.45;

export interface AskInput {
  readonly text: string;
  readonly lang?: string;
  readonly orderId?: string;
  readonly conversationId?: string;
}

export class AssistantService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly brain: AssistantBrain;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, brain: AssistantBrain, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.brain = brain;
    this.now = now;
  }

  #market(country: string) {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    return v;
  }

  #assertTakeover(principal: Principal, country: string) {
    const v = this.#market(country);
    const action: Action = "ai_chat:takeover";
    if (!authorize(principal, action, { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) {
      throw forbidden("Escalated conversations are handled by support");
    }
  }

  /** The customer asks a question; the assistant answers from grounded facts and the conversation is recorded. */
  async ask(country: string, principal: Principal, input: AskInput) {
    this.#market(country);
    const text = String(input.text ?? "").trim();
    if (!text) throw badRequest("EMPTY_MESSAGE", "Type a message");
    if (text.length > 2000) throw badRequest("MESSAGE_TOO_LONG", "Keep it under 2000 characters");
    const lang = (LANGS as readonly string[]).includes(input.lang ?? "") ? (input.lang as AssistantLang) : "fr";

    return this.db.tx({ country }, async (sql) => {
      const order = input.orderId ? await loadOrderFacts(sql, input.orderId, principal.userId) : null;
      const reply = await this.brain.reply(text, { lang, order, knowledge: KNOWLEDGE });
      const escalate = reply.escalate || reply.confidence < ESCALATE_BELOW;

      // Find or start the conversation (the customer's own).
      const convoId = input.conversationId
        ? await ownConversation(sql, input.conversationId, principal.userId)
        : await createConversation(sql, country, principal.userId, input.orderId ?? null, reply.intent);
      if (!convoId) throw notFound("Conversation");

      await insertMessage(sql, { country, conversationId: convoId, sender: "CUSTOMER", body: text });
      await insertMessage(sql, {
        country, conversationId: convoId, sender: "AI", body: reply.answer,
        intent: reply.intent, confidence: reply.confidence, escalated: escalate, citations: reply.citations,
      });
      const status = escalate ? "ESCALATED" : undefined;
      await sql.query(
        "UPDATE support.conversation SET last_intent = $2, updated_at = now()" + (status ? ", status = $3" : "") + " WHERE id = $1",
        status ? [convoId, reply.intent, status] : [convoId, reply.intent],
      );
      if (escalate) await audit(sql, { actor: principal.userId, action: "support.ai.escalated", target: `conversation:${convoId}`, country, detail: { intent: reply.intent, confidence: reply.confidence } });

      return {
        conversation_id: convoId,
        reply: {
          answer: reply.answer,
          intent: reply.intent,
          confidence: reply.confidence,
          citations: reply.citations,
          action: reply.action,
          escalated: escalate,
        },
      };
    });
  }

  /** The signed-in customer's own help conversations, newest first. */
  async myConversations(country: string, principal: Principal, limit = 20) {
    this.#market(country);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<Record<string, unknown>>(
        `SELECT c.id, c.status, c.last_intent, c.order_id, c.updated_at,
                (SELECT m.body FROM support.message m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
           FROM support.conversation c WHERE c.customer_id = $1 ORDER BY c.updated_at DESC LIMIT $2`,
        [principal.userId, Math.min(Math.max(limit, 1), 100)],
      );
      return { conversations: rows };
    });
  }

  /** The full transcript of one conversation (the customer's own, or any for a support agent on takeover). */
  async transcript(country: string, principal: Principal, conversationId: string) {
    this.#market(country);
    return this.db.tx({ country }, async (sql) => {
      const convo = (await sql.query<{ customer_id: string; status: string; order_id: string | null; last_intent: string }>(
        "SELECT customer_id, status, order_id, last_intent FROM support.conversation WHERE id = $1", [conversationId],
      ))[0];
      if (!convo) throw notFound("Conversation");
      if (convo.customer_id !== principal.userId) this.#assertTakeover(principal, country);
      const messages = await sql.query<Record<string, unknown>>(
        "SELECT sender, body, intent, confidence, escalated, citations, created_at FROM support.message WHERE conversation_id = $1 ORDER BY created_at",
        [conversationId],
      );
      return { id: conversationId, status: convo.status, order_id: convo.order_id, messages };
    });
  }

  /** Escalated (or all open) conversations waiting for a human. Requires `ai_chat:takeover`. */
  async escalations(country: string, principal: Principal, limit = 50) {
    this.#assertTakeover(principal, country);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<Record<string, unknown>>(
        `SELECT c.id, c.status, c.last_intent, c.order_id, c.customer_id, c.updated_at,
                (SELECT m.body FROM support.message m WHERE m.conversation_id = c.id AND m.sender = 'CUSTOMER' ORDER BY m.created_at DESC LIMIT 1) AS last_customer_message
           FROM support.conversation c WHERE c.status = 'ESCALATED' ORDER BY c.updated_at ASC LIMIT $1`,
        [Math.min(Math.max(limit, 1), 200)],
      );
      return { conversations: rows };
    });
  }

  /** A human agent replies on an escalated conversation and (optionally) resolves it. Requires `ai_chat:takeover`. */
  async respond(country: string, principal: Principal, conversationId: string, body: string, resolve = false) {
    this.#assertTakeover(principal, country);
    const text = String(body ?? "").trim();
    if (!text) throw badRequest("EMPTY_MESSAGE", "Type a message");
    return this.db.tx({ country }, async (sql) => {
      const convo = (await sql.query<{ id: string }>("SELECT id FROM support.conversation WHERE id = $1", [conversationId]))[0];
      if (!convo) throw notFound("Conversation");
      await insertMessage(sql, { country, conversationId, sender: "AGENT", body: text, authorId: principal.userId });
      await sql.query("UPDATE support.conversation SET status = $2, updated_at = now() WHERE id = $1", [conversationId, resolve ? "RESOLVED" : "ESCALATED"]);
      await audit(sql, { actor: principal.userId, action: resolve ? "support.resolved" : "support.replied", target: `conversation:${conversationId}`, country });
      return { ok: true, status: resolve ? "RESOLVED" : "ESCALATED" };
    });
  }
}

async function loadOrderFacts(sql: Sql, orderId: string, customerId: string): Promise<OrderFacts | null> {
  const row = (await sql.query<{ order_id: string; state: string; type: string; total_minor: string; currency: string; branch_name: string | null; money: { serviceCharge?: MoneyJSON; deliveryFee?: MoneyJSON } | null }>(
    `SELECT o.order_id, o.state, o.type, o.total_minor::text AS total_minor, o.currency, b.name AS branch_name,
            (SELECT d.payload->'snapshot'->'money' FROM ordering.order_event d WHERE d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED' LIMIT 1) AS money
       FROM ordering.order_view o JOIN catalogue.branch b ON b.id = o.branch_id
      WHERE o.order_id = $1 AND o.customer_id = $2`,
    [orderId, customerId],
  ))[0];
  if (!row) return null;
  const money = row.money ?? {};
  return {
    orderId: row.order_id,
    state: row.state,
    type: row.type,
    total: { currency: row.currency, minor: row.total_minor },
    ...(money.serviceCharge ? { serviceCharge: money.serviceCharge } : {}),
    ...(money.deliveryFee ? { deliveryFee: money.deliveryFee } : {}),
    ...(row.branch_name ? { branchName: row.branch_name } : {}),
    refundInFlight: REFUND_IN_FLIGHT.has(row.state),
  };
}

async function createConversation(sql: Sql, country: string, customerId: string, orderId: string | null, intent: string): Promise<string> {
  const row = (await sql.query<{ id: string }>(
    "INSERT INTO support.conversation (country_iso2, customer_id, order_id, last_intent) VALUES ($1,$2,$3,$4) RETURNING id",
    [country, customerId, orderId, intent],
  ))[0];
  return row!.id;
}

async function ownConversation(sql: Sql, conversationId: string, customerId: string): Promise<string | null> {
  const row = (await sql.query<{ id: string }>("SELECT id FROM support.conversation WHERE id = $1 AND customer_id = $2", [conversationId, customerId]))[0];
  return row?.id ?? null;
}

interface MessageRow { country: string; conversationId: string; sender: "CUSTOMER" | "AI" | "AGENT"; body: string; intent?: string; confidence?: number; escalated?: boolean; citations?: unknown; authorId?: string }
async function insertMessage(sql: Sql, m: MessageRow): Promise<void> {
  await sql.query(
    "INSERT INTO support.message (country_iso2, conversation_id, sender, body, intent, confidence, escalated, citations, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [m.country, m.conversationId, m.sender, m.body, m.intent ?? null, m.confidence ?? null, m.escalated ?? false, JSON.stringify(m.citations ?? []), m.authorId ?? null],
  );
}
