-- Instant rider cash-out: a rider withdraws their earned balance (rider_payable) to mobile money,
-- the DoorDash Fast Pay / Uber Instant Pay feature. Append-only, like every money-movement record.
-- A rider's earned balance is the sum of riderReceives on their delivered orders minus what they have
-- already cashed out; a payout posts a balanced journal (rider_payable -> psp_clearing).
CREATE TABLE dispatch.rider_payout (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  method text NOT NULL DEFAULT 'MOBILE_MONEY' CHECK (method IN ('MOBILE_MONEY', 'BANK')),
  journal_key text NOT NULL UNIQUE,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_payout_rider ON dispatch.rider_payout (rider_id, at);
CREATE TRIGGER rider_payout_append_only BEFORE UPDATE OR DELETE ON dispatch.rider_payout
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

ALTER TABLE dispatch.rider_payout ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.rider_payout FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON dispatch.rider_payout USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
