-- Merchant promotions (happy hour): a merchant runs a percentage discount on a dish, a category, or the whole
-- branch, optionally only during weekly time windows (e.g. 15:00-18:00). The discount lowers the item price at
-- quote time, so the merchant funds it by receiving less — no new ledger accounts or settlement changes. Additive:
-- with no active promotion, prices are unchanged. Tenant table, FORCE RLS per country; mutable (not append-only).

CREATE TABLE catalogue.menu_promotion (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id) ON DELETE CASCADE,
  name text NOT NULL,
  -- What the promotion covers: one dish, a whole category, or every dish in the branch.
  scope text NOT NULL CHECK (scope IN ('ITEM', 'CATEGORY', 'BRANCH')),
  target_item_id uuid REFERENCES catalogue.menu_item (id) ON DELETE CASCADE,
  target_category text,
  -- Discount in basis points off the dish price (e.g. 2000 = 20% off).
  percent_bps integer NOT NULL CHECK (percent_bps BETWEEN 1 AND 9000),
  -- Optional weekly windows (branch-local) when the promotion runs; empty = whenever active (same shape as hours).
  hours jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The target must match the scope.
  CHECK ((scope = 'ITEM' AND target_item_id IS NOT NULL) OR (scope = 'CATEGORY' AND target_category IS NOT NULL) OR (scope = 'BRANCH'))
);
CREATE INDEX menu_promotion_branch ON catalogue.menu_promotion (branch_id, active);

ALTER TABLE catalogue.menu_promotion ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.menu_promotion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON catalogue.menu_promotion USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
