#!/bin/sh
# Runs once, when the database volume is first created.
# Three roles with least privilege:
#   foodz_migrator  owns the schema and runs migrations
#   foodz_app       reads and writes rows only; row-level security applies to it
#   foodz_readonly  reads only (analytics)
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE ROLE foodz_migrator LOGIN PASSWORD '${DB_MIGRATOR_PASSWORD}' CREATEDB;
CREATE ROLE foodz_app LOGIN PASSWORD '${DB_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE foodz_readonly LOGIN PASSWORD '${DB_READONLY_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO foodz_migrator, foodz_app, foodz_readonly;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO foodz_migrator;
GRANT USAGE ON SCHEMA public TO foodz_app, foodz_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE foodz_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foodz_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foodz_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO foodz_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foodz_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO foodz_readonly;
SQL
