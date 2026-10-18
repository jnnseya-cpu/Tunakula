-- Database roles for a prod-like run (mirrors CI and the README).
-- `tunakula` owns the schema and runs migrations (CREATEDB, but NOT a superuser and NOT BYPASSRLS).
-- `tunakula_app` is the least-privilege application role the API connects as — it can never bypass RLS, so
-- row-level tenant isolation is enforced even against the app's own queries. The migrator grants it exactly
-- what it needs (SELECT/INSERT/UPDATE/DELETE on mutable tables, insert-only on append-only ones) on startup.
-- Change these passwords for anything beyond local/staging; prefer a secrets manager in production.
CREATE ROLE tunakula LOGIN PASSWORD 'tunakula' CREATEDB NOSUPERUSER NOBYPASSRLS;
CREATE ROLE tunakula_app LOGIN PASSWORD 'tunakula_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE tunakula OWNER tunakula;
