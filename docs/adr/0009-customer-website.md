# ADR 0009 — Customer website: Next.js (current major), editorial design system, real product imagery

- Status: Accepted (palette, type and logo superseded by ADR 0012)
- Date: 2026-10-04

## Context
PRD §2.1 specifies the customer website in Next.js 14 (SSR/SEO). Product direction (2026-10-04): a premium,
ultra-realistic site that looks nothing like an AI-generated platform. Site: https://www.tunakula.com;
single contact inbox: info@tunakula.com.

## Decision
- **Next.js 16 instead of 14.** Next.js 14 carries unpatched critical advisories (remote code execution,
  SSRF) fixed only in later majors; NFR-06 and §28.7 forbid shipping with open high/critical findings and CI
  audits at `high`. The App Router architecture the PRD intends is unchanged.
- **Design system** (`frontend/customer/app/globals.css`): warm paper and ink, the brand terracotta and deep teal
  from the runtime brand tokens, an editorial serif for display and Inter for UI, tabular figures for every
  amount, hairline rules and numbered sections. No gradients, glass, emoji illustration or stock imagery.
- **Imagery is the product itself**: real app screens (tracking with landmark addressing, mobile-money
  checkout, rider job offer, offline POS) and the two-logo receipt. Photography slots are reserved for real
  photos from merchants, Legacy Tunakula media or a commissioned shoot — never stock or AI food images
  (Appendix C.5). No image host was reachable from the build environment.
- **Numbers are real**: fees, rider shares and comparisons come from PRD §18 and are cross-checked against
  the pricing engine (the rider ladder is computed by `backend/api` pricing).
- Static export for now (`output: "export"`); server rendering per route can be enabled when the API exists.
- `scripts/screenshots.mjs` renders every route in Chromium at desktop and mobile sizes for review.
