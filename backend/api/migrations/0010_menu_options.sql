-- Food options: variations (configurable choices on a dish, e.g. Size: S/M/L) and add-ons (extras,
-- e.g. a bottle of water). Both carry a price delta in the settlement currency's minor units, applied
-- to the order line at quote time. Stored on the dish; RLS/tenant policy already cover menu_item.
ALTER TABLE catalogue.menu_item
  ADD COLUMN variations jsonb NOT NULL DEFAULT '[]',   -- [{id,name,type,required,min,max,options:[{id,name,price}]}]
  ADD COLUMN addons jsonb NOT NULL DEFAULT '[]';       -- [{id,name,price}]  (price = minor units, settlement currency)
