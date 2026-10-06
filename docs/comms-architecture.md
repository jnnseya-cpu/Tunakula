# Communication Event Architecture

One event engine for every message Tunakula sends — **135 events across 15 categories**, fanning
out over five channels to the four audiences the platform serves.

- **Channels:** email · in-app · SMS · push · WhatsApp
- **Audiences:** customer · restaurant · rider · console (admin/operations)
- **Mandatory notices (32):** security, payment, legal, safety and suspension messages that bypass a
  recipient's notification opt-outs — they reach a muted recipient on a durable channel (email/SMS,
  and always in-app).

## One source of truth

The catalogue lives in `shared/ts-contracts/src/comms.ts` (`@tunakula/ts-contracts/comms`), so it
depends on neither side (ADR 0011). Both consumers read the same data:

- the **backend** dispatches against it (an emitted `key` resolves to its channels, severity and
  mandatory flag), and
- the **admin console** renders it at **Plateforme → Communications** (`/comms`).

Because there is one catalogue, a channel wiring or a mandatory flag is defined once and can never
drift between what the backend sends and what operators see.

Every event carries a stable machine `key` (e.g. `order.delivered`), a short `title`, the
recipient-facing `subject` (French-first, with `{{tokens}}`), a `severity`
(info/success/warning/critical), its `audience`, its `channels`, and whether it is `mandatory`.
`commsSummary()` gives the headline counts and per-channel / per-audience coverage; `COMMS_EVENTS`
is a flat `key → event` lookup. The counts and invariants (unique keys, every event reaches in-app,
mandatory notices always have a durable channel) are locked by `shared/ts-contracts/test/comms.test.ts`.

## Categories

Identity & account · Login & security · Orders (customer) · Orders (restaurant) · Dispatch (rider) ·
Payments & wallet · Payouts & earnings · Promotions & loyalty · Reviews & ratings · Rider onboarding ·
Restaurant onboarding & store · Scheduled & subscription orders · Support & disputes ·
Compliance, safety & privacy · Platform & operations.

## Admin console

`/comms` shows the catalogue live: headline tiles, channel-coverage bars, per-audience counts, a
template-QA panel that previews the branded email for any event and fires a test to the operator
(recorded in sandbox until a provider key is set), a recent-deliveries log, and every event grouped
by category with its severity, mandatory flag, audiences and channels.

## Sending (next step)

The dispatch engine and channel adapters (email, SMS/WhatsApp via the messaging adapter, push, and
the in-app feed) deliver an event to a recipient by reading its catalogue entry, honouring opt-outs
except for `mandatory` events, rendering the branded template, and writing an append-only delivery
record — the same pattern as the custody/ledger/audit tables. The catalogue and the console land
first so the contract is fixed before the adapters are wired.
