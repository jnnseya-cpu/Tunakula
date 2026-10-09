-- Business profile: the details every storefront needs — a street address, contact phone and email, an
-- "about" description, cuisine tags, a minimum order, and a logo + cover photo (public images, like dishes).
ALTER TABLE media.object DROP CONSTRAINT IF EXISTS object_purpose_check;
ALTER TABLE media.object ADD CONSTRAINT object_purpose_check
  CHECK (purpose IN ('RIDER_ID', 'RIDER_SELFIE', 'RIDER_LICENCE', 'PACK_PHOTO', 'PROOF_PHOTO', 'MENU_ITEM', 'BRANCH_LOGO', 'BRANCH_COVER'));

ALTER TABLE catalogue.branch
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS description jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { "fr": "...", "en": "..." }
  ADD COLUMN IF NOT EXISTS cuisines text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_order_minor bigint,
  ADD COLUMN IF NOT EXISTS logo_id uuid REFERENCES media.object (id),
  ADD COLUMN IF NOT EXISTS cover_id uuid REFERENCES media.object (id);
