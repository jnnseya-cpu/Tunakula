-- Repeat / subscription orders: a customer turns a cart into a recurring order ("my usual, every Monday at noon").
-- Each run places a normal order funded from the customer's wallet; if the balance is short the run is skipped (no
-- surprise charge) and the next one is still scheduled. The subscription is mutable (pause/cancel); the run log is
-- append-only. Additive — it reuses ordering and the wallet. FORCE RLS per country.

CREATE TABLE ordering.order_subscription (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  customer_id uuid NOT NULL REFERENCES identity.app_user (id),
  branch_id uuid NOT NULL,
  -- The cart to reorder: [{ item_id, quantity, options?, addons? }].
  items jsonb NOT NULL,
  -- Where to deliver: { lat, lng }.
  delivery jsonb NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('DAILY', 'WEEKLY')),
  -- Weekday 0=Sunday for WEEKLY; NULL for DAILY.
  weekday integer CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  -- Local time of day, 'HH:MM', in the market's time zone.
  at_time text NOT NULL,
  next_run timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED')),
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_subscription_due ON ordering.order_subscription (country_iso2, status, next_run);
CREATE INDEX order_subscription_customer ON ordering.order_subscription (customer_id, created_at DESC);

ALTER TABLE ordering.order_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordering.order_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON ordering.order_subscription USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

CREATE TABLE ordering.subscription_run (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  subscription_id uuid NOT NULL REFERENCES ordering.order_subscription (id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  order_id uuid,
  status text NOT NULL CHECK (status IN ('PLACED', 'SKIPPED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One run per subscription per occurrence (idempotent sweep).
CREATE UNIQUE INDEX subscription_run_occurrence ON ordering.subscription_run (subscription_id, scheduled_for);

ALTER TABLE ordering.subscription_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordering.subscription_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON ordering.subscription_run USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
