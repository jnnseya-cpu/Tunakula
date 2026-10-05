-- Operations: automatic refunds, cash hand-ins, rider applications with ID checks, and the private
-- media store for identity documents (and later pack/proof photos). All tenant tables, FORCE RLS.
CREATE SCHEMA IF NOT EXISTS onboarding;
CREATE SCHEMA IF NOT EXISTS media;

-- One refund per order (full amount, before delivery). The provider call is idempotent on the same key.
CREATE TABLE payments.refund (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  order_id uuid NOT NULL,
  intent_id uuid NOT NULL REFERENCES payments.payment_intent (id),
  connector_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  refund_ref text,
  reason_code text NOT NULL,
  failure text,
  attempts int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refund_one_per_order ON payments.refund (order_id);

-- Cash a rider hands in at the hub: lowers their cash in hand, moves money from COD-in-transit to hub cash.
CREATE TABLE dispatch.cash_remittance (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  received_by uuid NOT NULL REFERENCES identity.app_user (id),
  note text,
  journal_key text NOT NULL UNIQUE,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_remittance_rider ON dispatch.cash_remittance (rider_id, at);
CREATE TRIGGER cash_remittance_append_only BEFORE UPDATE OR DELETE ON dispatch.cash_remittance
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- Private media: identity documents and selfies. Readable only through the API's permission checks.
CREATE TABLE media.object (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES identity.app_user (id),
  purpose text NOT NULL CHECK (purpose IN ('RIDER_ID', 'RIDER_SELFIE', 'RIDER_LICENCE', 'PACK_PHOTO', 'PROOF_PHOTO')),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  sha256 char(64) NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 750000),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner ON media.object (owner_user_id, purpose);

CREATE TABLE onboarding.rider_application (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  full_name text NOT NULL,
  date_of_birth date NOT NULL,
  zones text[] NOT NULL CHECK (cardinality(zones) BETWEEN 1 AND 10),
  vehicle text NOT NULL CHECK (vehicle IN ('MOTO', 'BICYCLE', 'CAR', 'FOOT')),
  plate text,
  id_type text NOT NULL CHECK (id_type IN ('NATIONAL_ID', 'VOTER_CARD', 'PASSPORT', 'DRIVING_LICENCE')),
  id_number text NOT NULL,
  id_photo uuid NOT NULL REFERENCES media.object (id),
  selfie uuid NOT NULL REFERENCES media.object (id),
  licence_photo uuid REFERENCES media.object (id),
  checks jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid REFERENCES identity.app_user (id),
  reviewed_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rider_application_one_open ON onboarding.rider_application (user_id) WHERE status = 'PENDING';
CREATE INDEX rider_application_id_number ON onboarding.rider_application (id_type, id_number);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments.refund', 'dispatch.cash_remittance', 'media.object', 'onboarding.rider_application'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
