-- Coupons gain an optional merchant scope and a funder, so an admin can create a market-wide code
-- (as before) or one tied to a single merchant, funded by the platform or by that merchant.
--   branch_id NULL   → valid at every storefront in the market (unchanged behaviour).
--   branch_id set    → valid only on orders from that storefront.
--   funded_by PLATFORM → the platform funds the discount at settlement (promotion_expense), as today.
--   funded_by MERCHANT → the merchant funds it: their payout is reduced by the discount (clamped to
--                        what they earn on the order), so a merchant-funded code must name the merchant.
-- Additive. Existing rows default to a market-wide, platform-funded coupon.
ALTER TABLE promotions.coupon
  ADD COLUMN branch_id uuid REFERENCES catalogue.branch (id),
  ADD COLUMN funded_by text NOT NULL DEFAULT 'PLATFORM' CHECK (funded_by IN ('PLATFORM', 'MERCHANT'));

-- A merchant-funded coupon must name the merchant whose payout funds it.
ALTER TABLE promotions.coupon
  ADD CONSTRAINT coupon_merchant_funding CHECK (funded_by = 'PLATFORM' OR branch_id IS NOT NULL);

CREATE INDEX coupon_branch ON promotions.coupon (branch_id) WHERE branch_id IS NOT NULL;
