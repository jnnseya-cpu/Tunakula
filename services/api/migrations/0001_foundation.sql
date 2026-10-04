-- PRD §21: PostgreSQL, one schema per bounded context, UUIDv7 keys,
-- tenant tables carry country_iso2 + brand_id and are protected by RLS.

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS catalogue;
CREATE SCHEMA IF NOT EXISTS ordering;
CREATE SCHEMA IF NOT EXISTS money;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS api;

-- UUIDv7 (RFC 9562): time-ordered, index-friendly primary keys.
CREATE OR REPLACE FUNCTION platform.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b bytea := uuid_send(gen_random_uuid());
BEGIN
  b := set_byte(b, 0, ((ts >> 40) & 255)::int);
  b := set_byte(b, 1, ((ts >> 32) & 255)::int);
  b := set_byte(b, 2, ((ts >> 24) & 255)::int);
  b := set_byte(b, 3, ((ts >> 16) & 255)::int);
  b := set_byte(b, 4, ((ts >> 8) & 255)::int);
  b := set_byte(b, 5, (ts & 255)::int);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- variant 10
  RETURN encode(b, 'hex')::uuid;
END $$;

-- The active country of the request (X-Country, §9.5); NULL when unset, which matches no tenant row.
CREATE OR REPLACE FUNCTION platform.current_country() RETURNS char(2)
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.country', true), '')::char(2) $$;

-- Append-only guard for event stores, ledgers and audit (MR-7, REM-005).
CREATE OR REPLACE FUNCTION platform.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %.%: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
