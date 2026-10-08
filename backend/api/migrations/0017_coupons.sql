-- Coupons / promo codes (the customer-facing promotion StackFood has and the big-4 all offer). An
-- admin defines a code; a customer applies it at checkout; the platform funds the discount at
-- settlement (promotion_expense) so the merchant and rider are paid in full. Additive. A redemption
-- is append-only (one row per use), enforcing usage and per-customer limits. Tenant tables, RLS.
CREATE SCHEMA IF NOT EXISTS promotions;

CREATE TABLE promotions.coupon (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  code text NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  kind text NOT NULL CHECK (kind IN ('PERCENT', 'FIXED', 'FREE_DELIVERY')),
  value_bps int NOT NULL DEFAULT 0 CHECK (value_bps BETWEEN 0 AND 10000),  -- for PERCENT
  value_minor bigint NOT NULL DEFAULT 0 CHECK (value_minor >= 0),          -- for FIXED
  currency char(3) NOT NULL,
  min_subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (min_subtotal_minor >= 0),
  max_discount_minor bigint NOT NULL DEFAULT 0 CHECK (max_discount_minor >= 0), -- 0 = no cap
  usage_limit int NOT NULL DEFAULT 0 CHECK (usage_limit >= 0),             -- 0 = unlimited total
  per_customer_limit int NOT NULL DEFAULT 1 CHECK (per_customer_limit >= 1),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live coupon per code per market.
CREATE UNIQUE INDEX coupon_code ON promotions.coupon (country_iso2, upper(code)) WHERE active;
CREATE INDEX coupon_country ON promotions.coupon (country_iso2, active);

CREATE TABLE promotions.coupon_redemption (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  coupon_id uuid NOT NULL REFERENCES promotions.coupon (id),
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  order_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX redemption_once_per_order ON promotions.coupon_redemption (order_id);
CREATE INDEX redemption_coupon ON promotions.coupon_redemption (coupon_id);
CREATE INDEX redemption_user ON promotions.coupon_redemption (coupon_id, user_id);
CREATE TRIGGER coupon_redemption_append_only BEFORE UPDATE OR DELETE ON promotions.coupon_redemption
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['promotions.coupon', 'promotions.coupon_redemption'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
