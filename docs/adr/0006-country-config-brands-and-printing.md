# ADR 0006 — Country Config publishing, runtime brand themes and two-logo printing

- Status: Accepted
- Date: 2026-10-04

## Context
PRD §17: a country is launched by publishing a validated Country Config, with no code change; brands are
design-token sets served at runtime in light and dark (§17.1, Appendix B). CFG-002 / ADP-001 require
versioning, diff and fast rollback; §28.10 defines the go-live readiness review. Product direction
(2026-10-04): every printed document carries both the Tunakula logo and the business's own logo.

## Decision
- **Country Config** is derived from the published Country Profile plus the brand — never hand-edited —
  and is the payload of `GET /v1/countries/{iso2}/config` (§9.5). Internal settings (fraud profile,
  connector ids, KYC rules) are excluded.
- **Publishing** (`CountryConfigRegistry`): append-only versions (DRAFT → PUBLISHED → SUPERSEDED).
  A draft must pass the schema; publication additionally requires production validation (no synthetic
  profiles), a known brand and theme, a regional API host for the profile's data residency, and only
  registered, certified connectors. A market's first move to PILOT or LIVE requires all eight §28.10
  readiness areas signed. Rollback republishes the previous content as a new version (history is never
  rewritten). Each publication emits `country.config.published`.
- **Brands**: tokens for colour roles with paired on-colours, radius and typography, in light and dark;
  validated for WCAG 2.2 AA (4.5:1) and a 14 px minimum body size. Themes carry a content hash so apps
  refetch only on change; brand updates take effect without republishing the country.
- **Both brands use the Tunakula logo and palette** (owner decision 2026-10-04, ADR 0012). The customer
  theme leads with yellow on navy text; the admin console leads with navy and white text, yellow for
  highlights. The earlier Groupe Nseya teal internal theme is retired.
- **Printing**: every printable document (receipt, order label, invoice, kitchen ticket, collection slip,
  booking confirmation, till report, payout statement) is composed through `composePrintDocument`, which
  places the market brand's monochrome print logo and the issuing business's logo (its profile picture).
  Printer adapters refuse documents without both (`assertPrintable`). If a business has no logo yet, its
  name prints in the logo position and the merchant is prompted to upload one — a missing logo never
  blocks a sale.

## Consequences
- Business logos for thermal printing need a monochrome conversion in the media pipeline.
- §17's `delivery_fee_formula` and `rider_kyc_rules` are now references in the Country Profile.
