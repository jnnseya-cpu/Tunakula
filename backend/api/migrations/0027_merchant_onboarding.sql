-- Self-serve merchant onboarding. A business owner registers, adds a branch and its menu through a
-- guided wizard, then publishes. A branch is only discoverable on the storefront (and in Tunakula Nzela,
-- the WhatsApp channel, which reads the same catalogue) once it is published. Additive: a nullable
-- published_at on the branch. Existing branches are treated as already published.
ALTER TABLE catalogue.branch ADD COLUMN IF NOT EXISTS published_at timestamptz;
-- Everything that already exists was live, so keep it visible.
UPDATE catalogue.branch SET published_at = created_at WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS branch_published ON catalogue.branch (country_iso2) WHERE published_at IS NOT NULL;
