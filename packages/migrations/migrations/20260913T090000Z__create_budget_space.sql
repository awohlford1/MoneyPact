-- CBD-231 SS3.1, SS5 (DB-231-001, DB-231-002, DB-231-003, DB-231-009).
--
-- The budget-space identity row. Cross-references to the initial Primary
-- Owner membership, the initial/current schedule version, and the current
-- period are declared here as plain uuid columns because those tables do not
-- exist until the migrations that follow in this same set; the composite
-- foreign keys and the deferred bidirectional-invariant trigger are added in
-- 20260913T090300Z__add_budget_space_cross_references.sql, once every target
-- table and its composite unique key exist. Until that migration runs later
-- in the same apply, nothing in this file alone lets an orphaned reference
-- commit, because no other migration in this set is applied without it.
--
-- DEFERRED IDENTITY FK (Manager ruling, CBD231-IMPL-001, 2026-09-13):
-- created_by_subject_id is a plain identifier column with no foreign key.
-- CBD-212's identity schema (subject/account tables) is not implemented yet
-- (CBD-190 unimplemented), so there is nothing to reference. A follow-up
-- migration, to be named create_budget_space_identity_foreign_keys once
-- CBD-212 lands, must add
-- `FOREIGN KEY (created_by_subject_id) REFERENCES <identity subject table>
-- DEFERRABLE INITIALLY DEFERRED` (and the equivalent columns on
-- budget_space_membership and the budget_creation_* tables added later in
-- this set). See packages/migrations/README.md for the tracked note.
--
-- scope: budget-space
CREATE TABLE budget_space (
    budget_space_id              uuid        NOT NULL DEFAULT gen_random_uuid(),

    name                          text        NOT NULL
                                              CHECK (name = btrim(name))
                                              CHECK (char_length(name) BETWEEN 1 AND 100),
    name_version                  integer     NOT NULL DEFAULT 1
                                              CHECK (name_version >= 1),

    time_zone                     text        NOT NULL
                                              CHECK (char_length(time_zone) > 0),
    time_zone_data_version        text        NOT NULL
                                              CHECK (char_length(time_zone_data_version) > 0),
    currency_code                 text        NOT NULL
                                              CHECK (currency_code ~ '^[A-Z]{3}$'),
    currency_catalog_version      text        NOT NULL
                                              CHECK (char_length(currency_catalog_version) > 0),

    lifecycle                     text        NOT NULL DEFAULT 'live'
                                              CHECK (lifecycle IN ('live', 'archived')),
    lifecycle_version             integer     NOT NULL DEFAULT 1
                                              CHECK (lifecycle_version >= 1),

    -- Populated with the server-allocated candidate identifiers in the same
    -- insert (CBD-233 SS4 step 6); the composite foreign keys validating them
    -- are deferred to 20260913T090300Z so mutually referring rows can be
    -- assembled in one transaction (CBD-231 SS5 closing paragraph).
    primary_owner_membership_id  uuid        NOT NULL,
    initial_schedule_version_id  uuid        NOT NULL,
    current_schedule_version_id  uuid        NOT NULL,
    current_period_id            uuid        NOT NULL,

    created_by_subject_id        uuid        NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (budget_space_id),

    -- Composite unique targets for the deferred cross-reference foreign keys
    -- added in 20260913T090300Z; a bare PK on budget_space_id cannot be the
    -- target of a two-column composite FK from a child table.
    UNIQUE (budget_space_id, primary_owner_membership_id),
    UNIQUE (budget_space_id, initial_schedule_version_id),
    UNIQUE (budget_space_id, current_schedule_version_id)
);

COMMENT ON TABLE budget_space IS
    'CBD-231 SS3.1: budget-space identity, name, time zone/currency context, lifecycle, and cross-references to the initial owner membership, initial/current schedule version, and current period.';

COMMENT ON COLUMN budget_space.created_by_subject_id IS
    'Plain identifier, foreign key deliberately deferred: see the header of this migration and packages/migrations/README.md.';

-- DB-231-001: an immutable-ID update trigger. PRIMARY KEY alone does not stop
-- an UPDATE from changing the key value; provenance columns are likewise
-- write-once. Lifecycle, rename, and the cross-reference columns intended to
-- change under an explicit optimistic-version command (DB-231-010) are not
-- included here.
CREATE FUNCTION forbid_budget_space_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id THEN
        RAISE EXCEPTION 'budget_space_id is immutable (attempted % -> %)',
            OLD.budget_space_id, NEW.budget_space_id
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_by_subject_id IS DISTINCT FROM OLD.created_by_subject_id THEN
        RAISE EXCEPTION 'budget_space.created_by_subject_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'budget_space.created_at is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_forbid_identity_mutation
    BEFORE UPDATE ON budget_space
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_identity_mutation();

-- DB-231-009: archival is the only lifecycle exit; a persistent budget is
-- never hard-deleted through an application role. cobudget_migration keeps
-- DELETE (needed only for the migration-preflight/reset tooling itself,
-- never used against live customer rows by application code).
REVOKE DELETE ON budget_space FROM cobudget_worker, cobudget_api;
