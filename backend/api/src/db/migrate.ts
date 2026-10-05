/**
 * Applies migrations/*.sql in order, once each, under an advisory lock, and
 * grants the application role exactly what it needs: read/write on mutable
 * tables, insert-only on append-only ones, nothing that bypasses RLS.
 */
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const DIR = new URL("../../migrations/", import.meta.url);

const APPEND_ONLY = ["ordering.order_event", "money.journal", "money.ledger_entry", "payments.payment_attempt", "identity.audit_log"];

export async function migrate(ownerUrl: string, appRole?: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(7242018)");
    await client.query("CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query("SELECT name FROM public.schema_migrations")).rows.map((r) => r.name as string));
    for (const file of (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      const sql = await readFile(new URL(file, DIR), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    if (appRole) await grant(client, appRole);
  } finally {
    await client.query("SELECT pg_advisory_unlock(7242018)").catch(() => undefined);
    await client.end();
  }
  return applied;
}

async function grant(client: pg.Client, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid role name ${role}`);
  const schemas = ["platform", "config", "identity", "catalogue", "ordering", "money", "payments", "dispatch", "api"];
  for (const s of schemas) {
    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${role}`);
  }
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform TO ${role}`);
  await client.query(`GRANT EXECUTE ON FUNCTION payments.country_for_provider_ref(text, text) TO ${role}`);
  // Append-only tables: the application may insert and read, never change or delete (belt and braces with the triggers).
  for (const t of APPEND_ONLY) await client.query(`REVOKE UPDATE, DELETE ON ${t} FROM ${role}`);
  await client.query(`REVOKE ALL ON public.schema_migrations FROM ${role}`);
  // Tenant-free webhook routing is reachable only through payments.country_for_provider_ref.
  await client.query(`REVOKE ALL ON payments.provider_ref_route FROM ${role}`);
}
