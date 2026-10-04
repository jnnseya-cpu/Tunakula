-- Catalogue (§21 restaurant_group / branch / menu_item). Coordinates are numeric until PostGIS is enabled.
CREATE TABLE catalogue.branch (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  brand_id text NOT NULL,
  restaurant_group_id text NOT NULL,
  name text NOT NULL,
  city text,
  commune text,
  lat numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'PAUSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalogue.menu_item (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id),
  country_iso2 char(2) NOT NULL,
  brand_id text NOT NULL,
  names jsonb NOT NULL,                    -- { "fr": "...", "en": "..." }
  prices jsonb NOT NULL,                   -- { "USD": "1850", "CDF": "5200000" } minor units as strings (MR-1)
  tags text[] NOT NULL DEFAULT '{}',
  allergens text[] NOT NULL DEFAULT '{}',
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_item_branch ON catalogue.menu_item (branch_id);

-- Ordering: event-sourced aggregate (§10, §21 order / order_event).
CREATE TABLE ordering.order_event (
  order_id uuid NOT NULL,
  seq int NOT NULL CHECK (seq > 0),
  country_iso2 char(2) NOT NULL,
  brand_id text NOT NULL,
  command_id text NOT NULL,
  type text NOT NULL,
  actor jsonb NOT NULL,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (order_id, seq)
);
CREATE TRIGGER order_event_append_only BEFORE UPDATE OR DELETE ON ordering.order_event
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- Command idempotency: a replayed command returns its original events (INT-002).
CREATE TABLE ordering.order_command (
  order_id uuid NOT NULL,
  command_id text NOT NULL,
  country_iso2 char(2) NOT NULL,
  first_seq int,
  last_seq int,
  PRIMARY KEY (order_id, command_id)
);

-- Read model for lists and dashboards.
CREATE TABLE ordering.order_view (
  order_id uuid PRIMARY KEY,
  country_iso2 char(2) NOT NULL,
  brand_id text NOT NULL,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  rider_id text,
  type text NOT NULL,
  channel text NOT NULL,
  payment_mode text NOT NULL,
  state text NOT NULL,
  total_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  version int NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX order_view_customer ON ordering.order_view (customer_id, created_at DESC);
CREATE INDEX order_view_branch ON ordering.order_view (branch_id, state);
CREATE INDEX order_view_country_mode ON ordering.order_view (country_iso2, created_at, payment_mode);

-- Money: double-entry, append-only ledger (§19.3, MR-7, NFR-08).
CREATE TABLE money.journal (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  idempotency_key text NOT NULL UNIQUE,
  description text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  reverses uuid UNIQUE REFERENCES money.journal (id)
);
CREATE TABLE money.ledger_entry (
  journal_id uuid NOT NULL REFERENCES money.journal (id),
  line int NOT NULL,
  account text NOT NULL,
  country_iso2 char(2) NOT NULL,
  currency char(3) NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  PRIMARY KEY (journal_id, line)
);
CREATE INDEX ledger_entry_account ON money.ledger_entry (account, country_iso2, currency);
CREATE TRIGGER journal_append_only BEFORE UPDATE OR DELETE ON money.journal
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON money.ledger_entry
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- The database itself refuses an unbalanced journal: checked per currency at commit.
CREATE OR REPLACE FUNCTION money.check_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bad record;
BEGIN
  SELECT currency, sum(amount_minor) AS total INTO bad
    FROM money.ledger_entry WHERE journal_id = NEW.journal_id
    GROUP BY currency HAVING sum(amount_minor) <> 0 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'journal % does not balance in %: off by %', NEW.journal_id, bad.currency, bad.total
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM money.ledger_entry WHERE journal_id = NEW.journal_id) < 2 THEN
    RAISE EXCEPTION 'journal % needs at least two entries', NEW.journal_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entry_balanced AFTER INSERT ON money.ledger_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION money.check_journal_balanced();

-- Payments (§20, §21 payment_intent / payment_attempt / connector_event).
CREATE TABLE payments.payment_intent (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  order_id uuid NOT NULL,
  country_iso2 char(2) NOT NULL,
  brand_id text NOT NULL,
  payer_user_id uuid NOT NULL,
  payer_country char(2) NOT NULL,
  method_type text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL,
  connector_id text,
  provider_ref text,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_intent_provider_ref ON payments.payment_intent (connector_id, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE payments.payment_attempt (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  intent_id uuid NOT NULL REFERENCES payments.payment_intent (id),
  country_iso2 char(2) NOT NULL,
  connector_id text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL,
  provider_ref text,
  reason_code text,
  at timestamptz NOT NULL
);
CREATE TRIGGER payment_attempt_append_only BEFORE UPDATE OR DELETE ON payments.payment_attempt
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

CREATE TABLE payments.connector_event (
  connector_id text NOT NULL,
  event_id text NOT NULL,
  provider_ref text NOT NULL,
  state text NOT NULL,
  raw text NOT NULL,
  signature_ok boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_id, event_id)
);

-- API idempotency (§25.1: Idempotency-Key on every mutating call).
CREATE TABLE api.idempotency (
  key text NOT NULL,
  principal text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  status int,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal, key)
);
