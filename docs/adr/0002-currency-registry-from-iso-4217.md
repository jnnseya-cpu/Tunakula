# ADR 0002 — Currency Registry seeded from ISO 4217 List One plus a policy overlay

- Status: Accepted (volatility classes: Proposed, pending Group Finance)
- Date: 2026-10-04

## Context
PRD §19.4 requires the registry to be seeded from official ISO 4217 data, never hand-typed, and to hold
every Appendix A currency from day one. It also needs fields ISO does not publish: volatility class,
FX sources, controls and redenomination history.

## Decision
- `shared/ts-money/data/iso4217.json` is **generated** by `scripts/generate-iso4217.ts` from SIX's
  `list_one.xml` (shipped verbatim in the `currency-codes` package; SIX's site is not reachable from the
  build environment). Fund codes and instruments without minor units are excluded.
- `data/registry-policy.json` overlays platform policy. Unlisted currencies default to `VOLATILE`
  (shortest practical FX TTL) until reviewed — conservative by design. PEGGED is assigned only to
  currencies with a formal peg; MANAGED to major hard currencies.
- Redenominated codes (MRO, STD, SLL) are kept as `RETIRED` with `replacedBy`, effective date and
  conversion factor, so legacy data can be read and converted by journal (§19.6). ZWL→ZWG is not
  recorded yet because its conversion was not a fixed factor; add it when the migration audit needs it.
- Localised names and symbols come from CLDR at runtime via `Intl`, not from the registry.
- The country's volatility class is taken from the registry, not the Country Profile (§7.2 lists
  `money.volatility_class`): one currency must not be classed differently in two markets.

## Consequences
- New ISO publications: bump `currency-codes` or pass a newer `list_one.xml`, re-run the seed, review the diff.
- Group Finance must approve the volatility baseline; agent A9 proposes changes monthly (§19.5).
