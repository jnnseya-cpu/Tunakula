-- Web push subscriptions: a customer who turns on notifications stores their browser's Push API subscription here,
-- and the comms dispatch engine's push channel sends to it (VAPID / Web Push). Completes the notification adapters:
-- SMS and WhatsApp go through the messaging provider, in-app lands in the inbox, and push reaches the device. FORCE RLS.
CREATE TABLE comms.push_subscription (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX push_subscription_endpoint ON comms.push_subscription (endpoint);
CREATE INDEX push_subscription_user ON comms.push_subscription (user_id);

ALTER TABLE comms.push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms.push_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON comms.push_subscription USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
