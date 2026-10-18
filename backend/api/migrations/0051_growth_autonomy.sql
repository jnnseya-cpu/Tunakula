-- Autonomous win-backs under caps (§AI growth). The growth agent can run a scheduled sweep that re-engages
-- lapsed/dormant customers on its own — but only within hard caps an admin sets (the agent_autonomy:set
-- capability), and every run is logged. The agent never exceeds the per-customer credit cap, the per-run
-- budget, or the per-run customer count; it reuses the same idempotent win-back rail (growth.nudge), so a
-- customer is never nudged twice in a window whether the send was manual or autonomous. Additive.

-- One autonomy policy per country. Defaults are safe: disabled, conservative caps. Only an admin with
-- agent_autonomy:set may change it. credit/budget are stored in minor units of `currency`.
CREATE TABLE growth.autonomy (
  country_iso2 char(2) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  -- Which lapsed segments the sweep may touch. AT_RISK gets reminders only, so the default is the two
  -- segments a goodwill credit is meant for.
  segments text[] NOT NULL DEFAULT ARRAY['LAPSED', 'DORMANT'],
  per_customer_cap_minor bigint NOT NULL DEFAULT 2000,   -- most a single autonomous credit may be
  daily_budget_minor bigint NOT NULL DEFAULT 50000,      -- most a single run may spend in total
  max_customers_per_run int NOT NULL DEFAULT 50,         -- most customers a single run may reach
  currency char(3) NOT NULL DEFAULT 'USD',
  updated_by uuid REFERENCES identity.app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (per_customer_cap_minor >= 0 AND daily_budget_minor >= 0 AND max_customers_per_run >= 0)
);

ALTER TABLE growth.autonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth.autonomy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON growth.autonomy USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- One recorded autonomous (or manually-triggered) sweep run: what it reached and what it spent, for audit and
-- for showing the admin the agent's recent activity. A dry run is a preview — it records nothing it did, only
-- what it would have done (reached/credited stay 0, planned/would_spend carry the preview).
CREATE TABLE growth.sweep_run (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  dry_run boolean NOT NULL,
  reached int NOT NULL DEFAULT 0,            -- customers actually nudged (0 for a dry run)
  credited_minor bigint NOT NULL DEFAULT 0,  -- total credit actually issued (0 for a dry run)
  planned int NOT NULL DEFAULT 0,            -- customers a live run would reach / did consider
  would_spend_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  capped_by text,                            -- what stopped the run: 'BUDGET' | 'COUNT' | 'AUDIENCE' | null
  triggered_by uuid REFERENCES identity.app_user(id),  -- null when a scheduler fires it headless
  ran_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX growth_sweep_run_country ON growth.sweep_run (country_iso2, ran_at DESC);

ALTER TABLE growth.sweep_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth.sweep_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON growth.sweep_run USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A win-back may now be sent by the agent itself (a scheduled sweep with no operator), so the human sender is
-- optional; the sweep_run row and the audit log still carry who (or what) ran it.
ALTER TABLE growth.nudge ALTER COLUMN sent_by DROP NOT NULL;
