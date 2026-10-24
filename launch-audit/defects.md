# Tunakula — Defect Register (Launch Audit)

Every defect found during the break-it/fix-it audit, with severity, root cause, the fix (or why it is deferred), and the evidence that the fix holds. Severities: **P0** blocks launch and risks money/data/security; **P1** must fix before scale; **P2** should fix soon; **P3** cleanup.

Status legend: **FIXED** (code changed + tests green) · **DEFERRED** (documented, not blocking) · **BLOCKED** (needs infra/access I do not have from here).

---

## P0 — launch blockers

### D-01 — `publish-market` CLI could put a placeholder market LIVE with fabricated compliance sign-offs — **FIXED**
- **Where:** `backend/api/src/db/publish-market-cli.ts`, invoked by `deploy/go-live-coexist.sh`.
- **Root cause:** the CLI set the market `status = "LIVE"` and auto-signed **all** `READINESS_AREAS` (the §28.10 go-live compliance gates) with `signedBy: "cli"`, with no acknowledgement step. A LIVE market is cleared to take real money; a starter profile is template data (placeholder company, legal, payment and delivery-zone details). So the first bring-up produced a market that *looked* fully reviewed and could accept real payments against placeholder terms.
- **Fix:** the CLI now publishes as **PILOT**, not LIVE (PILOT is visible to the storefront — it still stops the preview fallback — but is not cleared for real money). It **refuses to run without an explicit `--starter` flag**, and prints a loud warning that readiness was machine-signed and a Super Admin must complete the real profile, re-sign readiness with real owners, and move the market to LIVE in admin → Markets before taking money. Sign-offs remain recorded as actor `"cli"` (honest machine marker, never a person's name). `go-live-coexist.sh` updated to pass `--starter` and its log/comment updated to say PILOT placeholder.
- **Evidence:** typecheck + full backend/API suites green (see evidence-ledger.md). The readiness-signing path is unchanged; only the status and the gating flag changed.

### D-02 — Next.js critical advisory in the two web apps — **FIXED**
- **Where:** `frontend/customer`, `frontend/admin`.
- **Root cause:** pinned `next` version carried a published advisory.
- **Fix:** bumped `next` to `^16.4.3` in both apps; refreshed transitive `fastify`/`fast-uri`/related deps. `npm audit` now reports **0 vulnerabilities** (prod and all).
- **Evidence:** `npm audit` clean in the gate run (evidence-ledger.md).

---

## P1 — fix before scale

### D-03 — No per-IP cap on sign-in-code requests (SMS-pumping / denial-of-wallet) — **FIXED**
- **Where:** `POST /v1/auth/otp/request`, `backend/api/src/app/auth.ts` + `backend/api/src/http/app.ts`.
- **Root cause:** `AuthService.requestCode` caps requests **per phone number** (5/hour), which stops one number being hammered but does nothing against a single device cycling through many numbers to force the SMS provider to send (and bill) thousands of messages.
- **Fix:** added an opt-in per-IP cap on `POST /v1/auth/otp/request` (`authOtpPerIp`, default 20 per IP per 10 minutes, wired on in `main.ts` via `TUNAKULA_OTP_PER_IP`), independent of the general rate limiter. Over the cap returns `429 application/problem+json` with `retry-after: 600`.
- **Evidence:** new test `backend/api/test-http/otp-rate-limit.test.ts` sends 3 requests to **different** numbers (so the per-phone cap never fires), confirms they pass, and confirms the 4th — still a fresh number — is blocked with 429; also confirms other endpoints are untouched. Full API suite green.
- **Residual:** per-instance (in-memory). For a multi-instance fleet pair it with a shared edge limiter — noted in code comments and human-actions.md.

### D-04 — Admin audit view was not country-scoped (cross-tenant audit leakage) — **FIXED**
- **Where:** `backend/api/src/app/admin.ts` — `GET /v1/admin/audit` and the analytics audit-stats rollup.
- **Root cause:** both queries read `identity.audit_log` with **no `country_iso2` filter**, so a country-scoped admin with `audit:read` saw audit rows (actors, actions, targets) from **every** country, not just their own. `audit_log` is not an RLS-isolated tenant table; isolation was expected to be in the query and was missing.
- **Fix:** both queries now filter `WHERE country_iso2 = $country`. Global/platform events (NULL country, e.g. the bootstrap grant) are correctly excluded from a country view; the chain-integrity check (`verifyAuditChain`) stays global (it is an integrity proof, not tenant data).
- **Evidence:** existing audit test (`api.test.ts` "revoking… all audited") still green — `role.granted`/`role.revoked` are written with the country and remain visible in the CD view; full API suite green.

---

## P2 / P3 — documented, not blocking (see truth-audit.md for provenance items)

### D-05 — Auth token TTL / revocation hardening — **DEFERRED (P2)**
Session tokens would benefit from shorter TTL + a server-side revocation list for stolen-device scenarios. Not a launch blocker for a phone+OTP model with short-lived sessions; documented for the next hardening pass.

### D-06 — Webhook timestamp / replay window — **DEFERRED (P2)**
Payment webhook verification should assert a timestamp freshness window in addition to signature, to blunt replay. Documented; confirm against each live PSP's webhook contract during payment-sandbox certification.

### D-07 — Duplicated helpers (`qr.ts`, `map.tsx`, apps `client.ts`) — **DEFERRED (P3)**
Minor copy-paste across the three Expo apps and web. Consolidation is cleanup, not correctness; batch it to avoid churn across four packages at once.

### D-08 — Orphaned `/v1/admin/users` surface — **DEFERRED (P3)**
Appears unused by the admin client. Verify no external caller, then remove. Low risk.
