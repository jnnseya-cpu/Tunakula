-- Storefront CMS content: a market admin edits the storefront's landing copy (hero headline/subcopy/CTA), the
-- social links and the footer tagline, per country, without a code change. One row per (country, key); the value
-- is a validated JSON document the service shapes. Additive and purely presentational. Tenant table, FORCE RLS
-- per country; mutable (not append-only).

CREATE TABLE comms.site_content (
  country_iso2 char(2) NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_iso2, key)
);

ALTER TABLE comms.site_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms.site_content FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON comms.site_content USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
