-- CBD-116-FX-13. An up migration carrying another tool's reversion directive.
-- scope: platform
CREATE TABLE platform_directive_thing (
    id  uuid PRIMARY KEY
);

-- migrate:down
-- DROP TABLE platform_directive_thing;
