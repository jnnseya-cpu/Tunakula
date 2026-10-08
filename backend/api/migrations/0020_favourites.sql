-- Favourites: a customer hearts restaurants to find them again fast. Additive, country-scoped under RLS.
CREATE TABLE identity.favourite (
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX favourite_user ON identity.favourite (user_id, country_iso2, created_at DESC);

ALTER TABLE identity.favourite ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.favourite FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON identity.favourite USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
