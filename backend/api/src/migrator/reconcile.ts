/**
 * Reconciliation — pure. After a migration run, prove the new database holds what the old one did before
 * anyone relies on it: the same number of users, merchants, branches, items and orders, and the same total
 * order value (summed in integer minor units, so the comparison is exact). Any gap is a line in the report;
 * a report with no gaps is the green light to cut a cohort over.
 */

export interface EntityCount {
  readonly entity: string;
  readonly source: number;
  readonly loaded: number;
  readonly skipped: number; // rows the transform rejected (reported separately)
}

export interface SumCheck {
  readonly label: string;
  readonly sourceMinor: string;
  readonly loadedMinor: string;
}

export interface ReconcileLine {
  readonly entity: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ReconcileReport {
  readonly ok: boolean;
  readonly lines: ReconcileLine[];
}

/** Sum a list of integer-minor-unit strings exactly, via BigInt. */
export function sumMinor(values: readonly string[]): string {
  return String(values.reduce((acc, v) => acc + BigInt(v), 0n));
}

export function reconcile(counts: readonly EntityCount[], sums: readonly SumCheck[]): ReconcileReport {
  const lines: ReconcileLine[] = [];

  for (const c of counts) {
    // Loaded + skipped should account for every source row; loaded should equal source minus skipped.
    const expected = c.source - c.skipped;
    const ok = c.loaded === expected && c.loaded >= 0;
    lines.push({
      entity: c.entity,
      ok,
      detail: ok
        ? `${c.loaded} loaded (${c.skipped} skipped of ${c.source} source)`
        : `MISMATCH: ${c.loaded} loaded, expected ${expected} (${c.source} source − ${c.skipped} skipped)`,
    });
  }

  for (const s of sums) {
    const ok = s.sourceMinor === s.loadedMinor;
    lines.push({
      entity: s.label,
      ok,
      detail: ok ? `${s.loadedMinor} matches` : `MISMATCH: source ${s.sourceMinor} vs loaded ${s.loadedMinor}`,
    });
  }

  return { ok: lines.every((l) => l.ok), lines };
}

/** Render the report as plain text for the console / a log. */
export function formatReport(report: ReconcileReport): string {
  const head = report.ok ? "RECONCILE OK — safe to proceed" : "RECONCILE FAILED — do not cut over";
  const body = report.lines.map((l) => `${l.ok ? "✓" : "✗"} ${l.entity}: ${l.detail}`).join("\n");
  return `${head}\n${body}`;
}
