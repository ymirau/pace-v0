-- sql/postgres/999_grants.sql
-- Grant the application login role DML on the `pace` schema and its tables.
--
-- WHY: the DDL scripts (001_schema.sql, 002_items.sql, …) are applied by the
-- schema OWNER (an admin/DBA role), so the objects are owned by that role. The
-- app connects as a separate, lower-privilege login role (`app_admin`), which
-- needs USAGE on the schema + CRUD on the tables. Without this, the app and its
-- readiness check (scripts.postgres.setup_db) fail with "permission denied for schema pace".
--
-- Run ONCE per environment, as the schema owner (or a superuser), AFTER the DDL:
--   psql "$ADMIN_POSTGRES_URL" -f sql/postgres/999_grants.sql
--
-- The login role is the shared platform app role `app_admin` (see _deploy/README.md);
-- if your environment uses a different login role, change it in the lines below.

GRANT USAGE ON SCHEMA pace TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pace TO app_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pace TO app_admin;

-- Auto-grant the same on any tables/sequences the owner adds to this schema
-- later, so you don't have to re-run the GRANTs above after a schema change.
-- (Applies to objects created by the role running this script — i.e. admin.)
ALTER DEFAULT PRIVILEGES IN SCHEMA pace
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA pace
    GRANT USAGE ON SEQUENCES TO app_admin;
