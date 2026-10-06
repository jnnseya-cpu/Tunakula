-- Communication Event Architecture: the dispatch engine's store.
-- One append-only delivery log (every event × channel × recipient with its status), the in-app
-- inbox people read, and per-channel opt-outs. All tenant tables, FORCE RLS by country.
CREATE SCHEMA IF NOT EXISTS comms;

-- Append-only delivery log: one row per channel attempt of a dispatched event.
CREATE TABLE comms.delivery (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  event_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'inapp', 'sms', 'push', 'whatsapp')),
  recipient_user_id uuid NOT NULL REFERENCES identity.app_user (id),
  audience text NOT NULL CHECK (audience IN ('customer', 'restaurant', 'rider', 'admin')),
  severity text NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  mandatory boolean NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'logged', 'suppressed', 'failed')),
  provider_ref text,
  failure text,
  -- When set, makes an event idempotent: the same dedupe key never delivers twice on a channel.
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_recent ON comms.delivery (country_iso2, created_at DESC);
CREATE INDEX delivery_recipient ON comms.delivery (recipient_user_id, created_at DESC);
CREATE UNIQUE INDEX delivery_dedupe ON comms.delivery (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TRIGGER delivery_append_only BEFORE UPDATE OR DELETE ON comms.delivery
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- The in-app inbox a recipient reads. Mutable: a notification is marked read.
CREATE TABLE comms.notification (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  event_key text NOT NULL,
  title text NOT NULL,
  subject text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  data jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_inbox ON comms.notification (user_id, created_at DESC);
CREATE INDEX notification_unread ON comms.notification (user_id) WHERE read_at IS NULL;

-- Per-channel opt-out. No row means the channel is on; mandatory events ignore this table.
CREATE TABLE comms.preference (
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  channel text NOT NULL CHECK (channel IN ('email', 'inapp', 'sms', 'push', 'whatsapp')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_iso2, user_id, channel)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comms.delivery', 'comms.notification', 'comms.preference'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
