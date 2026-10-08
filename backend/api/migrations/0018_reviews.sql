-- Reviews and ratings: after a delivered order the customer rates the restaurant (and optionally the
-- rider) and leaves a comment; the restaurant can reply. Ratings aggregate into each branch's average
-- (shown on the storefront and in the performance scorecard). Additive. One review per order; the
-- comment/reply are mutable (edits allowed), so not append-only. Tenant table, country RLS.
CREATE SCHEMA IF NOT EXISTS reviews;

CREATE TABLE reviews.order_review (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  order_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES catalogue.branch (id),
  customer_id uuid NOT NULL REFERENCES identity.app_user (id),
  rider_id uuid REFERENCES identity.app_user (id),
  restaurant_rating int NOT NULL CHECK (restaurant_rating BETWEEN 1 AND 5),
  rider_rating int CHECK (rider_rating BETWEEN 1 AND 5),
  comment text CHECK (length(comment) <= 1000),
  reply text CHECK (length(reply) <= 1000),
  replied_by uuid REFERENCES identity.app_user (id),
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX review_one_per_order ON reviews.order_review (order_id);
CREATE INDEX review_branch ON reviews.order_review (branch_id, created_at DESC);
CREATE INDEX review_rider ON reviews.order_review (rider_id) WHERE rider_id IS NOT NULL;

ALTER TABLE reviews.order_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews.order_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON reviews.order_review USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
