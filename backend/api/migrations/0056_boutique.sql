-- Boutique: a merchant category for bigger goods (homeware, electronics, furniture — the kind of items a shop
-- like NickyB sells) rather than food. It has two fulfilment modes, expressed as a per-branch delivery lead:
--   DIRECT   — delivers any time, like every other store (delivery_lead_days = 0).
--   INDIRECT — the item is made to order or shipped in, so it needs notice (delivery_lead_days >= 1; a boutique
--              set up this way defaults to 3). An order to it must be scheduled at least that many days ahead.
-- Additive: the store_type set only grows, and every existing branch keeps delivery_lead_days 0, so nothing
-- already live changes.
ALTER TABLE catalogue.branch DROP CONSTRAINT IF EXISTS branch_store_type_check;
ALTER TABLE catalogue.branch
  ADD CONSTRAINT branch_store_type_check CHECK (store_type IN ('RESTAURANT', 'GROCERY', 'CONVENIENCE', 'PHARMACY', 'BOUTIQUE'));

ALTER TABLE catalogue.branch
  ADD COLUMN IF NOT EXISTS delivery_lead_days integer NOT NULL DEFAULT 0 CHECK (delivery_lead_days BETWEEN 0 AND 60);
