# ADR 0010 — API and database: NestJS on Fastify over PostgreSQL 16 with forced row-level security

- Status: Accepted
- Date: 2026-10-04

## Context
PRD §2.1 names NestJS for the API and PostgreSQL for the system of record. §9.5 requires tenant isolation
by country, §19 a double-entry ledger that cannot be edited, §11 an append-only custody record, §25.1
idempotent mutations and money as exact minor units, and §20 provider webhooks that arrive with no tenant.

## Decision
- **Layers.** `src/modules/*` is the pure domain (no I/O). `src/persistence/*` maps it to SQL.
  `src/app/*` is framework-free use cases (authorisation, transactions). `src/http/*` is the only
  decorator code: thin NestJS 12 controllers on Fastify. The domain runs under Node type stripping; the
  HTTP layer runs under `tsx` with `experimentalDecorators` and explicit `@Inject` tokens (no
  `emitDecoratorMetadata`), so the root `tsconfig` keeps `erasableSyntaxOnly` for everything else.
- **Migrations** are plain, ordered SQL files (`services/api/migrations`), applied under an advisory lock
  by `npm run migrate -w @tunakula/api` or at boot when `DATABASE_OWNER_URL` is set. The migrator grants the
  application role only what it needs.
- **Two roles.** The owner migrates; the API connects as `tunakula_app` (no superuser, no BYPASSRLS).
  Every tenant table has `ENABLE` **and** `FORCE ROW LEVEL SECURITY` with the policy
  `country_iso2 = platform.current_country()`. Each transaction sets `app.country` with
  `set_config(..., true)`, from the `X-Country` header. Without a country, a tenant table reads as empty.
  FORCE binds the owner too, so operational queries also run inside a country context.
- **Append-only by trigger and by privilege.** Order events, ledger entries, payment attempts and the audit
  log reject UPDATE/DELETE in a trigger (even for the owner), and the app role does not hold those privileges.
- **Balanced journals are a database invariant.** A deferred constraint trigger checks at commit that each
  journal's entries sum to zero per currency. A settlement journal is posted in the same transaction as the
  DELIVERED event (PRC-016), keyed `order:{id}:settlement`, so a retry cannot post twice.
- **Webhook routing.** A webhook carries a provider reference, not a country. A trigger copies
  `(connector, provider_ref, country)` into `payments.provider_ref_route`, a table with no RLS that the app
  role cannot read. The SECURITY DEFINER function `payments.country_for_provider_ref` returns only the
  country. The webhook is then verified, deduplicated on `(connector, event_id)` and applied inside that
  country's RLS context.
- **Audit chain (REM-005).** Each audit record hashes canonical JSON (sorted keys, since jsonb reorders
  them) together with the previous hash. Writers serialise with a transaction advisory lock. `LOCK TABLE`
  would need the UPDATE right the app role must not hold.
- **Idempotency (§25.1).** Every POST/PATCH/PUT/DELETE except webhooks needs `Idempotency-Key` (8–200
  characters). The first response is stored per (principal, key) with a request hash. A replay returns it
  with `idempotent-replay: true`; the same key with a different body gets 422. The stored status comes from
  the handler's `@HttpCode` (Nest applies it after interceptors).
- **Wire format.** Money is `{ "amount_minor": "<string>", "currency": "XXX" }`. The amount is a string
  so 64-bit values survive JSON (§25.1 shows a number; a JavaScript client would silently round it). Errors
  are RFC 9457 `application/problem+json` with a stable `code` and
  `type: https://www.tunakula.com/problems/<code>`.
- **Sign-in (IDN-001).** Phone OTP: 6 digits, 5-minute expiry, at most 5 codes an hour and 5 attempts per
  code. Codes are stored hashed and compared in constant time. A wrong attempt is committed *before* the
  error is raised, so rolling back the transaction cannot reset the counter. Tokens are HMAC-signed, last
  30 days and need a secret of at least 32 characters. There is no SMS/WhatsApp MessagingChannel adapter
  yet, so the API refuses to start unless `TUNAKULA_DEV_OTP=1` is set; in that development mode codes go to
  the log.
- **Country Profile administration (§17).** Drafts need `country_config:write` in that country and must
  validate. A first publish, and any publish whose diff touches `/money`, `/pricing`, `/payments` or
  `/labour`, needs `country_config:approve`, which only Super Admin holds, from someone other than the
  draft's author (dual control). Every mutation takes an advisory lock, reloads from the database,
  persists in the same transaction and is audited. Instances refresh from the database every 30 seconds,
  so a rollback reaches all of them within CFG-002's one minute. `npm run bootstrap-admin -w @tunakula/api
  -- +243… "Name"` grants the first Super Admin, since nobody exists yet who could grant it through the API.
- **Cash on delivery (§20.4, Appendix A).** COD is allowed only under an unexpired exception, within the
  cash cap, for accounts at least `min_account_age_days` old, and while the market's rolling 30-day COD
  share is within `max_share_bps`. The share is only meaningful over a sample, so it binds from the 100th
  order in the window. Before that, the cap, account age and the exception's end date bound the risk.
- **Rider scope.** Until zones (CFG-001) exist, a branch's `city` and `commune` stand in for the city and
  zone in authorisation: city operations dispatch within their city, riders work within their zone.

## Consequences
- Tests run against a real PostgreSQL 16: `npm run test:api` creates a throwaway database, migrates it as
  a non-superuser owner, runs the API in-process and drops the database afterwards. CI provisions the same
  two roles.
- The in-process registry is a cache. The database is authoritative, and a failed config mutation rebuilds
  the cache from the database.
- Not built yet: the MessagingChannel adapter (SMS/WhatsApp), real routing distances (the
  `RoutingProvider` port currently uses straight-line × 1.3), FX conversion for items without a
  settlement-currency price (refused with `PRICE_MISSING` rather than guessed), and zones.
