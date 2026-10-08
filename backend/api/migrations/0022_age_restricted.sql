-- Age-restricted items (alcohol and the like): a dish can be flagged 18+, the customer confirms their
-- age at checkout, and the order is marked so the rider checks ID at the door. Additive; defaults false.
ALTER TABLE catalogue.menu_item ADD COLUMN age_restricted boolean NOT NULL DEFAULT false;
