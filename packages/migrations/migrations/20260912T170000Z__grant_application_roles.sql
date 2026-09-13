-- Application role grants (CBD-117-AC05, DP-105-003).
--
-- Forward-only. There is no down migration: rollback is a code and
-- configuration operation (TD-103-028), and local recovery is
-- reset and re-migrate.
--
-- The three roles exist before this runs: locally they are created by
-- packages/migrations/local/initdb/010-roles.sh on first start, hosted by
-- provisioning (CBD-119). This migration is what makes their grants the same
-- in both places, because it is the same text applied by the same command.
--
-- api and worker: data manipulation on application tables, and nothing else.
-- migration: owns everything it creates, and is the role that runs this.
--
-- Default privileges are attached to the migration role because it is the
-- role that will create every future table; a table created by anyone else
-- would not inherit them, which is the point.

GRANT USAGE ON SCHEMA public TO cobudget_worker, cobudget_api;

ALTER DEFAULT PRIVILEGES FOR ROLE cobudget_migration IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cobudget_worker, cobudget_api;

ALTER DEFAULT PRIVILEGES FOR ROLE cobudget_migration IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO cobudget_worker, cobudget_api;

-- The ledger is not an application table. It was created by the migration
-- before this one, so the default privileges above never touched it, and
-- nothing is granted on it here: the application has no business reading or
-- writing its own migration history.
