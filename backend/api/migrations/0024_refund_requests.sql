-- Customer-initiated refund requests on a delivered order. The customer files a request with a reason
-- (within the refund window); support reviews the queue and approves (money is refunded through the same
-- provider and the settlement is reversed so the books stay balanced) or declines. Additive. The status
-- and resolution change over the request's life, so the row is mutable (not append-only). Tenant, RLS.
CREATE TABLE payments.refund_request (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  order_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES identity.app_user (id),
  reason_code text NOT NULL,
  comment text CHECK (length(comment) <= 1000),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  resolved_by uuid REFERENCES identity.app_user (id),
  resolution_note text CHECK (length(resolution_note) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One open request per order; a declined request may be followed by a new one, so only PENDING/APPROVED are unique.
CREATE UNIQUE INDEX refund_request_open ON payments.refund_request (order_id) WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX refund_request_customer ON payments.refund_request (customer_id, country_iso2, created_at DESC);
CREATE INDEX refund_request_pending ON payments.refund_request (country_iso2, created_at) WHERE status = 'PENDING';

ALTER TABLE payments.refund_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.refund_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON payments.refund_request USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
