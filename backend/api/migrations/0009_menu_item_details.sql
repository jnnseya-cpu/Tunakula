-- Menu management (restaurant food panel): a dish carries a description, a category, a veg flag and a
-- "recommended" flag, so merchants can run their own menu as they do on the legacy panel. RLS and the
-- tenant policy on catalogue.menu_item are already in place (0004); these columns inherit them.
ALTER TABLE catalogue.menu_item
  ADD COLUMN description jsonb NOT NULL DEFAULT '{}',   -- { "fr": "...", "en": "..." }
  ADD COLUMN category text,
  ADD COLUMN veg boolean,                               -- true veg, false non-veg, null unspecified
  ADD COLUMN recommended boolean NOT NULL DEFAULT false;

CREATE INDEX menu_item_category ON catalogue.menu_item (branch_id, category);
