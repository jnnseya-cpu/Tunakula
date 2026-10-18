-- A restaurant group is a brand: one name shared by one or more branches, which can be run by several
-- people. The brand owner shares an invite code; a franchisee signs up individually, joins the brand with
-- the code, and gets their own branch under it. Additive: branches already carry restaurant_group_id.
CREATE TABLE catalogue.restaurant_group (
  id text PRIMARY KEY,
  country_iso2 char(2) NOT NULL,
  name text NOT NULL,
  invite_code text,
  created_by uuid REFERENCES identity.app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX restaurant_group_invite ON catalogue.restaurant_group (invite_code) WHERE invite_code IS NOT NULL;

ALTER TABLE catalogue.restaurant_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.restaurant_group FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON catalogue.restaurant_group
  USING (country_iso2 = platform.current_country())
  WITH CHECK (country_iso2 = platform.current_country());
