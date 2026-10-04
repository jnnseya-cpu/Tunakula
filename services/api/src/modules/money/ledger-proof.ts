/**
 * Nightly ledger proof (PRD NFR-08, §28.3 alerts, §28.4 SEV1). Re-checks the
 * stored ledger independently of the code that wrote it: every journal
 * balances per currency, no duplicate ids or idempotency keys, reversals point
 * at real journals and reverse each at most once. Any break is a SEV1.
 */

export interface StoredEntry {
  readonly account: string;
  readonly country: string;
  readonly currency: string;
  /** Minor units as stored (bigint-safe string or bigint). */
  readonly amountMinor: string | bigint;
}

export interface StoredJournal {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly entries: readonly StoredEntry[];
  readonly reverses?: string;
}

export type LedgerBreakCode =
  | "UNBALANCED"
  | "TOO_FEW_ENTRIES"
  | "ZERO_ENTRY"
  | "INVALID_AMOUNT"
  | "DUPLICATE_JOURNAL_ID"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "ORPHAN_REVERSAL"
  | "DOUBLE_REVERSAL";

export interface LedgerBreak {
  readonly journalId: string;
  readonly code: LedgerBreakCode;
  readonly detail: string;
}

export interface LedgerProof {
  readonly ok: boolean;
  readonly journals: number;
  readonly entries: number;
  readonly breaks: readonly LedgerBreak[];
  /** "SEV1" whenever any break is found (§28.4: ledger imbalance). */
  readonly severity: "NONE" | "SEV1";
}

export function proveLedger(journals: Iterable<StoredJournal>): LedgerProof {
  const breaks: LedgerBreak[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const reversed = new Set<string>();
  const reversals: StoredJournal[] = [];
  let count = 0;
  let entries = 0;

  for (const j of journals) {
    count += 1;
    entries += j.entries.length;
    const add = (code: LedgerBreakCode, detail: string) => breaks.push({ journalId: j.id, code, detail });
    if (ids.has(j.id)) add("DUPLICATE_JOURNAL_ID", j.id);
    ids.add(j.id);
    if (keys.has(j.idempotencyKey)) add("DUPLICATE_IDEMPOTENCY_KEY", j.idempotencyKey);
    keys.add(j.idempotencyKey);
    if (j.entries.length < 2) add("TOO_FEW_ENTRIES", `${j.entries.length} entries`);

    const totals = new Map<string, bigint>();
    for (const e of j.entries) {
      let minor: bigint;
      try {
        minor = typeof e.amountMinor === "bigint" ? e.amountMinor : BigInt(e.amountMinor);
      } catch {
        add("INVALID_AMOUNT", `${e.account}: ${String(e.amountMinor)}`);
        continue;
      }
      if (minor === 0n) add("ZERO_ENTRY", e.account);
      totals.set(e.currency, (totals.get(e.currency) ?? 0n) + minor);
    }
    for (const [ccy, total] of totals) if (total !== 0n) add("UNBALANCED", `${ccy} off by ${total} minor units`);
    if (j.reverses) reversals.push(j);
  }

  for (const r of reversals) {
    if (!ids.has(r.reverses as string)) breaks.push({ journalId: r.id, code: "ORPHAN_REVERSAL", detail: `reverses unknown ${r.reverses}` });
    else if (reversed.has(r.reverses as string)) breaks.push({ journalId: r.id, code: "DOUBLE_REVERSAL", detail: `${r.reverses} already reversed` });
    reversed.add(r.reverses as string);
  }

  return { ok: breaks.length === 0, journals: count, entries, breaks, severity: breaks.length ? "SEV1" : "NONE" };
}
