-- Menu sync: a copied dish remembers the source dish it came from, so an owner can later push edits from
-- the source branch down to every branch they copied it into. If the source dish is deleted, the link is
-- cleared (the copy becomes a plain local dish). Additive.
ALTER TABLE catalogue.menu_item ADD COLUMN IF NOT EXISTS source_item_id uuid REFERENCES catalogue.menu_item (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS menu_item_source ON catalogue.menu_item (source_item_id) WHERE source_item_id IS NOT NULL;
