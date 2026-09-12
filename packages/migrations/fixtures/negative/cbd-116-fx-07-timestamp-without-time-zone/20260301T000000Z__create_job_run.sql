-- CBD-116-FX-07. A timestamp without time zone.
-- scope: platform
CREATE TABLE platform_job_run (
    id          uuid NOT NULL,
    started_at  timestamp NOT NULL,
    PRIMARY KEY (id)
);
