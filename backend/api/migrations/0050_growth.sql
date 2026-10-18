-- Growth agent (§AI): re-engagement. The agent reads a customer's lifecycle from their own order history
-- (ordering.order_view) and recommends who to bring back. When an operator sends a win-back, we record it so the
-- same customer is not nudged again within the window, and so every send is auditable. The optional goodwill
-- credit is granted through the wallet (promotion_expense → customer_wallet), the same rail as cashback.
-- Recommendations are computed read-only from existing data; they need no table. Additive; its own schema.

CREATE SCHEMA IF NOT EXISTS growth;

-- One recorded re-engagement nudge to a customer. `reference` makes the send (and any wallet credit) idempotent.
CREATE TABLE growth.nudge (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  customer_id uuid NOT NULL REFERENCES identity.app_user(id),
  kind text NOT NULL CHECK (kind IN ('WIN_BACK', 'REMIND')),
  segment text NOT NULL,
  credit_minor bigint,
  currency char(3),
  reference text NOT NULL,
  sent_by uuid NOT NULL REFERENCES identity.app_user(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference)
);
CREATE INDEX growth_nudge_customer ON growth.nudge (country_iso2, customer_id, sent_at DESC);

ALTER TABLE growth.nudge ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth.nudge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON growth.nudge USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A goodwill win-back credit is a wallet transaction kind, funded by promotion_expense like cashback and referrals.
ALTER TABLE wallet.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE wallet.transaction ADD CONSTRAINT transaction_kind_check CHECK (kind IN ('TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT', 'REFERRAL', 'LOYALTY', 'CASHBACK', 'WINBACK'));
