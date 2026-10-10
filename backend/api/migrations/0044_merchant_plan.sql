-- Optional merchant subscription plans. Tunakula stays 0% commission for EVERY merchant on every channel; a merchant
-- can additionally be put on a paid plan that is billed monthly (netted from their payout) and unlocks perks such as
-- featured placement in discovery. The default is the implicit FREE plan (no fee, no perks), so nothing changes for a
-- merchant unless they are moved onto a paid plan. Plans are per market; a restaurant group is assigned exactly one.
CREATE TABLE catalogue.merchant_plan (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  monthly_fee_minor bigint NOT NULL DEFAULT 0 CHECK (monthly_fee_minor >= 0),
  currency char(3) NOT NULL,
  -- Perks. `featured` boosts the group's branches in discovery with a badge; more perks can be added to `perks`.
  featured boolean NOT NULL DEFAULT false,
  perks jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX merchant_plan_code ON catalogue.merchant_plan (country_iso2, code);

ALTER TABLE catalogue.merchant_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.merchant_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON catalogue.merchant_plan USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A restaurant group's current plan (FREE by default — the 0% commission, no-fee baseline).
ALTER TABLE catalogue.restaurant_group ADD COLUMN plan_code text NOT NULL DEFAULT 'FREE';
