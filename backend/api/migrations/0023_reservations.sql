-- Table bookings (dine-in reservations). A customer books a table at a restaurant for a party of
-- one or more people at a chosen time; the restaurant's front of house confirms, seats, completes,
-- declines or marks a no-show. Additive. The status and timestamps change over the booking's life,
-- so the row is mutable (not append-only). Tenant table, country RLS like the rest.
CREATE SCHEMA IF NOT EXISTS reservations;

CREATE TABLE reservations.booking (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id),
  customer_id uuid NOT NULL REFERENCES identity.app_user (id),
  party_size int NOT NULL CHECK (party_size BETWEEN 1 AND 50),
  seating_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 15 AND 480),
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  contact_name text CHECK (length(contact_name) <= 120),
  contact_phone text CHECK (length(contact_phone) <= 40),
  note text CHECK (length(note) <= 500),
  decided_by uuid REFERENCES identity.app_user (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_branch ON reservations.booking (branch_id, seating_at);
CREATE INDEX booking_customer ON reservations.booking (customer_id, country_iso2, seating_at DESC);

ALTER TABLE reservations.booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations.booking FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON reservations.booking USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
