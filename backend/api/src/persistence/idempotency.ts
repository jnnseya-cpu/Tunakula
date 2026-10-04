/** §25.1: every mutating call carries an Idempotency-Key; a replay returns the stored response. */
import { createHash } from "node:crypto";
import type { Sql } from "../db/db.ts";

export type IdempotencyOutcome =
  | { readonly kind: "NEW" }
  | { readonly kind: "REPLAY"; readonly status: number; readonly response: unknown }
  | { readonly kind: "MISMATCH" }
  | { readonly kind: "IN_PROGRESS" };

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method} ${path} ${JSON.stringify(body ?? null)}`).digest("hex");
}

export async function beginIdempotent(sql: Sql, principal: string, key: string, method: string, path: string, hash: string): Promise<IdempotencyOutcome> {
  const inserted = await sql.query(
    "INSERT INTO api.idempotency (key, principal, method, path, request_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (principal, key) DO NOTHING RETURNING key",
    [key, principal, method, path, hash],
  );
  if (inserted.length === 1) return { kind: "NEW" };
  const [row] = await sql.query<{ request_hash: string; status: number | null; response: unknown }>(
    "SELECT request_hash, status, response FROM api.idempotency WHERE principal = $1 AND key = $2",
    [principal, key],
  );
  if (!row || row.request_hash !== hash) return { kind: "MISMATCH" };
  if (row.status === null) return { kind: "IN_PROGRESS" };
  return { kind: "REPLAY", status: row.status, response: row.response };
}

export async function completeIdempotent(sql: Sql, principal: string, key: string, status: number, response: unknown): Promise<void> {
  await sql.query("UPDATE api.idempotency SET status = $3, response = $4 WHERE principal = $1 AND key = $2", [principal, key, status, JSON.stringify(response ?? null)]);
}

/** Releases a key whose request failed before completing, so the client can retry. */
export async function abandonIdempotent(sql: Sql, principal: string, key: string): Promise<void> {
  await sql.query("DELETE FROM api.idempotency WHERE principal = $1 AND key = $2 AND status IS NULL", [principal, key]);
}
