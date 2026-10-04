# ADR 0012 — Brand: the Tunakula logo as supplied, and its palette everywhere

- Status: Accepted
- Date: 2026-10-04
- Amends ADR 0009 (website design system) and the customer brand in `backend/api/src/modules/config/brand.ts`

## Context
The owner supplied the Tunakula logo (chef mascot, "TUNAKULA — GET TO EAT") with the instruction to use it
exactly as it is and to brand the whole platform in its colours. The website had a placeholder typeset
wordmark and a terracotta/teal palette; the API served placeholder theme tokens.

## Decision
- **The logo file is the master, unaltered**: `shared/brand/tunakula-logo.jpg` (1080×1080 JPEG, as supplied).
  Copies are byte-identical: the website header and footer and printed-receipt mock-up
  (`frontend/customer/public/brand/`) and the favicon (`frontend/customer/app/icon.jpg`).
  `tools/guard-brand.ts` (in `npm run guard`) fails the build if any copy differs: no re-encoding,
  cropping, recolouring or redrawing.
- **Palette sampled from the logo**: navy `#1F305D` (banner, tagline box, ring), yellow `#FAD20E`
  (lettering, circle), orange `#EB771A` and gold `#F4D620` (the background gradient), white.
- **Contrast rules (WCAG 2.2 AA)**: yellow carries navy text (8.7:1), exactly as the logo's lettering;
  navy carries white or yellow. White on the logo orange is 2.9:1 and fails, so orange is used for the
  gradient, dots and icons, never behind small text; accent text on light backgrounds uses `#B4500A` (5.1:1).
- **Type**: a heavy condensed display face (Anton) echoes the logo's lettering for headings; Inter stays
  for text. The hero headline is set in capitals with the second line in white outlined in navy, like
  the logo.
- **Runtime theme for the apps** (`TUNAKULA_BRAND`): primary yellow / on-primary navy, secondary navy /
  on-secondary white; dark mode on a deep navy background. The theme passes the existing validator, and a
  test pins the palette to the logo's colours. English tagline: "Get to eat".
- **Not changed**: the Groupe Nseya internal brand for the admin console (ADR 0006, PRD §17.1), and each
  merchant's own colours on their storefront.

## Consequences
- Printed documents use the logo through the brand's print asset; thermal printers render it in greyscale.
  A dedicated monochrome version, if the owner wants one, would be a new file supplied by them, not a
  derivative made here.
