-- Integration credentials entered from the admin panel instead of only as environment variables: payment-rail
-- keys, the messaging provider, Web Push (VAPID), the maps key. Stored by their environment-variable name so the
-- API can read them at start-up, with a real environment variable still taking precedence where one is set.
--
-- These are secrets. They are only ever read by the integrations service (to build the providers at boot) and are
-- NEVER returned to any client — the admin panel shows whether a key is set, not its value. A platform-wide
-- config table (not tenant-scoped); production should still back this with a secret manager.

CREATE TABLE platform.integration (
  env_key text PRIMARY KEY,
  value text NOT NULL,
  set_by text NOT NULL DEFAULT '',
  set_at timestamptz NOT NULL DEFAULT now()
);
