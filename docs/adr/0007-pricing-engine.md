# ADR 0007 — Pricing engine: zero commission, service charge, distance ladder, 70/30 rider split

- Status: Accepted (interpretations below need product sign-off)
- Date: 2026-10-04

## Context
PRD §18 sets six commercial rules and gives worked tables (§18.1, §18.3, §18.5, §18.8). Every rate is
per-market configuration; money must follow MR-1…MR-10.

## Decision
- Rates live in a new `pricing` block of the Country Profile (service charge, all-in pricing flag,
  per-km rate, cap, cap-hold distance, band size, band step, rural share, rider share, bonus share,
  surge cap, discovery radius, promise). Amounts are in the settlement currency (MR-5).
- Fees are computed as exact fractions and rounded **once, half-to-even**. This is the only rounding rule
  that reproduces the PRD's tables (5.00 × 1.3³ = 10.985 → 10.98; rural 4.875 → 4.88; rider 5.915 → 5.92).
- The rider's 70% is taken from the fee actually charged (after band steps and surge); the platform keeps
  the remainder, so the split never loses a minor unit.
- Commission is always zero; the breakdown carries it explicitly so settlement statements can show it.
- `service_charge_revenue` is added to the §19.3 ledger accounts; each completed order posts one balanced
  journal separating goods, service charge, rider share (plus tips) and the platform's delivery share.

## Interpretations (to confirm)
| Topic | Reading |
| --- | --- |
| Fractional distance | Charged per **started** kilometre, minimum 1 km (2.3 km → 3 km) |
| POS service charge | Charged only when the platform processes the payment (§18.1 table); a merchant's own cash sale carries none |
| Merchant-funded delivery promotion | Limited to the delivery fee and to the merchant's own sale; rider still paid on the full fee |
| Surge suppression | A suppressed surge charges the unsurged fee and records that suppression happened |
| All-in display | Item prices shown with the service charge added; per-item rounding can differ from the order total by a minor unit — the order total is authoritative |

## Discrepancies found in the PRD
- **§18.8, 35.00 at 16 km**: the table shows platform gross 6.04; exact arithmetic gives **6.03**
  (3.50 service charge + 8.45 − 5.92 rider). The table appears to use the unrounded rider share.
- **§19.1 MR-5 and §19.2** still mention merchant commission; **§18.1 (v4.2) sets it to zero** — §18 is followed.
- **§19.3** lists no account for the service charge, now the main revenue line — added.
- **§25.1** puts money on the wire as `{ "amount_minor": 1850 }` (a JSON number), but MR-1 allows 64-bit
  amounts and JSON numbers are exact only to 2⁵³. Proposal: keep the field name, send it as a string.

## Not yet covered
Taxes (TaxEngine adapter), discovery-radius expansion (needs travel-time models), price-parity monitoring
(PRC-014), bonus qualification criteria (computed by the merit system, §15).
