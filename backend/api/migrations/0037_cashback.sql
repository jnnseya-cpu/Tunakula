-- Cashback campaigns: a time-boxed "X% back to your wallet" promotion, funded by the platform (like coupons and
-- loyalty redemption). A delivered order placed during an active campaign earns cashback credited to the customer's
-- wallet by a sweep, idempotent per order. Additive; it reuses the wallet. The campaign table is mutable; the award
-- ledger is append-only. FORCE RLS per country.

CREATE TABLE wallet.cashback_campaign (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  name text NOT NULL,
  -- Cashback rate in basis points (e.g. 1000 = 10% back).
  percent_bps integer NOT NULL CHECK (percent_bps BETWEEN 1 AND 10000),
  -- Minimum order subtotal (goods + fees, the order total) to qualify; 0 = no minimum.
  min_spend_minor bigint NOT NULL DEFAULT 0 CHECK (min_spend_minor >= 0),
  -- Most cashback one order can earn (minor units); NULL = uncapped.
  max_cashback_minor bigint CHECK (max_cashback_minor IS NULL OR max_cashback_minor > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cashback_campaign_window ON wallet.cashback_campaign (country_iso2, active, starts_at, ends_at);

ALTER TABLE wallet.cashback_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.cashback_campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON wallet.cashback_campaign USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

CREATE TABLE wallet.cashback_award (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  order_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES wallet.cashback_campaign (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- At most one cashback award per order (idempotent sweep).
CREATE UNIQUE INDEX cashback_award_order ON wallet.cashback_award (order_id);
CREATE INDEX cashback_award_user ON wallet.cashback_award (user_id, country_iso2, created_at DESC);

ALTER TABLE wallet.cashback_award ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.cashback_award FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON wallet.cashback_award USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A cashback credit is a new wallet transaction kind.
ALTER TABLE wallet.transaction DROP CONSTRAINT IF EXISTS transaction_kind_check;
ALTER TABLE wallet.transaction ADD CONSTRAINT transaction_kind_check CHECK (kind IN ('TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT', 'REFERRAL', 'LOYALTY', 'CASHBACK'));
