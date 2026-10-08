-- Paid customer membership (the "Plus" subscription, the big-4's DashPass / Uber One / Deliveroo
-- Plus). An admin defines plans per country; a customer subscribes for a recurring fee and gets
-- benefits — free delivery over a minimum subtotal and/or a service-charge discount — applied at
-- quote time and FUNDED from subscription revenue at settlement, so the merchant and rider are still
-- paid in full. This is purely additive: nothing existing changes. Both tables are tenant tables
-- under FORCE row-level security per country, like every other operational table.
CREATE SCHEMA IF NOT EXISTS membership;

-- A plan an admin publishes for a market. Mutable (price and benefits can change); existing
-- subscriptions keep pointing at the plan row, so edits take effect from the next quote.
CREATE TABLE membership.plan (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency char(3) NOT NULL,
  period text NOT NULL CHECK (period IN ('MONTH', 'YEAR')),
  -- Benefits applied to a member's order:
  free_delivery boolean NOT NULL DEFAULT true,                 -- waive the customer delivery fee
  min_subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (min_subtotal_minor >= 0), -- only above this goods subtotal
  service_charge_off_bps int NOT NULL DEFAULT 0 CHECK (service_charge_off_bps BETWEEN 0 AND 10000), -- % off the service charge
  active boolean NOT NULL DEFAULT true,                        -- offered to customers to subscribe
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_country ON membership.plan (country_iso2, active);

-- A customer's subscription to a plan. One live (ACTIVE) subscription per customer per country;
-- cancelling stops auto-renewal but keeps benefits until the period ends (as the big-4 do).
CREATE TABLE membership.subscription (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  plan_id uuid NOT NULL REFERENCES membership.plan (id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED', 'EXPIRED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  auto_renew boolean NOT NULL DEFAULT true,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- A subscription is "live" while ACTIVE, or CANCELLED but still inside its paid period.
CREATE UNIQUE INDEX subscription_one_live ON membership.subscription (user_id, country_iso2)
  WHERE status IN ('ACTIVE', 'CANCELLED');
CREATE INDEX subscription_renewal ON membership.subscription (current_period_end)
  WHERE status = 'ACTIVE' AND auto_renew;
CREATE INDEX subscription_user ON membership.subscription (user_id, country_iso2);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['membership.plan', 'membership.subscription'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
