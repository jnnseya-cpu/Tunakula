-- Food photos: a menu item can carry one public image, stored in the shared media store (MENU_ITEM purpose).
-- The image is served publicly (the storefront and Tunakula Nzela show it); every other purpose stays private.
ALTER TABLE media.object DROP CONSTRAINT IF EXISTS object_purpose_check;
ALTER TABLE media.object ADD CONSTRAINT object_purpose_check
  CHECK (purpose IN ('RIDER_ID', 'RIDER_SELFIE', 'RIDER_LICENCE', 'PACK_PHOTO', 'PROOF_PHOTO', 'MENU_ITEM'));

ALTER TABLE catalogue.menu_item ADD COLUMN IF NOT EXISTS image_id uuid REFERENCES media.object (id);
