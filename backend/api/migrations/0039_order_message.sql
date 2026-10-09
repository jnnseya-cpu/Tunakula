-- In-order chat: short messages between the customer and the rider on a live order ("I'm at the gate",
-- "please leave it at the door"). Only the order's customer and its assigned rider can read or post. Messages are
-- immutable (append-only). Additive. FORCE RLS per country.

CREATE TABLE comms.order_message (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  order_id uuid NOT NULL,
  sender_id uuid NOT NULL REFERENCES identity.app_user (id),
  sender_role text NOT NULL CHECK (sender_role IN ('CUSTOMER', 'RIDER')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_message_order ON comms.order_message (order_id, created_at);

ALTER TABLE comms.order_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms.order_message FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON comms.order_message USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
