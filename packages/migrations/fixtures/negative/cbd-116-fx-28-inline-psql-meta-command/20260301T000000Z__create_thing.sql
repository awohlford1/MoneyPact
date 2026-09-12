-- CBD-116-FX-28. A psql meta-command that is not at the start of a line,
-- mirroring FX-26. psql dispatches an unquoted backslash wherever it appears,
-- so a line-anchored rule reports this file as clean.
--
-- This particular one is the worst available: \c reconnects. The runner's open
-- transaction goes away with the first connection, every migration after this
-- point and every ledger row it writes commit against a different database,
-- ON_ERROR_STOP never fires, and apply prints "applied N migration(s)" for a
-- database that received nothing at all.
-- scope: platform
CREATE TABLE platform_meta_thing (
    id  uuid NOT NULL,
    PRIMARY KEY (id)
); \c cobudget_other
