-- Group ordering (the Uber Eats / DoorDash shared-cart feature): several people build one cart from
-- their own phones via an invite code, then the host places it as a single order and everyone sees
-- their share of the bill. Additive and server-side — the solo cart stays in the browser; a group
-- cart lives here so participants share it. Tenant tables under FORCE row-level security per country.

CREATE TABLE ordering.group_cart (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id),
  host_user_id uuid NOT NULL REFERENCES identity.app_user (id),
  code text NOT NULL,                              -- short code for the invite link
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'PLACED', 'CANCELLED')),
  order_type text NOT NULL DEFAULT 'DELIVERY' CHECK (order_type IN ('DELIVERY', 'TAKEAWAY')),
  split_mode text NOT NULL DEFAULT 'HOST_PAYS' CHECK (split_mode IN ('HOST_PAYS', 'EACH_PAYS')),
  deadline timestamptz,
  placed_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_cart_code ON ordering.group_cart (country_iso2, code) WHERE status IN ('OPEN', 'LOCKED');
CREATE INDEX group_cart_host ON ordering.group_cart (host_user_id, created_at);

CREATE TABLE ordering.group_cart_member (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  group_cart_id uuid NOT NULL REFERENCES ordering.group_cart (id),
  user_id uuid NOT NULL REFERENCES identity.app_user (id),
  display_name text NOT NULL,
  is_host boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_member_once ON ordering.group_cart_member (group_cart_id, user_id);

CREATE TABLE ordering.group_cart_line (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  group_cart_id uuid NOT NULL REFERENCES ordering.group_cart (id),
  member_user_id uuid NOT NULL REFERENCES identity.app_user (id),
  item_id uuid NOT NULL REFERENCES catalogue.menu_item (id),
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  options jsonb NOT NULL DEFAULT '[]',   -- [{group,choices:[...]}]
  addons jsonb NOT NULL DEFAULT '[]',    -- [addonId,...]
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_line_cart ON ordering.group_cart_line (group_cart_id, member_user_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ordering.group_cart', 'ordering.group_cart_member', 'ordering.group_cart_line'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_country ON %s USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country())', t);
  END LOOP;
END $$;
