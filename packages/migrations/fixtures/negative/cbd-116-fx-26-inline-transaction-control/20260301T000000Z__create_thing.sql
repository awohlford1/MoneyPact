-- CBD-116-FX-26. The same transaction control as FX-14, not at the start of a
-- line. A statement that ends the runner's transaction ends it wherever it
-- sits, so a line-anchored rule is a guard with a gap rather than a guard.
-- scope: platform
CREATE TABLE platform_inline_thing (
    id  uuid NOT NULL,
    PRIMARY KEY (id)
); COMMIT;
