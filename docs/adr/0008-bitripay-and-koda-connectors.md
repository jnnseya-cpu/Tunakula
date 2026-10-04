# ADR 0008 — BitriPay and KODA payment connectors

- Status: Accepted (field-level mappings marked VERIFY need checking against each provider's openapi.json)
- Date: 2026-10-04

## Context
PRD §20: BitriPay is the group payment rail and default orchestration provider; direct connectors use the
same `PaymentConnector` port. KODA verifies mobile-money payments from the operator SMS reference.
Both providers' developer documentation was supplied on 2026-10-04. Neither `openapi.json` was reachable
from the build environment (network policy), so request/response field names not stated in the prose
documentation are isolated in each adapter's `mapping.ts` and marked VERIFY.

## Decision
- **Shared**: `ConnectorUnavailableError` (never sent → safe to re-route) and `ConnectorOutcomeUnknownError`
  (maybe sent → resolve by status) move into `ts-contracts`. A small HTTP transport classifies connection
  failures and HTTP 429 as "not sent", and 5xx/timeouts as "outcome unknown" (ADR 0003). A `NOT_SUPPORTED`
  reason code is added for operations a rail does not offer.
- **BitriPay**: payment intents with `amount_minor`, operator allow-list per payer country and
  `Idempotency-Key` on every money-moving call; refunds against the refundable amount; payouts to mobile
  money or bank (PayoutConnector); settlement-cycle statements for reconciliation; webhooks verified by the
  endpoint HMAC **and** the platform Ed25519 signature from `/v1/keys`. `AMBIGUOUS` / `MANUAL_REVIEW`
  map to in-flight — never re-routed. Merchants can be BitriPay connected accounts addressed with
  `BitriPay-Account`, so funds settle to the merchant of record and Tunakula never holds them (§2.2).
- **KODA**: intent → hosted checkout (or server-side `submitReference`) → signed `payment.verified` /
  `payment.verified.late`. Replay and MSISDN-suffix challenges keep the intent open. KODA moves no money
  back, so refunds return `NOT_SUPPORTED` and must go through a rail that can (BitriPay or wallet credit).
  Because the documentation does not describe idempotency, the connector enforces it with an
  `IdempotencyStore` (in-memory default; PostgreSQL in production).
- Both connectors pass the full §20.7 certification suite against fakes that follow each provider's
  documented sandbox (BitriPay magic MSISDNs, KODA magic references).
- Live keys come from Secret Manager; publishable `pk_` keys are refused server side.

## Consequences
- Before enabling either connector in a Country Profile: fetch `openapi.json`, settle every VERIFY item,
  run certification against the provider's real sandbox, then live micro-transactions (§20.7).
- The environment's network policy must allow `api.bitripay.com` and `kodajnn.com` for that work.
- The suite was strengthened: tampered webhooks are detected for any payload shape.
