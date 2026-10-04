/** Identity persistence (§21 user / role_binding) and the hash-chained audit log (REM-005). */
import { createHash } from "node:crypto";
import type { Sql } from "../db/db.ts";
import type { RoleBinding, Scope } from "../modules/identity/roles.ts";

export interface UserRow {
  id: string;
  phone_e164: string | null;
  display_name: string;
  email: string | null;
  home_country: string | null;
  status: string;
}

export async function userByPhone(sql: Sql, phone: string): Promise<UserRow | undefined> {
  return (await sql.query<UserRow & Record<string, unknown>>("SELECT id, phone_e164, display_name, email, home_country, status FROM identity.app_user WHERE phone_e164 = $1", [phone]))[0];
}

export async function userById(sql: Sql, id: string): Promise<UserRow | undefined> {
  return (await sql.query<UserRow & Record<string, unknown>>("SELECT id, phone_e164, display_name, email, home_country, status FROM identity.app_user WHERE id = $1", [id]))[0];
}

export async function createUser(sql: Sql, u: { phone: string; displayName: string; homeCountry?: string }): Promise<UserRow> {
  const [row] = await sql.query<UserRow & Record<string, unknown>>(
    "INSERT INTO identity.app_user (phone_e164, display_name, home_country) VALUES ($1, $2, $3) RETURNING id, phone_e164, display_name, email, home_country, status",
    [u.phone, u.displayName, u.homeCountry ?? null],
  );
  return row as UserRow;
}

export async function bindingsOf(sql: Sql, userId: string): Promise<RoleBinding[]> {
  const rows = await sql.query<{ id: string; user_id: string; role: string | null; profile: unknown; scope_type: string; scope_id: string | null; fleet_id: string | null; account_id: string | null }>(
    "SELECT id, user_id, role, profile, scope_type, scope_id, fleet_id, account_id FROM identity.role_binding WHERE user_id = $1",
    [userId],
  );
  return rows.map((r) => {
    const scope = (r.scope_id ? { type: r.scope_type, id: r.scope_id } : { type: r.scope_type }) as Scope;
    const base = { id: r.id, userId: r.user_id, scope, ...(r.fleet_id ? { fleetId: r.fleet_id } : {}), ...(r.account_id ? { accountId: r.account_id } : {}) };
    return (r.role ? { ...base, role: r.role } : { ...base, profile: r.profile }) as RoleBinding;
  });
}

/** A binding to create: RoleBinding without its id, kept as a union (role XOR access profile). */
export type NewBinding = RoleBinding extends infer B ? (B extends RoleBinding ? Omit<B, "id"> : never) : never;

export async function addBinding(sql: Sql, b: NewBinding): Promise<string> {
  const scopeId = "id" in b.scope ? b.scope.id : null;
  const [row] = await sql.query<{ id: string }>(
    "INSERT INTO identity.role_binding (user_id, role, profile, scope_type, scope_id, fleet_id, account_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [b.userId, "role" in b ? b.role : null, "profile" in b ? JSON.stringify(b.profile) : null, b.scope.type, scopeId, b.fleetId ?? null, b.accountId ?? null],
  );
  return (row as { id: string }).id;
}

/** Deterministic JSON (sorted keys) so a hash survives jsonb's key reordering. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** Appends to the audit chain: each record hashes its content with the previous record's hash. */
export async function audit(sql: Sql, entry: { actor: string; action: string; target: string; country?: string; detail?: unknown }): Promise<void> {
  // Serialises writers until commit so the chain has one tail. An advisory lock, because LOCK TABLE needs the UPDATE right the app role must not hold.
  await sql.query("SELECT pg_advisory_xact_lock(7242019)");
  const [last] = await sql.query<{ hash: string }>("SELECT hash FROM identity.audit_log ORDER BY id DESC LIMIT 1");
  const prev = last?.hash ?? "genesis";
  const at = new Date();
  const body = canonical({ at: at.toISOString(), ...entry, prev });
  const hash = createHash("sha256").update(body).digest("hex");
  await sql.query(
    "INSERT INTO identity.audit_log (at, actor, action, target, country_iso2, detail, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [at, entry.actor, entry.action, entry.target, entry.country ?? null, entry.detail === undefined ? null : JSON.stringify(entry.detail), prev, hash],
  );
}

/** Recomputes the chain; any edited, inserted or removed record breaks it. */
export async function verifyAuditChain(sql: Sql): Promise<{ ok: boolean; brokenAt?: number }> {
  const rows = await sql.query<{ id: string; at: Date; actor: string; action: string; target: string; country_iso2: string | null; detail: unknown; prev_hash: string; hash: string }>(
    "SELECT id::text, at, actor, action, target, country_iso2, detail, prev_hash, hash FROM identity.audit_log ORDER BY audit_log.id",
  );
  let prev = "genesis";
  for (const r of rows) {
    const entry = { actor: r.actor, action: r.action, target: r.target, ...(r.country_iso2 ? { country: r.country_iso2 } : {}), ...(r.detail === null ? {} : { detail: r.detail }) };
    const body = canonical({ at: new Date(r.at).toISOString(), ...entry, prev });
    if (r.prev_hash !== prev || createHash("sha256").update(body).digest("hex") !== r.hash) return { ok: false, brokenAt: Number(r.id) };
    prev = r.hash;
  }
  return { ok: true };
}
