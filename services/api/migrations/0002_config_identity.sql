-- Geography & Config (§7.2, §17)
CREATE TABLE config.country_profile (
  iso2 char(2) NOT NULL,
  version int NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  document jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  published_by text,
  published_at timestamptz,
  rolled_back_from int,
  PRIMARY KEY (iso2, version)
);
CREATE UNIQUE INDEX country_profile_one_published ON config.country_profile (iso2) WHERE status = 'PUBLISHED';

CREATE TABLE config.brand (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identity & Access (§8, §21 user / role_binding)
CREATE TABLE identity.app_user (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  phone_e164 text UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  display_name text NOT NULL,
  email text,
  home_country char(2),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING_DELETION', 'DELETED')),
  images jsonb NOT NULL DEFAULT '{}'::jsonb,
  consents jsonb NOT NULL DEFAULT '{}'::jsonb,
  deletion_due_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.otp_challenge (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS', 'WHATSAPP')),
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenge_phone ON identity.otp_challenge (phone_e164, created_at DESC);

-- A binding is either a built-in §8.2 role or an account access profile (ADR 0005).
CREATE TABLE identity.role_binding (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  role text,
  profile jsonb,
  scope_type text NOT NULL,
  scope_id text,
  fleet_id text,
  account_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role IS NULL) <> (profile IS NULL))
);
CREATE INDEX role_binding_user ON identity.role_binding (user_id);

-- Hash-chained, append-only audit of privileged actions (REM-005).
CREATE TABLE identity.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  country_iso2 char(2),
  detail jsonb,
  prev_hash text NOT NULL,
  hash text NOT NULL UNIQUE
);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON identity.audit_log
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
