/** PostgreSQL ledger (§19.3). The database rejects unbalanced journals at commit (migrations/0003). */
import { Money } from "@tunakula/ts-money";
import type { Sql } from "../db/db.ts";
import type { Journal, LedgerAccount } from "../modules/money/journal.ts";

export async function postJournal(sql: Sql, journal: Journal): Promise<{ id: string; replayed: boolean }> {
  const existing = await sql.query<{ id: string }>("SELECT id FROM money.journal WHERE idempotency_key = $1", [journal.idempotencyKey]);
  if (existing[0]) return { id: existing[0].id, replayed: true };
  const [row] = await sql.query<{ id: string }>(
    "INSERT INTO money.journal (description, idempotency_key, posted_at, reverses) VALUES ($1, $2, $3, $4) RETURNING id",
    [journal.description, journal.idempotencyKey, journal.postedAt, journal.reverses ?? null],
  );
  const id = (row as { id: string }).id;
  let line = 0;
  for (const e of journal.entries) {
    await sql.query(
      "INSERT INTO money.ledger_entry (journal_id, line, account, country_iso2, currency, amount_minor) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, ++line, e.account, e.country, e.amount.currency, e.amount.minor.toString()],
    );
  }
  return { id, replayed: false };
}

export async function balance(sql: Sql, account: LedgerAccount, country: string, currency: string): Promise<Money> {
  const [row] = await sql.query<{ total: string | null }>(
    "SELECT sum(amount_minor)::text AS total FROM money.ledger_entry WHERE account = $1 AND country_iso2 = $2 AND currency = $3",
    [account, country, currency],
  );
  return Money.ofMinor(BigInt(row?.total ?? "0"), currency);
}
