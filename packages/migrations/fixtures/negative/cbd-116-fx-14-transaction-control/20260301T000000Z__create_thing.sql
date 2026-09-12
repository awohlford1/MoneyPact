-- CBD-116-FX-14. Ends the runner's transaction from inside a migration, which
-- would let the schema and the ledger disagree if a later migration failed.
-- scope: platform
CREATE TABLE platform_committing_thing (
    id  uuid PRIMARY KEY
);
COMMIT;
