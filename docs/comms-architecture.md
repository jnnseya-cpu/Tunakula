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

## The dispatch engine (backend)

`NotificationService` (`backend/api/src/app/comms.ts`) delivers an event to a recipient: it reads the
catalogue entry, renders the subject, decides the channels — honouring the recipient's opt-outs,
except for `mandatory` events — sends each through its channel adapter, and writes an **append-only
delivery-log row per channel**. In-app deliveries also land in the recipient's inbox. A `dedupeKey`
makes an emission idempotent, so the same event never delivers twice (e.g. an approval on a retry).
The pure decisions (`resolveEvent`, `renderSubject`, `planChannels`) live in
`modules/comms/dispatch-core.ts` and are unit-tested on their own.

Channel senders are injected (`ApiDeps.senders`). Production wires real email / SMS / WhatsApp /
push adapters; the default **sandbox sender** records every channel as `logged`, so the whole flow is
exercisable with no provider keys. Statuses: `sent` (a provider accepted it), `logged` (sandbox),
`suppressed` (opted out), `failed`.

### Real SMS / WhatsApp adapter

`MessagingChannel` (`modules/messaging/messaging.ts`) is the port for sending a person an SMS or
WhatsApp message. It reports four outcomes so a caller never confuses failure with "maybe sent"
(ADR 0003): `sent` (with the provider's message id), `failed` (a definite 4xx rejection), `unavailable`
(it never left — network/DNS/429), `unknown` (timeout or 5xx). `modules/messaging/twilio.ts` is a real
Twilio adapter — one provider for both SMS and WhatsApp (Twilio's WhatsApp Business API) — over a
swappable HTTP transport.

`app/channels.ts` bridges it into both seams, so one provider serves everything:
- `messagingSender` — the dispatch engine's `ChannelSender`: SMS and WhatsApp go through the provider
  (resolving the recipient's phone from identity), and email/push/in-app are recorded as `logged`
  until their own adapters are wired; an `unavailable`/`unknown`/`failed` provider outcome becomes a
  `failed` delivery row with the reason kept.
- `otpViaMessaging` — sign-in's `OtpSender`, so the one-time code uses the same provider.

Configure it in production with `TUNAKULA_MESSAGING_PROVIDER=twilio`, `TUNAKULA_TWILIO_ACCOUNT_SID`,
`TUNAKULA_TWILIO_AUTH_TOKEN`, and `TUNAKULA_TWILIO_SMS_FROM` and/or `TUNAKULA_TWILIO_WHATSAPP_FROM`.
Without a provider, development still runs with `TUNAKULA_DEV_OTP=1` (codes logged) and the sandbox
sender.

### Store (migration `0008_comms`, all FORCE RLS by country)

- `comms.delivery` — append-only log: every event × channel × recipient with its status.
- `comms.notification` — the in-app inbox (mutable: a notification is marked read).
- `comms.preference` — per-channel opt-outs; no row means on, and `mandatory` events ignore it.

### Endpoints

- `GET /v1/notifications` · `POST /v1/notifications/:id/read` — the recipient's inbox and read state.
- `GET|POST /v1/notifications/preferences` — the recipient's channel opt-outs (in-app can't be off).
- `GET /v1/comms/deliveries` — the delivery log (platform-config authority).
- `POST /v1/comms/test` — fire any catalogue event to yourself; the console's "send test to me".

### Real emissions

- **Rider decisions** — approving/rejecting a rider (`/v1/ops/rider-applications/:id/{approve,reject}`)
  dispatches `rider.approved` / `rider.rejected` to the applicant, once (deduped on the application id).
- **Order lifecycle** — a state change on an order dispatches the matching `order.*` event to the
  customer: placed, accepted, preparing, ready, picked up (names the rider), delivered, rejected,
  cancelled, delivery failed, and `payment.refund_processed` on refund. Each step is deduped
  (`order:{id}:{state}`) so it notifies exactly once, and the dispatch runs outside the state
  transaction so a messaging failure never blocks the order. With a WhatsApp/SMS provider configured
  (see above), these go out as WhatsApp or SMS as well as in-app, per the catalogue.
  (A prepaid order becomes PLACED when payment confirms, via the payment path; that `order.placed`
  emission is the one remaining wiring point.)

Every emission is best-effort and outside the originating transaction, so a notify failure never
undoes the action. The console's "Send test" and "Recent deliveries" read these endpoints, falling
back to a local sandbox record when the API is unreachable.
