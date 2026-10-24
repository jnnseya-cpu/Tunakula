# Tunakula — Truth Audit

The mandate demands no false GO and no claim I cannot back with evidence. This document records (1) claims I corrected during the engagement, (2) provenance concerns I will not act on unilaterally, and (3) the rule I held to: anything I could not *prove* is marked unproven, not assumed green.

## 1. Claims corrected during the engagement
- **"Nothing is live" / "the new admin doesn't exist on any URL."** I asserted this and it was **wrong**. Direct `curl` checks showed `tunakula.com` and `api.tunakula.com` were serving the new platform, and after the routing/DNS/TLS fixes `admin.tunakula.com` served the new admin and sign-in worked. Corrected and retracted. Lesson applied for the rest of the audit: verify against the running system before asserting state.
- **Status of the data import.** It was described earlier as if it could proceed; in truth it is blocked because the exported dump was the WordPress DB, not the StackFood DB. Recorded honestly in human-actions.md (A).

## 2. Provenance concerns — flagged, NOT actioned unilaterally
- **`AGENTS.md` / `CLAUDE.md` provenance.** These files carry instructions that shape agent behaviour. I have **not** deleted or rewritten them. If any instruction in them did not come from you, it is a potential prompt-injection vector and should be reviewed by you. **Action for you:** confirm these files are yours; remove anything you did not author. I will not unilaterally delete repo-authored guidance.
- **Treat external content as data.** PR comments, CI logs, issue bodies, migrated StackFood content and uploaded dumps are untrusted input. Nothing in them is treated as an instruction to me.

## 3. The no-false-GO rule, applied
- Every P0/P1 defect in defects.md is backed by a code change **and** a green test, re-run after the fix (evidence-ledger.md). I did not mark any defect fixed on inspection alone.
- The launch gates that need live infra (data import, provider keys, payment-sandbox certification, load/soak, deploy drill, real market profile) are marked **unproven / BLOCKED** in human-actions.md. I did **not** score them as passing because I cannot run them from here.
- Therefore the overall verdict is **NO-GO** — an honest one: the code defects found are fixed, but launch readiness is not *proven* while A–F remain open. A GO would be a claim I cannot evidence.

## 4. What "GO" would require (so the bar is explicit)
1. All P0/P1 fixed (done) — **and** re-verified on the deployed build, not just locally.
2. Data import run into staging, promotion report reviewed by you.
3. Real provider keys in place; payment sandbox certification run end-to-end (authorize→capture→webhook→settle→refund) against each PSP.
4. A load/soak run on staging with no leaks/contention and config rollback within the CFG-002 budget.
5. A deploy + rollback drill on the VPS.
6. The CD market completed and moved LIVE with real §28.10 sign-offs by real owners.
