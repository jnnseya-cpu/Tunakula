# ADR 0003 — Payment routing falls back only when provably safe

- Status: Accepted
- Date: 2026-10-04

## Context
PRD §20.4: offer the next eligible connector on outage or specific failures, but *never retry a payment
that may still succeed*. Mobile money is asynchronous and networks are unreliable, so "it failed" is
often unknown.

## Decision
`PaymentRouter.pay` tries routes in ranked order (Country Profile priority, then measured success rate,
then cost) and moves to the next route only when:
- the connector reports the request was **never sent** (`ConnectorUnavailableError`), or
- the provider returns a **terminal failure with a route reason** (`PROVIDER_UNAVAILABLE`, `TIMEOUT`,
  `CURRENCY_NOT_SUPPORTED`).

It stops and returns when the payment succeeds, is pending (async — never re-routed), is declined for a
customer reason (the app offers another method instead), or the outcome is **unknown** (any other error:
status must be polled before anything else happens). Each route uses its own derived idempotency key, so
replays on a route are idempotent and fallbacks are distinct attempts. Per-connector circuit breakers and
a minimum success-rate floor remove unhealthy routes.

## Consequences
- Connectors must throw `ConnectorUnavailableError` only when certain nothing reached the provider.
  The certification suite (§20.7) is where that is checked against each provider sandbox.
- Late success after expiry (refund or revival) is handled by the order/payment state machine, not here.
