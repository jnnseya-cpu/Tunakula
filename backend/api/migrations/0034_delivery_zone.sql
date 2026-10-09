-- Delivery zones: per-branch circular service areas. A branch may define serviceable areas (a centre + a radius);
-- a delivery drop outside every active zone is refused, and the matching zone may set a flat delivery fee and/or a
-- minimum order for that area. Additive: a branch with no zones keeps the distance-ladder fee and no serviceability
-- gate, exactly as before. Tenant table, FORCE RLS per country; mutable (not append-only). Circles, not polygons,
-- so no PostGIS is needed — containment is the great-circle distance from the centre.

CREATE TABLE catalogue.delivery_zone (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id) ON DELETE CASCADE,
  name text NOT NULL,
  centre_lat numeric(9,6) NOT NULL CHECK (centre_lat BETWEEN -90 AND 90),
  centre_lng numeric(9,6) NOT NULL CHECK (centre_lng BETWEEN -180 AND 180),
  radius_m integer NOT NULL CHECK (radius_m BETWEEN 100 AND 100000),
  -- Optional flat delivery fee for this area (minor units, settlement currency). NULL = use the distance ladder.
  flat_fee_minor bigint CHECK (flat_fee_minor IS NULL OR flat_fee_minor >= 0),
  -- Optional minimum order (goods subtotal, minor units) to deliver to this area. NULL = no zone minimum.
  min_order_minor bigint CHECK (min_order_minor IS NULL OR min_order_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_zone_branch ON catalogue.delivery_zone (branch_id, active);

ALTER TABLE catalogue.delivery_zone ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.delivery_zone FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON catalogue.delivery_zone USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
