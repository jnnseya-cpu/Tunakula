-- Grocery / convenience vertical: a branch is a restaurant by default, but can be a grocery, a convenience store
-- or a pharmacy. The ordering, cart, checkout and dispatch paths are identical — only discovery and the storefront
-- present a non-restaurant store differently (its own section, aisle grouping, per-item unit labels). Additive:
-- existing branches backfill to RESTAURANT and keep working. Items gain an optional unit label ("1 kg", "6-pack").
ALTER TABLE catalogue.branch
  ADD COLUMN store_type text NOT NULL DEFAULT 'RESTAURANT'
    CHECK (store_type IN ('RESTAURANT', 'GROCERY', 'CONVENIENCE', 'PHARMACY'));

ALTER TABLE catalogue.menu_item
  ADD COLUMN unit_label text;
