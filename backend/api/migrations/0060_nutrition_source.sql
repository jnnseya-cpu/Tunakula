-- Nutri-Score provenance (§AI). A dish's per-100 g nutrition can come from the merchant, an import, an AI
-- estimate, or a human-verified review. This records WHICH, so the computed Nutri-Score is always shown with its
-- basis — an AI estimate is labelled estimated, never presented as measured or verified. NULL = no nutrition
-- basis set. RLS/tenant policy already covers catalogue.menu_item. Additive.

ALTER TABLE catalogue.menu_item
  ADD COLUMN nutrition_source text CHECK (nutrition_source IN ('merchant', 'import', 'ai_estimate', 'verified'));
