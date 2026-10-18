-- Native-app push tokens (Expo). The React Native customer / rider / merchant apps register one Expo push
-- token per device; the comms dispatch engine's `push` channel delivers to them over the Expo push service
-- (which fans out to APNs on iOS and FCM on Android behind a single token). This sits beside Web Push
-- (0045): a browser stores a Push API subscription there, a native device stores an Expo token here, and the
-- push channel sends to whichever the recipient has. FORCE RLS, country-scoped like every tenant table.
CREATE TABLE comms.device_push (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  token text NOT NULL,                       -- ExponentPushToken[...] (one per device install)
  app text NOT NULL,                          -- which app registered it: 'customer' | 'rider' | 'merchant'
  platform text NOT NULL,                     -- 'ios' | 'android'
  device_label text,                          -- optional human label, e.g. "Pixel 8"
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_push_app_chk CHECK (app IN ('customer','rider','merchant')),
  CONSTRAINT device_push_platform_chk CHECK (platform IN ('ios','android'))
);
CREATE UNIQUE INDEX device_push_token ON comms.device_push (token);
CREATE INDEX device_push_user ON comms.device_push (user_id);

ALTER TABLE comms.device_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms.device_push FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON comms.device_push USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
