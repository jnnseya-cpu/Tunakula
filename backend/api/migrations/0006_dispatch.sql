-- Dispatch (§10.2, §12): which riders are online and where, and the job offers made to them.
-- Both tables are tenant tables: FORCE RLS by country, like every other one.
CREATE SCHEMA IF NOT EXISTS dispatch;

CREATE TABLE dispatch.rider_presence (
  country_iso2 char(2) NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  online boolean NOT NULL DEFAULT false,
  lat numeric(9, 6) CHECK (lat BETWEEN -90 AND 90),
  lng numeric(9, 6) CHECK (lng BETWEEN -180 AND 180),
  vehicle text NOT NULL DEFAULT 'MOTO' CHECK (vehicle IN ('MOTO', 'BICYCLE', 'CAR', 'FOOT')),
  online_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_iso2, rider_id)
);
CREATE INDEX rider_presence_online ON dispatch.rider_presence (country_iso2, online, updated_at);

CREATE TABLE dispatch.offer (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  order_id uuid NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  status text NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN')),
  pickup_meters integer NOT NULL CHECK (pickup_meters >= 0),
  drop_meters integer NOT NULL CHECK (drop_meters >= 0),
  earnings_minor bigint NOT NULL CHECK (earnings_minor >= 0),
  currency char(3) NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  decline_reason text
);
CREATE INDEX offer_order ON dispatch.offer (order_id, status);
CREATE INDEX offer_rider ON dispatch.offer (rider_id, status);
-- One live offer per order at a time: the next rider is asked only when this one says no or time runs out.
CREATE UNIQUE INDEX offer_one_live ON dispatch.offer (order_id) WHERE status = 'OFFERED';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dispatch.rider_presence', 'dispatch.offer'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
