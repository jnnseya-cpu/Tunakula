-- Merchant payouts: the platform pays a restaurant group what it has earned (the sum of merchantReceives on its
-- delivered orders, which — at 0% commission — is the full counter price minus any merchant-funded promotion).
-- Mirrors dispatch.rider_payout. A payout posts a balanced journal (restaurant_payable -> psp_clearing) and records
-- the draw-down here so a group's outstanding balance = lifetime earned - lifetime paid. Append-only, FORCE RLS.
CREATE TABLE money.restaurant_payout (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  restaurant_group_id text NOT NULL REFERENCES catalogue.restaurant_group (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  method text NOT NULL DEFAULT 'MOBILE_MONEY' CHECK (method IN ('MOBILE_MONEY', 'BANK')),
  reference text,
  journal_key text NOT NULL UNIQUE,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurant_payout_group ON money.restaurant_payout (restaurant_group_id, at);
CREATE TRIGGER restaurant_payout_append_only BEFORE UPDATE OR DELETE ON money.restaurant_payout
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

ALTER TABLE money.restaurant_payout ENABLE ROW LEVEL SECURITY;
ALTER TABLE money.restaurant_payout FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON money.restaurant_payout USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
