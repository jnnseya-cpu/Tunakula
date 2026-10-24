# Tunakula — Human Action List (what only you can do)

The audit mandate requires an honest account of what I **cannot** verify or do from this environment, because it needs infrastructure, credentials, or real data I reach only through you. None of these are optional for a real GO; each is a gate that stays **unproven** until done on real infra.

Nothing below is a code defect. These are operational gates.

---

## A. Data migration from the old StackFood platform — **BLOCKED (need correct DB dump)**
- **State:** the migrator (StackFood v8.0 MySQL → Postgres staging `migration.*`) is built and unit-tested, including add-ons and variations. It has **not** been run against your real data.
- **Why blocked:** the dump you exported (`u400404954_vzzzK.sql`) is the **WordPress** site database (`wp_*` tables), not the StackFood application database. The StackFood tables (`add_ons`, `food`, `restaurants`, `orders`, …) live behind **cd.tunakula.com**, which still serves the old admin.
- **What I need from you:** a `.sql` (or direct read access) of the **StackFood** database behind cd.tunakula.com — the one with `restaurants`, `food`, `add_ons`, `orders` tables. Then I run the migrator into staging, you review the promotion report, and only then is the live promotion a separate, reviewed step.

## B. Provider API keys (maps / payments / SMS / AI) — **BLOCKED (need live credentials, entered by you)**
- **State:** the Integrations panel (admin) and every adapter (BitriPay, Stripe, Twilio/SMS, VAPID push, Maps, AI) are built. Integration secrets are **never** returned to clients and must be entered in the admin console (or environment), not committed.
- **What I need from you:** enter real keys in admin → Integrations (or the server `.env`): Maps, payment PSP(s) incl. the mobile-money providers (M-Pesa, Orange Money, Airtel Money, Afrimoney, card), SMS sender, AI. Until then those features run in their non-configured / sandbox state.

## C. Payment sandbox certification (prove money moves correctly) — **BLOCKED (need sandbox credentials + live run)**
- Each `PaymentConnector` has a certification suite, but **end-to-end sandbox runs** against the real PSP sandboxes (authorize → capture → webhook → settle → refund, with the timestamp/replay check from D-06) must run with live sandbox keys. I cannot do this without the credentials in (B) and outbound access to the PSPs.

## D. Load / soak test — **BLOCKED (need a running staging env)**
- No load or soak run has been performed. This needs the coexist stack actually running on the VPS with a representative market so I can drive concurrent order/dispatch/payment traffic and watch for leaks, lock contention, and the config-refresh/rollback timing (CFG-002 < 1 min). Give me a running staging URL + a way to run the driver against it.

## E. Deploy drill (prove the deploy + rollback works) — **BLOCKED (need VPS execution)**
- The CD workflow (`.github/workflows/deploy-web.yml`) and `go-live-coexist.sh` are in place, gated by the full `npm run check`. A real drill — deploy a commit, confirm API health, then roll back — must run on the VPS. From here I can prepare and push; I cannot execute on the server.
- **To deploy the commits from this audit:** on the VPS,
  ```
  cd /srv/Tunakula  # or your checkout (VPS_APP_DIR)
  git pull
  docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml build --pull
  docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml up -d
  ```
  (or just push to the deploy branch with `DEPLOY_WEB=true` and the `VPS_*` secrets set, and the workflow does it).

## F. Complete the real DRC (CD) market profile — **BLOCKED (your business/legal data + admin sign-in)**
- The market is published only as a **PILOT placeholder** (see defects D-01). Before taking real money, sign in to admin → Markets and fill in the real company, legal, payment and delivery-zone details, re-sign the §28.10 readiness areas with real owners, and move the market to **LIVE**.

---

### Summary
Code-side P0/P1 defects found in this audit are **fixed and tested** (see defects.md / evidence-ledger.md). But **A–F are real GO gates that remain unproven on live infra.** Per the mandate, that means the honest verdict is **NO-GO** until A–F are closed — not because the code failed, but because launch readiness cannot be *proven* from here without them.
