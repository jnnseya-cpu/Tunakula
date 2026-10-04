/**
 * Double-entry, append-only journals (PRD §19.1 MR-7, §19.3, §21 ledger_entry).
 * A journal balances to zero per currency; corrections are reversing journals,
 * never edits. Debits are positive, credits negative.
 */
import { Money } from "@tunakula/ts-money";

/** PRD §19.3 ledger accounts (each kept per country, per currency). */
export const LEDGER_ACCOUNTS = [
  "customer_wallet",
  "customer_receivable",
  "restaurant_payable",
  "rider_payable",
  "fleet_payable",
  "commission_revenue",
  "subscription_revenue",
  "delivery_fee_revenue",
  "ads_revenue",
  "xbo_fee_revenue",
  "fx_spread_revenue",
  "tax_payable",
  "loyalty_liability",
  "refunds",
  "cod_cash_in_transit",
  "rounding",
  "psp_clearing",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export interface LedgerEntry {
  readonly account: LedgerAccount;
  /** ISO 3166-1 alpha-2: accounts are per country. */
  readonly country: string;
  /** Positive = debit, negative = credit. */
  readonly amount: Money;
}

export interface Journal {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly description: string;
  readonly entries: readonly LedgerEntry[];
  readonly postedAt: Date;
  /** Set when this journal reverses another. */
  readonly reverses?: string;
}

export class UnbalancedJournalError extends Error {
  constructor(currency: string, imbalance: Money) {
    super(`Journal does not balance in ${currency}: off by ${imbalance.toString()}`);
    this.name = "UnbalancedJournalError";
  }
}

/** Validates and freezes a journal. Throws unless it balances in every currency. */
export function createJournal(input: Omit<Journal, "postedAt"> & { postedAt?: Date }): Journal {
  if (input.entries.length < 2) throw new Error("A journal needs at least two entries");
  const totals = new Map<string, Money>();
  for (const entry of input.entries) {
    if (entry.amount.isZero()) throw new Error(`Zero-amount entry on ${entry.account}`);
    if (!/^[A-Z]{2}$/.test(entry.country)) throw new Error(`Invalid country "${entry.country}"`);
    const ccy = entry.amount.currency;
    totals.set(ccy, (totals.get(ccy) ?? Money.zero(ccy)).add(entry.amount));
  }
  for (const [ccy, total] of totals) if (!total.isZero()) throw new UnbalancedJournalError(ccy, total);
  return Object.freeze({
    ...input,
    entries: Object.freeze(input.entries.map((e) => Object.freeze({ ...e }))),
    postedAt: input.postedAt ?? new Date(),
  });
}

/** Builds the reversing journal for a correction (MR-7). */
export function reverseJournal(original: Journal, id: string, reason: string): Journal {
  return createJournal({
    id,
    idempotencyKey: `reversal:${original.id}`,
    description: `Reversal of ${original.id}: ${reason}`,
    entries: original.entries.map((e) => ({ ...e, amount: e.amount.negate() })),
    reverses: original.id,
  });
}

/**
 * Append-only in-memory ledger. The production ledger is the event-sourced
 * Money context on PostgreSQL; this keeps the same invariants for tests and
 * projections: idempotent posting, no edits, balances as projections.
 */
export class Ledger {
  readonly #journals: Journal[] = [];
  readonly #byKey = new Map<string, Journal>();
  readonly #reversed = new Set<string>();

  post(journal: Journal): Journal {
    const existing = this.#byKey.get(journal.idempotencyKey);
    if (existing) return existing;
    if (journal.reverses) {
      if (!this.#journals.some((j) => j.id === journal.reverses)) throw new Error(`Cannot reverse unknown journal ${journal.reverses}`);
      if (this.#reversed.has(journal.reverses)) throw new Error(`Journal ${journal.reverses} is already reversed`);
      this.#reversed.add(journal.reverses);
    }
    this.#journals.push(journal);
    this.#byKey.set(journal.idempotencyKey, journal);
    return journal;
  }

  balance(account: LedgerAccount, country: string, currency: string): Money {
    let total = Money.zero(currency);
    for (const j of this.#journals) {
      for (const e of j.entries) {
        if (e.account === account && e.country === country && e.amount.currency === currency) total = total.add(e.amount);
      }
    }
    return total;
  }

  journals(): readonly Journal[] {
    return [...this.#journals];
  }
}
