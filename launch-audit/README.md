# Tunakula — Launch Audit (Final Report)

**Verdict: NO-GO — honest hold.** The code defects this audit found are **fixed and tested**; the remaining launch gates are **operational and need you** (live infra, credentials, real data). A GO today would be a claim I cannot prove from this environment, so I am not making one.

Date: 2026-10-24 · Branch: `claude/exciting-turing-k5r4jb`

---

## Why NO-GO (in one paragraph)
Everything I could attack from here, I attacked: static/type analysis, the full unit/adapter/HTTP-e2e suites against real Postgres with production RLS roles, both web builds, and a dependency scan, plus targeted adversarial review of the auth, market-publish, and audit-isolation paths. I found four real defects (two P0, two P1), fixed all four in code, and proved each with a green test after a **full** regression re-run — a run that also caught a self-inflicted dependency-version regression, which I then fixed. `npm audit` is at **0 vulnerabilities**. But six launch gates (data import, provider keys, payment-sandbox certification, load/soak, deploy drill, real market profile) cannot be *proven* without a running environment, live credentials, and your StackFood data — none of which I can reach from here. Unproven is not GO.

## What's in this folder
- **defects.md** — every defect, severity, root cause, fix, and evidence. (D-01…D-08)
- **evidence-ledger.md** — the exact gate commands and their pass/fail counts (ground truth).
- **truth-audit.md** — claims I corrected, provenance concerns I flagged but did not action, and the no-false-GO rule.
- **human-actions.md** — the six gates only you can close (A–F), each with exactly what I need.
- **cycle-reports/cycle-01.md** — the break→fix→prove→regress loop for this pass.

## Defects, at a glance
| ID | Sev | Title | Status |
|----|-----|-------|--------|
| D-01 | P0 | `publish-market` could go LIVE with fabricated compliance sign-offs | **FIXED** (now PILOT + `--starter` + warning) |
| D-02 | P0 | Next.js critical advisory in both web apps | **FIXED** (`next ^16.4.3`, audit clean) |
| D-03 | P1 | No per-IP cap on sign-in-code requests (SMS pumping) | **FIXED** (`authOtpPerIp`, new test) |
| D-04 | P1 | Admin audit view not country-scoped (cross-tenant leak) | **FIXED** (`country_iso2` filter) |
| D-05…D-08 | P2/P3 | TTL/revocation, webhook replay window, dup helpers, orphaned route | **DEFERRED** (documented) |

## The six gates that keep this NO-GO (see human-actions.md)
A. StackFood DB dump from **cd.tunakula.com** (the WordPress dump was the wrong database).
B. Real provider API keys (maps / payments incl. mobile money + Afrimoney / SMS / AI), entered by you.
C. Payment sandbox certification, end-to-end, against each PSP sandbox.
D. Load / soak test on a running staging env.
E. Deploy + rollback drill on the VPS.
F. Complete the real DRC market profile and move it LIVE with real §28.10 sign-offs.

## The fastest path to GO
1. Send me the **StackFood** `.sql` (cd.tunakula.com) → I run the migrator into staging and hand you a promotion report.
2. Deploy the audit commits (human-actions.md E) → re-verify P0/P1 on the deployed build.
3. Enter provider keys (B) → I run payment sandbox certification (C).
4. I run load/soak (D) against staging.
5. You complete + LIVE the CD market (F).
When 1–5 are green, I will re-score and — only then, if everything holds — give a GO with the evidence behind it.
