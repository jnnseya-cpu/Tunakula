-- Row-level security on tenant tables (§9.1, §21, NFR-07): a request only ever sees
-- rows of its active country. FORCE applies the policy to the table owner too.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalogue.branch', 'catalogue.menu_item',
    'ordering.order_event', 'ordering.order_command', 'ordering.order_view',
    'payments.payment_intent', 'payments.payment_attempt',
    'money.ledger_entry'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
