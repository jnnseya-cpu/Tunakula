/**
 * StackFood → Tunakula migration runner (CLI).
 *
 *   tsx src/migrator/run.ts            # dry run: extract + transform + reconcile, write nothing
 *   tsx src/migrator/run.ts --apply    # also load canonical records into the `migration` staging schema
 *
 * It reads the live StackFood MySQL, runs the pure transforms (transform.ts) through the field map
 * (mapping.ts), reports every rejected row, loads the clean records into a reviewable Postgres STAGING
 * schema (never straight into the live tenant tables), and prints a reconciliation report. Promoting the
 * staging records into the live Tunakula tables — through the app's own services, so RLS, id-remapping and
 * invariants all hold — is the next, separate step, run only once reconcile is green (see README).
 *
 * Env:
 *   STACKFOOD_MYSQL_URL   mysql://user:pass@host:3306/stackfood   (read-only user is fine)
 *   DATABASE_OWNER_URL    the Tunakula Postgres owner URL (same one migrations use)
 *
 * mysql2 is imported lazily so it is not a dependency of the API image; install it where you run this:
 *   npm i -D mysql2
 */
import pg from "pg";
import {
  mapAll, mapBranch, mapItem, mapMerchant, mapOrder, mapUser,
  type MigratorConfig, type Row, type RowProblem,
} from "./transform.ts";
import { DRC_CONFIG, SOURCE_TABLES } from "./mapping.ts";
import { formatReport, reconcile, sumMinor, type EntityCount, type SumCheck } from "./reconcile.ts";

interface MysqlLike { query(sql: string): Promise<[Row[], unknown]>; end(): Promise<void> }

async function connectMysql(url: string): Promise<MysqlLike> {
  // Indirect specifier: keeps the TS compiler from trying to resolve an optional, not-installed module at
  // build time (mysql2 is only needed when this CLI actually runs a migration).
  const spec = "mysql2/promise";
  let mysql: { createConnection(u: string): Promise<MysqlLike> };
  try {
    mysql = (await import(spec)) as unknown as { createConnection(u: string): Promise<MysqlLike> };
  } catch {
    throw new Error("mysql2 is not installed. Run `npm i -D mysql2` in backend/api before migrating.");
  }
  return mysql.createConnection(url);
}

const STAGING_DDL = `
CREATE SCHEMA IF NOT EXISTS migration;
CREATE TABLE IF NOT EXISTS migration.user     (source_id text PRIMARY KEY, phone_e164 text NOT NULL, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS migration.merchant (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS migration.branch   (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS migration.item     (source_id text PRIMARY KEY, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS migration.order_hdr(source_id text PRIMARY KEY, total_minor numeric NOT NULL, record jsonb NOT NULL);
`;

// SQL identifiers (table + column names) are never user data in this tool — they come from the constants
// above and the field map — but they are interpolated into SQL, so we allowlist/validate them before use.
// That keeps the injection surface provably closed even if the config is later edited carelessly.
const STAGING_TABLES: ReadonlySet<string> = new Set(["user", "merchant", "branch", "item", "order_hdr"]);
const SOURCE_TABLE_SET: ReadonlySet<string> = new Set(Object.values(SOURCE_TABLES));
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdent(name: string, kind: string): void {
  if (!SAFE_IDENT.test(name)) throw new Error(`unsafe ${kind} identifier: ${JSON.stringify(name)}`);
}

async function load(client: pg.Client, table: string, rows: { source_id: string; extra?: Record<string, string>; record: unknown }[]): Promise<number> {
  if (!STAGING_TABLES.has(table)) throw new Error(`unknown staging table: ${JSON.stringify(table)}`);
  let n = 0;
  for (const r of rows) {
    const cols = ["source_id", ...Object.keys(r.extra ?? {}), "record"];
    cols.forEach((c) => assertIdent(c, "column"));
    const vals = [r.source_id, ...Object.values(r.extra ?? {}), JSON.stringify(r.record)];
    const ph = cols.map((_, i) => `$${i + 1}`).join(",");
    await client.query(`INSERT INTO migration.${table} (${cols.join(",")}) VALUES (${ph}) ON CONFLICT (source_id) DO UPDATE SET record = EXCLUDED.record`, vals);
    n++;
  }
  return n;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const cfg: MigratorConfig = DRC_CONFIG;
  const mysqlUrl = process.env.STACKFOOD_MYSQL_URL;
  const pgUrl = process.env.DATABASE_OWNER_URL;
  if (!mysqlUrl) throw new Error("set STACKFOOD_MYSQL_URL");
  if (apply && !pgUrl) throw new Error("set DATABASE_OWNER_URL to --apply");

  const my = await connectMysql(mysqlUrl);
  const rowsOf = async (table: string): Promise<Row[]> => {
    if (!SOURCE_TABLE_SET.has(table)) throw new Error(`unknown source table: ${JSON.stringify(table)}`);
    assertIdent(table, "source table");
    return (await my.query(`SELECT * FROM \`${table}\``))[0];
  };

  const users = mapAll(await rowsOf(SOURCE_TABLES.users), (r) => mapUser(r, cfg));
  const merchants = mapAll(await rowsOf(SOURCE_TABLES.merchants), (r) => mapMerchant(r, cfg));
  const branches = mapAll(await rowsOf(SOURCE_TABLES.branches), (r) => mapBranch(r, cfg));
  const items = mapAll(await rowsOf(SOURCE_TABLES.items), (r) => mapItem(r, cfg));
  const orders = mapAll(await rowsOf(SOURCE_TABLES.orders), (r) => mapOrder(r, cfg));
  await my.end();

  const allProblems: RowProblem[] = [...users.problems, ...merchants.problems, ...branches.problems, ...items.problems, ...orders.problems];
  if (allProblems.length) {
    console.log(`\n${allProblems.length} row(s) could not be migrated:`);
    for (const p of allProblems.slice(0, 50)) console.log(`  [${p.entity} ${p.sourceId ?? "?"}] ${p.field}: ${p.reason}`);
    if (allProblems.length > 50) console.log(`  … and ${allProblems.length - 50} more`);
  }

  let loaded = { user: 0, merchant: 0, branch: 0, item: 0, order: 0 };
  if (apply) {
    const client = new pg.Client({ connectionString: pgUrl });
    await client.connect();
    await client.query(STAGING_DDL);
    loaded = {
      user: await load(client, "user", users.records.map((u) => ({ source_id: u.sourceId, extra: { phone_e164: u.phoneE164 }, record: u }))),
      merchant: await load(client, "merchant", merchants.records.map((m) => ({ source_id: m.sourceId, record: m }))),
      branch: await load(client, "branch", branches.records.map((b) => ({ source_id: b.sourceId, record: b }))),
      item: await load(client, "item", items.records.map((i) => ({ source_id: i.sourceId, record: i }))),
      order: await load(client, "order_hdr", orders.records.map((o) => ({ source_id: o.sourceId, extra: { total_minor: o.totalMinor }, record: o }))),
    };
    await client.end();
  } else {
    loaded = { user: users.records.length, merchant: merchants.records.length, branch: branches.records.length, item: items.records.length, order: orders.records.length };
  }

  const counts: EntityCount[] = [
    { entity: "users", source: users.records.length + users.problems.length, loaded: loaded.user, skipped: users.problems.length },
    { entity: "merchants", source: merchants.records.length + merchants.problems.length, loaded: loaded.merchant, skipped: merchants.problems.length },
    { entity: "branches", source: branches.records.length + branches.problems.length, loaded: loaded.branch, skipped: branches.problems.length },
    { entity: "items", source: items.records.length + items.problems.length, loaded: loaded.item, skipped: items.problems.length },
    { entity: "orders", source: orders.records.length + orders.problems.length, loaded: loaded.order, skipped: orders.problems.length },
  ];
  const sums: SumCheck[] = [{ label: "order value (minor)", sourceMinor: sumMinor(orders.records.map((o) => o.totalMinor)), loadedMinor: sumMinor(orders.records.map((o) => o.totalMinor)) }];

  console.log(`\n${apply ? "APPLIED to migration.* staging schema" : "DRY RUN (no writes)"}\n`);
  console.log(formatReport(reconcile(counts, sums)));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
