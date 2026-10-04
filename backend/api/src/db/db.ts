/**
 * PostgreSQL access (PRD §9.3: PostgreSQL 16). Every unit of work runs in a
 * transaction that carries the request's active country, so row-level
 * security (migrations/0004) scopes every read and write to that tenant.
 */
import pg from "pg";

export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface TxContext {
  /** ISO 3166-1 alpha-2 of the request (X-Country). Omit only for cross-tenant platform tables. */
  readonly country?: string;
}

export interface Db {
  tx<T>(ctx: TxContext, fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// int8 (bigint) stays a string so money never passes through a float (MR-1).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);

export function connect(connectionString: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return {
    async tx(ctx, fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (ctx.country !== undefined) {
          if (!/^[A-Z]{2}$/.test(ctx.country)) throw new Error(`Invalid country context "${ctx.country}"`);
          await client.query("SELECT set_config('app.country', $1, true)", [ctx.country]);
        }
        const sql: Sql = { query: async (text, params) => (await client.query(text, params as unknown[])).rows };
        const result = await fn(sql);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
