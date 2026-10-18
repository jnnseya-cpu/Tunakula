-- Price adjust on copy/sync: a copied branch can mark its prices up (or down) relative to its source
-- (e.g. +10% for a pricier location). The markup is stored per branch so later syncs keep applying it.
ALTER TABLE catalogue.branch ADD COLUMN IF NOT EXISTS price_markup_bps integer NOT NULL DEFAULT 0;
