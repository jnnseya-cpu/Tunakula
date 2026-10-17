/**
 * In-order chat between the customer and the rider on a live order. Only the order's customer and its assigned
 * rider can read or post; messages are short and immutable. The customer app and the rider app poll the thread.
 * The Uber Eats / DoorDash "message your courier" feature, kept simple and additive.
 */
import type { Db } from "../db/db.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";

type OrderRow = { customer_id: string; rider_id: string | null; state: string };
const CLOSED = ["DELIVERED", "CANCELLED", "REFUNDED", "REJECTED"];

export class ChatService {
  private readonly db: Db;
  private readonly now: () => Date;

  constructor(db: Db, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  /** The role this principal plays on the order, or null if they are neither the customer nor the rider. */
  #role(order: OrderRow, principal: Principal): "CUSTOMER" | "RIDER" | null {
    if (order.customer_id === principal.userId) return "CUSTOMER";
    if (order.rider_id && order.rider_id === principal.userId) return "RIDER";
    return null;
  }

  async #order(sql: import("../db/db.ts").Sql, orderId: string): Promise<OrderRow> {
    const [row] = await sql.query<OrderRow>("SELECT customer_id::text, rider_id, state FROM ordering.order_view WHERE order_id = $1", [orderId]);
    if (!row) throw notFound("Order");
    return row;
  }

  /** GET /v1/orders/:id/messages — the thread for this order, with who the other party is and whether it is open. */
  async thread(country: string, principal: Principal, orderId: string) {
    return this.db.tx({ country }, async (sql) => {
      const order = await this.#order(sql, orderId);
      const role = this.#role(order, principal);
      if (!role) throw forbidden("Only the customer and the rider on this order can see its chat");
      const rows = await sql.query<{ id: string; sender_id: string; sender_role: string; body: string; created_at: Date }>(
        "SELECT id, sender_id::text, sender_role, body, created_at FROM comms.order_message WHERE order_id = $1 ORDER BY created_at",
        [orderId],
      );
      const open = !CLOSED.includes(order.state) && order.rider_id !== null;
      return {
        role,
        // The other party exists once a rider is assigned; a customer sees "rider", a rider sees "customer".
        counterparty: role === "CUSTOMER" ? (order.rider_id ? "RIDER" : null) : "CUSTOMER",
        open,
        messages: rows.map((r) => ({ id: r.id, from: r.sender_role, mine: r.sender_id === principal.userId, body: r.body, at: new Date(r.created_at).toISOString() })),
      };
    });
  }

  /** POST /v1/orders/:id/messages — post a message to the other party on this order. */
  async send(country: string, principal: Principal, orderId: string, body: string) {
    const text = String(body ?? "").trim();
    if (!text) throw badRequest("MESSAGE_EMPTY", "Write a message");
    if (text.length > 1000) throw badRequest("MESSAGE_TOO_LONG", "Keep it under 1000 characters");
    return this.db.tx({ country }, async (sql) => {
      const order = await this.#order(sql, orderId);
      const role = this.#role(order, principal);
      if (!role) throw forbidden("Only the customer and the rider on this order can chat");
      if (CLOSED.includes(order.state)) throw badRequest("ORDER_CLOSED", "This order is closed; the chat is read-only");
      if (role === "RIDER" && order.rider_id !== principal.userId) throw forbidden("You are not the rider on this order");
      const [row] = await sql.query<{ id: string; created_at: Date }>(
        "INSERT INTO comms.order_message (country_iso2, order_id, sender_id, sender_role, body) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at",
        [country, orderId, principal.userId, role, text.slice(0, 1000)],
      );
      return { id: row!.id, from: role, mine: true, body: text.slice(0, 1000), at: new Date(row!.created_at).toISOString() };
    });
  }
}
