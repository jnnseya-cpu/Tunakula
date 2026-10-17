-- Marketing banners: a platform/market admin places a promotional banner (headline, subtext, a call-to-action
-- link) in the customer app for a time window. Additive; purely presentational. Tenant table, FORCE RLS per
-- country; mutable (not append-only).

CREATE TABLE comms.banner (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  headline text NOT NULL,
  subtext text NOT NULL DEFAULT '',
  cta_label text NOT NULL DEFAULT '',
  cta_href text NOT NULL DEFAULT '',
  -- A visual tone the customer app maps to a colour.
  tone text NOT NULL DEFAULT 'ACCENT' CHECK (tone IN ('ACCENT', 'DARK', 'GREEN', 'ORANGE')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banner_window ON comms.banner (country_iso2, active, starts_at, ends_at);

ALTER TABLE comms.banner ENABLE ROW LEVEL SECURITY;
ALTER TABLE comms.banner FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON comms.banner USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
