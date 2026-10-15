-- Broadcast history: one row per one-click broadcast an admin sends, with its audience, channels and
-- the per-status delivery tally. Append-only (a sent broadcast is a fact), tenant table under country RLS.
CREATE TABLE promotions.broadcast (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  audience text NOT NULL,
  segment text,
  channels text[] NOT NULL,
  message text NOT NULL,
  recipients int NOT NULL,
  sent int NOT NULL DEFAULT 0,
  logged int NOT NULL DEFAULT 0,
  suppressed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES identity.app_user (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX broadcast_country ON promotions.broadcast (country_iso2, created_at DESC);

ALTER TABLE promotions.broadcast ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions.broadcast FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON promotions.broadcast USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
CREATE TRIGGER broadcast_append_only BEFORE UPDATE OR DELETE ON promotions.broadcast
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
