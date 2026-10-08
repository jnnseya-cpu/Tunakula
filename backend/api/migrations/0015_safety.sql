-- Rider safety: an in-app SOS a rider raises when they feel unsafe or have an accident, and the ops
-- queue that answers it (the DoorDash SafeDash / Uber Safety Toolkit feature). Additive. Mutable row
-- (status moves OPEN -> ACKNOWLEDGED -> RESOLVED); every change is audited. Tenant table, country RLS.
CREATE TABLE dispatch.safety_incident (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  order_id uuid,
  kind text NOT NULL CHECK (kind IN ('SOS', 'ACCIDENT', 'UNSAFE', 'VEHICLE', 'OTHER')),
  lat double precision,
  lng double precision,
  note text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  acknowledged_by uuid REFERENCES identity.app_user (id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_open ON dispatch.safety_incident (country_iso2, status, created_at);
CREATE INDEX safety_rider ON dispatch.safety_incident (rider_id, created_at);

ALTER TABLE dispatch.safety_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch.safety_incident FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON dispatch.safety_incident USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
