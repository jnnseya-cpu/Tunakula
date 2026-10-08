-- Structured dietary tags and nutrition on a dish, so customers can filter by diet and allergy
-- (the Uber Eats / Deliveroo / Just Eat compliance feature) and see calories and macros. Additive:
-- the existing `veg` boolean and free-text `allergens` array stay; `dietary` is a validated set of
-- tags and `nutrition` holds per-serving figures. RLS/tenant policy already cover menu_item.
ALTER TABLE catalogue.menu_item
  ADD COLUMN dietary text[] NOT NULL DEFAULT '{}',   -- e.g. {VEGETARIAN,VEGAN,HALAL,GLUTEN_FREE}
  ADD COLUMN nutrition jsonb NOT NULL DEFAULT '{}';  -- {kcal,protein_g,carbs_g,fat_g} per serving, numbers
