-- Trend Intelligence (spec §5, §6, §15): read demand signals, freeze scored opportunities, and issue versioned,
-- time-limited Growth Briefs that steer Tunakula's EXISTING agents (growth, merchant copilot, site-content/SEO,
-- the marketing copywriters) at run time. The brief is a control layer — it never grants an agent new authority.
--
-- Tenancy: Tunakula's boundary is the country, so every row carries country_iso2 with FORCE ROW LEVEL SECURITY,
-- exactly like growth.nudge. Idempotency mirrors the spec's "unique source version key" so replays never inflate
-- counts. Additive; its own schema.

CREATE SCHEMA IF NOT EXISTS trend;

-- A normalised signal observation with provenance (spec §5 observation schema). The unique source-version key
-- (source_id, source_record_id, revision) stops a replay from inflating counts; a re-send with the same key but
-- a different evidence_hash is a conflict, surfaced by the ingest layer, never a silent overwrite.
CREATE TABLE trend.observation (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  source_id text NOT NULL,
  source_family text NOT NULL,
  source_record_id text NOT NULL,
  revision int NOT NULL DEFAULT 1,
  observed_at timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  geography text,
  locale text,
  segment text,
  metric text NOT NULL,
  value numeric NOT NULL,
  unit text,
  scaling_scope text,
  coverage numeric,
  evidence_uri text,
  evidence_hash text NOT NULL,
  terms_version text,
  CHECK (window_start < window_end),
  UNIQUE (country_iso2, source_id, source_record_id, revision)
);
CREATE INDEX trend_observation_window ON trend.observation (country_iso2, source_family, window_end DESC);

ALTER TABLE trend.observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend.observation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON trend.observation USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A frozen scored opportunity snapshot (spec §5, §15). The score is immutable per
-- (country, topic, window_end, scoring_version, input_digest): rescoring the same inputs returns the same frozen
-- row, and a correction creates a SUPERSEDING snapshot rather than mutating evidence.
CREATE TABLE trend.opportunity (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  topic_id text NOT NULL,
  market char(2) NOT NULL,
  locale text NOT NULL,
  window_end timestamptz NOT NULL,
  scoring_version int NOT NULL,
  input_digest text NOT NULL,
  opportunity_score numeric NOT NULL CHECK (opportunity_score >= 0 AND opportunity_score <= 100),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  band text NOT NULL CHECK (band IN ('ARCHIVE', 'WATCH', 'BRIEF', 'AUTO_ELIGIBLE')),
  breakdown jsonb NOT NULL,           -- numeric inputs + reasons (store full precision; round only for display)
  vetoes jsonb NOT NULL DEFAULT '[]',
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_iso2, topic_id, window_end, scoring_version, input_digest)
);
CREATE INDEX trend_opportunity_topic ON trend.opportunity (country_iso2, topic_id, window_end DESC);

ALTER TABLE trend.opportunity ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend.opportunity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON trend.opportunity USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());

-- A versioned Growth Brief (spec §6 / Appendix A). `payload` holds the full closed Growth Brief v1 object the
-- agents receive. One brief_id can have many versions; at most ONE may be APPROVED for a given
-- (country, market, locale, topic) scope at a time — enforced by the partial unique index below (spec §6 "unique
-- active brief scope"). Expiry is checked on every effective-brief lookup, so an expired brief never steers work.
CREATE TABLE trend.growth_brief (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  brief_id text NOT NULL,
  brief_version int NOT NULL CHECK (brief_version >= 1),
  topic_id text NOT NULL,
  market char(2) NOT NULL,
  locale text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'EXPIRED', 'SUPERSEDED')),
  payload jsonb NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  opportunity_id uuid REFERENCES trend.opportunity (id),
  policy_version int NOT NULL,
  approved_by uuid REFERENCES identity.app_user (id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from < expires_at),
  UNIQUE (country_iso2, brief_id, brief_version)
);
-- At most one APPROVED brief per scope (the active pointer).
CREATE UNIQUE INDEX trend_brief_active_scope ON trend.growth_brief (country_iso2, market, locale, topic_id)
  WHERE status = 'APPROVED';
CREATE INDEX trend_brief_lookup ON trend.growth_brief (country_iso2, market, locale, topic_id, status);

ALTER TABLE trend.growth_brief ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend.growth_brief FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON trend.growth_brief USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
