-- Book-a-chef: a private-chef marketplace. A cook offers services — advice/consultations and in-person
-- engagements (private dining, meal prep, events, classes) — and customers book them for a date. The chef sets
-- the fee and keeps 100% of it; the platform adds its customer service charge on top, the same 0%-commission
-- principle as every other order. Additive; its own schema, nothing else depends on it.

CREATE SCHEMA IF NOT EXISTS chef;

-- A cook's public profile. Created on application (PENDING), approved by ops before it is discoverable.
CREATE TABLE chef.profile (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.app_user(id),
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  -- Cuisines the chef cooks and the communes they serve, for discovery.
  cuisines text[] NOT NULL DEFAULT '{}',
  communes text[] NOT NULL DEFAULT '{}',
  photo_ref text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_iso2, user_id)
);
CREATE INDEX chef_profile_status ON chef.profile (country_iso2, status);

-- A service a chef offers. ADVICE is a consultation (often remote); the rest are in-person engagements.
CREATE TABLE chef.service (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  chef_id uuid NOT NULL REFERENCES chef.profile(id),
  kind text NOT NULL CHECK (kind IN ('ADVICE', 'PRIVATE_DINING', 'MEAL_PREP', 'EVENT', 'CLASS')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- How the chef charges: a flat fee, per guest, or per hour.
  pricing_model text NOT NULL CHECK (pricing_model IN ('FIXED', 'PER_HEAD', 'HOURLY')),
  rate_minor bigint NOT NULL CHECK (rate_minor >= 0),
  currency char(3) NOT NULL,
  min_guests integer NOT NULL DEFAULT 1 CHECK (min_guests >= 1),
  max_guests integer CHECK (max_guests IS NULL OR max_guests >= min_guests),
  remote boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chef_service_chef ON chef.service (chef_id, active);

-- A booking of a chef's service. The quote (chef fee + service charge) is snapshotted when it is requested, so
-- the price cannot drift after the customer agrees to it.
CREATE TABLE chef.booking (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  chef_id uuid NOT NULL REFERENCES chef.profile(id),
  service_id uuid NOT NULL REFERENCES chef.service(id),
  customer_id uuid NOT NULL REFERENCES identity.app_user(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  scheduled_for timestamptz NOT NULL,
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size >= 1),
  hours integer NOT NULL DEFAULT 1 CHECK (hours >= 1),
  location_label text NOT NULL DEFAULT '',
  lat numeric(9,6),
  lng numeric(9,6),
  note text NOT NULL DEFAULT '',
  -- Snapshotted money: the chef keeps fee_minor in full; service_charge_minor is the platform's; total is what the customer pays.
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  service_charge_minor bigint NOT NULL CHECK (service_charge_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  currency char(3) NOT NULL,
  decline_reason text NOT NULL DEFAULT '',
  -- Set once, when the booking is completed and settled to the ledger.
  journal_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chef_booking_chef ON chef.booking (chef_id, status);
CREATE INDEX chef_booking_customer ON chef.booking (customer_id, created_at DESC);

ALTER TABLE chef.profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE chef.profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON chef.profile USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
ALTER TABLE chef.service ENABLE ROW LEVEL SECURITY;
ALTER TABLE chef.service FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON chef.service USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
ALTER TABLE chef.booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE chef.booking FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON chef.booking USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
