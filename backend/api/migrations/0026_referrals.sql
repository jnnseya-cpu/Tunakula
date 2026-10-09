-- Referral program. Every customer has a shareable referral code. A new customer who applies a code
-- (the referee) earns a reward to their wallet, but it stays locked until that referee has spent a
-- threshold amount on the platform; on crossing it, the reward unlocks (the referee and the referrer are
-- each credited) as real, spendable wallet money. Amounts are in the market's settlement currency.
-- Additive. The claim's status changes over its life, so it is mutable (not append-only). Tenant, RLS.
CREATE SCHEMA IF NOT EXISTS referral;

-- One permanent code per customer.
CREATE TABLE referral.code (
  user_id uuid PRIMARY KEY REFERENCES identity.app_user (id),
  country_iso2 char(2) NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_code_unique ON referral.code (code);

-- One claim per referee, ever. referee_spend is informational; the sweep recomputes from delivered orders.
CREATE TABLE referral.claim (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  code text NOT NULL,
  referrer_user_id uuid NOT NULL REFERENCES identity.app_user (id),
  referee_user_id uuid NOT NULL REFERENCES identity.app_user (id),
  reward_minor bigint NOT NULL CHECK (reward_minor > 0),
  threshold_minor bigint NOT NULL CHECK (threshold_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNLOCKED', 'EXPIRED')),
  unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_claim_referee ON referral.claim (referee_user_id);
CREATE INDEX referral_claim_referrer ON referral.claim (referrer_user_id, country_iso2);
CREATE INDEX referral_claim_pending ON referral.claim (country_iso2) WHERE status = 'PENDING';

ALTER TABLE referral.code ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral.code FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON referral.code USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
ALTER TABLE referral.claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral.claim FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON referral.claim USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A referral reward is a recognised wallet movement kind.
ALTER TABLE wallet.transaction DROP CONSTRAINT IF EXISTS transaction_kind_check;
ALTER TABLE wallet.transaction ADD CONSTRAINT transaction_kind_check CHECK (kind IN ('TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT', 'REFERRAL'));
