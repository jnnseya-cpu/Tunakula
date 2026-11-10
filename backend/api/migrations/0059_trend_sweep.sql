-- Trend Intelligence autonomous sweep audit (spec §2 automatic reading, §8 operations). The sweep runs headless
-- in the background operations loop — no UI, nothing user-visible — reading Tunakula's own first-party order
-- signals, scoring per-topic demand and freezing opportunities. Each run is recorded here for audit and for the
-- per-country cadence guard (so it runs about hourly, not every dispatch tick). Additive; RLS like trend.*.

CREATE TABLE trend.sweep_run (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  observations int NOT NULL DEFAULT 0,   -- first-party observations aggregated this run
  opportunities int NOT NULL DEFAULT 0,  -- scored opportunity snapshots frozen this run
  briefs int NOT NULL DEFAULT 0,         -- draft briefs auto-created this run (0 unless confidence qualifies)
  window_end timestamptz,                -- the complete window this run scored
  ran_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trend_sweep_run_country ON trend.sweep_run (country_iso2, ran_at DESC);

ALTER TABLE trend.sweep_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend.sweep_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON trend.sweep_run USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
