/** PostgreSQL store for the dispatch engine: the append-only delivery log, the in-app inbox and opt-outs. */
import type { Sql } from "../db/db.ts";
import type { CommsChannel } from "@tunakula/ts-contracts/comms";

export interface DeliveryRow {
  country: string;
  eventKey: string;
  channel: CommsChannel;
  recipientUserId: string;
  audience: string;
  severity: string;
  mandatory: boolean;
  subject: string;
  status: "sent" | "logged" | "suppressed" | "failed";
  providerRef?: string | null;
  failure?: string | null;
  dedupeKey?: string | null;
}

/** Inserts one delivery-log row. With a dedupe key, a repeat returns undefined instead of inserting. */
export async function insertDelivery(sql: Sql, row: DeliveryRow): Promise<string | undefined> {
  const rows = await sql.query<{ id: string }>(
    `INSERT INTO comms.delivery
       (country_iso2, event_key, channel, recipient_user_id, audience, severity, mandatory, subject, status, provider_ref, failure, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [row.country, row.eventKey, row.channel, row.recipientUserId, row.audience, row.severity, row.mandatory, row.subject, row.status, row.providerRef ?? null, row.failure ?? null, row.dedupeKey ?? null],
  );
  return rows[0]?.id;
}

export async function insertNotification(sql: Sql, n: { country: string; userId: string; eventKey: string; title: string; subject: string; severity: string; data: Record<string, unknown> }): Promise<string> {
  const [row] = await sql.query<{ id: string }>(
    `INSERT INTO comms.notification (country_iso2, user_id, event_key, title, subject, severity, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [n.country, n.userId, n.eventKey, n.title, n.subject, n.severity, JSON.stringify(n.data)],
  );
  return (row as { id: string }).id;
}

export interface InboxItem { [key: string]: unknown; id: string; event_key: string; title: string; subject: string; severity: string; data: unknown; read_at: string | null; created_at: string }

export async function listInbox(sql: Sql, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<InboxItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return sql.query<InboxItem>(
    `SELECT id, event_key, title, subject, severity, data, read_at, created_at
       FROM comms.notification
      WHERE user_id = $1 ${opts.unreadOnly ? "AND read_at IS NULL" : ""}
      ORDER BY created_at DESC LIMIT ${limit}`,
    [userId],
  );
}

export async function unreadCount(sql: Sql, userId: string): Promise<number> {
  const [row] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM comms.notification WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return Number((row as { n: string }).n);
}

/** Marks one of the user's notifications read. Returns false if it does not exist or is already read. */
export async function markRead(sql: Sql, userId: string, id: string, at: Date): Promise<boolean> {
  const rows = await sql.query<{ id: string }>(
    "UPDATE comms.notification SET read_at = $3 WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id",
    [id, userId, at],
  );
  return rows.length > 0;
}

export async function getPreferences(sql: Sql, country: string, userId: string): Promise<Record<string, boolean>> {
  const rows = await sql.query<{ channel: string; enabled: boolean }>("SELECT channel, enabled FROM comms.preference WHERE country_iso2 = $1 AND user_id = $2", [country, userId]);
  return Object.fromEntries(rows.map((r) => [r.channel, r.enabled]));
}

export async function optedOutChannels(sql: Sql, country: string, userId: string): Promise<Set<CommsChannel>> {
  const rows = await sql.query<{ channel: CommsChannel }>("SELECT channel FROM comms.preference WHERE country_iso2 = $1 AND user_id = $2 AND enabled = false", [country, userId]);
  return new Set(rows.map((r) => r.channel));
}

export async function setPreference(sql: Sql, country: string, userId: string, channel: CommsChannel, enabled: boolean, at: Date): Promise<void> {
  await sql.query(
    `INSERT INTO comms.preference (country_iso2, user_id, channel, enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (country_iso2, user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
    [country, userId, channel, enabled, at],
  );
}

export interface DeliveryLogRow { [key: string]: unknown; id: string; event_key: string; channel: string; audience: string; severity: string; mandatory: boolean; subject: string; status: string; recipient_user_id: string; created_at: string }

export async function listDeliveries(sql: Sql, country: string, limit = 50): Promise<DeliveryLogRow[]> {
  const n = Math.min(Math.max(limit, 1), 200);
  return sql.query<DeliveryLogRow>(
    `SELECT id, event_key, channel, audience, severity, mandatory, subject, status, recipient_user_id, created_at
       FROM comms.delivery WHERE country_iso2 = $1 ORDER BY created_at DESC LIMIT ${n}`,
    [country],
  );
}
