-- Local development roles (CBD-117-AC05).
--
-- Runs once, as the bootstrap superuser, inside the database named by
-- POSTGRES_DB, the first time the volume is initialised (the official image's
-- /docker-entrypoint-initdb.d). It is NOT a migration: the migration check
-- does not read this directory, the ledger never records it, and nothing here
-- runs hosted. Hosted provisioning (CBD-119) creates the same three roles by
-- the same names and makes the migration role the database owner; everything
-- those roles are then GRANTED lives in migrations/, so the grants are
-- identical locally and hosted by construction rather than by transcription.
--
-- DP-105-003: an api role and a worker role holding data-manipulation rights
-- on application schemas only, and a migration role holding schema-change
-- rights. No application path holds superuser.
--
-- The passwords are deliberately short, obvious, and not secrets. They only
-- ever authenticate over the loopback interface of a developer's machine,
-- and the migration runner does not use them at all (it runs psql inside the
-- container over the Unix socket).

CREATE ROLE cobudget_migration LOGIN PASSWORD 'local-only-migration';
CREATE ROLE cobudget_api       LOGIN PASSWORD 'local-only-api';
CREATE ROLE cobudget_worker    LOGIN PASSWORD 'local-only-worker';

-- Owning the database is what gives the migration role CREATE on the public
-- schema (PostgreSQL 15 and later grant it to the database owner only) and
-- the right to drop and recreate that schema, which is what reset does.
ALTER DATABASE cobudget_dev OWNER TO cobudget_migration;

-- Already the default since PostgreSQL 15; stated so that it is a decision
-- and not an inheritance. Nobody but the migration role creates objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
