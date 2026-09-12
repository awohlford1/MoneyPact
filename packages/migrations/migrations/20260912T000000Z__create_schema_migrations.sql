-- The applied-state ledger.
--
-- CBD-116-AC02: what has been applied lives in the database, not in a file,
-- so two environments cannot hold different opinions about it.
--
-- This is the migration that creates the table the runner reads, which is why
-- the runner's read tolerates the table's absence instead of creating it in a
-- bootstrap step of its own. The definition exists here and nowhere else, and
-- it is subject to the same migration check as every other table.
--
-- No extension is created. gen_random_uuid() has been in core PostgreSQL
-- since 13, and an extension the schema does not use is a privilege
-- requirement bought for nothing. CBD-117 adds one if its schema needs one.

-- scope: platform
CREATE TABLE cobudget_schema_migrations (
    ordinal     text        PRIMARY KEY
                            CHECK (ordinal ~ '^[0-9]{8}T[0-9]{6}Z$'),
    name        text        NOT NULL
                            CHECK (name <> ''),
    checksum    text        NOT NULL
                            CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at  timestamptz NOT NULL DEFAULT now(),
    applied_by  text        NOT NULL DEFAULT current_user,
    apply_seq   bigint      GENERATED ALWAYS AS IDENTITY
);

COMMENT ON TABLE cobudget_schema_migrations IS
    'Forward-only migration ledger: one row per applied migration, inserted in the same transaction as the migration itself.';

COMMENT ON COLUMN cobudget_schema_migrations.ordinal IS
    'The UTC stamp from the file name. Unique, and the deterministic sort key.';

COMMENT ON COLUMN cobudget_schema_migrations.checksum IS
    'sha256 of the migration text with line endings normalised. A mismatch means an applied migration was edited, which forward-only migrations do not allow.';

COMMENT ON COLUMN cobudget_schema_migrations.apply_seq IS
    'The order migrations actually ran in, which is not always ordinal order: a migration authored on a branch can arrive after a later ordinal has already been applied.';
