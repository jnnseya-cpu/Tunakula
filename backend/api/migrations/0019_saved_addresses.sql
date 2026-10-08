-- Saved delivery addresses with a map pin (the customer basic every big-4 app has). A customer keeps
-- several named addresses and picks one at checkout. Additive. Country-scoped under RLS like the rest.
CREATE TABLE identity.saved_address (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  landmark text CHECK (length(landmark) <= 280),
  contact_phone text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_address_user ON identity.saved_address (user_id, country_iso2);
-- At most one default per customer per country.
CREATE UNIQUE INDEX saved_address_one_default ON identity.saved_address (user_id, country_iso2) WHERE is_default;

ALTER TABLE identity.saved_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.saved_address FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON identity.saved_address USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
