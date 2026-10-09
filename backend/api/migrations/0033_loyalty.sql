-- Loyalty points: customers earn points on delivered orders and redeem them for wallet credit (funded by the
-- platform from promotion_expense at redemption). Points are a running sum of an append-only ledger, like the
-- wallet. Earn and redeem rates are set per market. Additive. Tenant tables, FORCE RLS; the ledger is append-only.

CREATE TABLE wallet.loyalty_point (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  -- Signed points: earning is positive, redeeming is negative.
  points bigint NOT NULL CHECK (points <> 0),
  kind text NOT NULL CHECK (kind IN ('EARN', 'REDEEM', 'ADJUSTMENT')),
  order_id uuid,
  reference text,
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_point_user ON wallet.loyalty_point (user_id, country_iso2, created_at DESC);
-- At most one EARN per order (idempotent award).
CREATE UNIQUE INDEX loyalty_point_order_kind ON wallet.loyalty_point (order_id, kind) WHERE order_id IS NOT NULL;
-- A redemption is idempotent on its reference (the request's idempotency key).
CREATE UNIQUE INDEX loyalty_point_redeem_ref ON wallet.loyalty_point (country_iso2, reference) WHERE kind = 'REDEEM' AND reference IS NOT NULL;

ALTER TABLE wallet.loyalty_point ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.loyalty_point FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON wallet.loyalty_point USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

CREATE TABLE wallet.loyalty_config (
  country_iso2 char(2) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  -- Points earned per 10 000 minor units spent (e.g. 100 = 1 point per 1.00, roughly 1% back at a 1:1 redeem).
  earn_bps integer NOT NULL DEFAULT 100 CHECK (earn_bps >= 0),
  -- Wallet credit (minor units of the settlement currency) each point is worth when redeemed.
  redeem_minor_per_point integer NOT NULL DEFAULT 1 CHECK (redeem_minor_per_point >= 1),
  -- Fewest points a customer may redeem at once.
  min_redeem_points integer NOT NULL DEFAULT 100 CHECK (min_redeem_points >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wallet.loyalty_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.loyalty_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON wallet.loyalty_config USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A wallet credit from redeeming points is a new wallet transaction kind.
ALTER TABLE wallet.transaction DROP CONSTRAINT IF EXISTS transaction_kind_check;
ALTER TABLE wallet.transaction ADD CONSTRAINT transaction_kind_check CHECK (kind IN ('TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT', 'REFERRAL', 'LOYALTY'));
