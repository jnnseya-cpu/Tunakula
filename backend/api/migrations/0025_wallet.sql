-- In-app customer wallet. A customer tops up (through the same payment providers), pays for orders from
-- the balance, and is refunded to the wallet. The balance is the running sum of an append-only ledger of
-- signed movements (positive = credit, negative = debit). Platform books mirror each move through the
-- money.customer_wallet ledger account. Additive. Tenant table, FORCE RLS, append-only.
CREATE SCHEMA IF NOT EXISTS wallet;

CREATE TABLE wallet.transaction (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  currency char(3) NOT NULL,
  -- Signed minor units: a top-up or refund is positive, an order payment is negative.
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  kind text NOT NULL CHECK (kind IN ('TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT')),
  order_id uuid,
  reference text,
  -- The balance in this currency immediately after this movement (never negative).
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_tx_user ON wallet.transaction (user_id, country_iso2, currency, created_at DESC);
-- At most one order-payment and one refund per order (idempotent).
CREATE UNIQUE INDEX wallet_tx_order_kind ON wallet.transaction (order_id, kind) WHERE order_id IS NOT NULL;
-- A top-up is idempotent on its reference (the request's idempotency key).
CREATE UNIQUE INDEX wallet_tx_topup_ref ON wallet.transaction (country_iso2, reference) WHERE kind = 'TOPUP' AND reference IS NOT NULL;

ALTER TABLE wallet.transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.transaction FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON wallet.transaction USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
