-- Rider incentives: admin-defined quests ("complete N deliveries by a date for a bonus") and the
-- bonuses riders earn by completing them (the DoorDash Quests / Uber Boost+ feature). Additive.
-- A quest is a mutable definition; a claimed bonus is an append-only money record that counts toward
-- the rider's cashable balance. Tenant tables, country RLS.
CREATE TABLE dispatch.rider_quest (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  target_deliveries int NOT NULL CHECK (target_deliveries BETWEEN 1 AND 1000),
  bonus_minor bigint NOT NULL CHECK (bonus_minor > 0),
  currency char(3) NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quest_active ON dispatch.rider_quest (country_iso2, active, ends_at);

CREATE TABLE dispatch.rider_bonus (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  rider_id uuid NOT NULL REFERENCES identity.app_user (id),
  quest_id uuid NOT NULL REFERENCES dispatch.rider_quest (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  journal_key text NOT NULL UNIQUE,
  at timestamptz NOT NULL DEFAULT now()
);
-- One bonus per rider per quest.
CREATE UNIQUE INDEX bonus_once ON dispatch.rider_bonus (quest_id, rider_id);
CREATE INDEX bonus_rider ON dispatch.rider_bonus (rider_id, at);
CREATE TRIGGER rider_bonus_append_only BEFORE UPDATE OR DELETE ON dispatch.rider_bonus
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dispatch.rider_quest', 'dispatch.rider_bonus'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
