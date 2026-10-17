-- Rider shifts (availability scheduling): a rider books a time window in a zone they ride, so operations can see
-- who is committed to work when, and the dispatcher can prefer an on-shift rider for an order in that zone. A booking
-- is mutable (riders cancel), so it is NOT append-only. Additive: dispatch still offers to any fresh online rider —
-- on-shift riders are only preferred, never required, so nothing changes when no one is on shift. FORCE RLS per country.

CREATE TABLE dispatch.rider_shift (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  -- The zone (a branch commune, lowercased) the rider commits to cover.
  zone text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Fast lookup of who is on shift right now, and of a rider's own schedule.
CREATE INDEX rider_shift_window ON dispatch.rider_shift (country_iso2, status, starts_at, ends_at);
CREATE INDEX rider_shift_rider ON dispatch.rider_shift (rider_id, starts_at DESC);

ALTER TABLE dispatch.rider_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.rider_shift FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON dispatch.rider_shift USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
