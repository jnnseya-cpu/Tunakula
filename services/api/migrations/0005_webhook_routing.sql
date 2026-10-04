-- Webhooks arrive without a tenant. FORCE RLS binds even the table owner, so the
-- lookup reads a narrow routing table (no RLS) holding only connector, provider
-- reference and country. A trigger keeps it in step with payment_intent; the app
-- role cannot read or write it directly, only call the lookup function.
CREATE TABLE payments.provider_ref_route (
  connector_id text NOT NULL,
  provider_ref text NOT NULL,
  country_iso2 char(2) NOT NULL,
  PRIMARY KEY (connector_id, provider_ref)
);

CREATE OR REPLACE FUNCTION payments.route_provider_ref() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = payments, pg_temp AS $$
BEGIN
  IF NEW.connector_id IS NOT NULL AND NEW.provider_ref IS NOT NULL THEN
    INSERT INTO payments.provider_ref_route (connector_id, provider_ref, country_iso2)
    VALUES (NEW.connector_id, NEW.provider_ref, NEW.country_iso2)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payments.route_provider_ref() FROM PUBLIC;

CREATE TRIGGER payment_intent_route AFTER INSERT OR UPDATE OF connector_id, provider_ref ON payments.payment_intent
  FOR EACH ROW EXECUTE FUNCTION payments.route_provider_ref();

-- Reveals only the country, so the webhook is then processed inside that country's RLS context.
CREATE OR REPLACE FUNCTION payments.country_for_provider_ref(p_connector text, p_ref text) RETURNS char(2)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = payments, pg_temp AS $$
  SELECT country_iso2 FROM payments.provider_ref_route WHERE connector_id = p_connector AND provider_ref = p_ref
$$;
REVOKE ALL ON FUNCTION payments.country_for_provider_ref(text, text) FROM PUBLIC;
