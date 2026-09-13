-- CBD-231 SS3.3, SS5 (DB-231-001, DB-231-005, DB-231-006, DB-231-009).
--
-- The composite-uniqueness schedule-version and period tables SS3.3 requires
-- so that budget_space's schedule/period references cannot be satisfied
-- cross-budget. This is deliberately the minimal shape the creation
-- transaction needs (sequence, status, the reviewed cadence/preview values,
-- and period dates/status); CBD-26/CBD-27/CBD-29 own schedule-generation
-- algorithms and any further schedule-version internals and may extend these
-- tables in their own migrations without breaking this contract's composite
-- keys.
--
-- scope: budget-space
CREATE TABLE budget_space_schedule_version (
    schedule_version_id      uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id           uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    sequence                  integer     NOT NULL
                                         CHECK (sequence >= 1),
    status                    text        NOT NULL
                                         CHECK (status = 'authoritative'),

    cadence_definition        jsonb       NOT NULL,
    proposal_preview_digest  text        NOT NULL,

    created_at                timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (schedule_version_id),

    -- Composite unique target for budget_space's deferred
    -- initial_schedule_version_id / current_schedule_version_id foreign keys.
    UNIQUE (budget_space_id, schedule_version_id),
    -- No two schedule versions in one budget share a sequence number.
    UNIQUE (budget_space_id, sequence)
);

COMMENT ON TABLE budget_space_schedule_version IS
    'CBD-231 SS3.3: composite-uniqueness schedule-version reference for the creation transaction. CBD-26/CBD-27/CBD-29 own generation and further schedule-version internals.';

-- DB-231-005 (initial-schedule half): a second sequence-1 row for the same
-- budget is rejected outright. Sequence 1 is reserved for the one initial
-- authoritative schedule (BSL-231-005); the status CHECK above already
-- confines every row in this contract's scope to 'authoritative'.
CREATE UNIQUE INDEX budget_space_schedule_version_one_initial
    ON budget_space_schedule_version (budget_space_id)
    WHERE sequence = 1;

CREATE FUNCTION forbid_budget_space_schedule_version_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.schedule_version_id IS DISTINCT FROM OLD.schedule_version_id THEN
        RAISE EXCEPTION 'schedule_version_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id THEN
        RAISE EXCEPTION 'budget_space_schedule_version.budget_space_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.sequence IS DISTINCT FROM OLD.sequence THEN
        RAISE EXCEPTION 'budget_space_schedule_version.sequence is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_schedule_version_forbid_identity_mutation
    BEFORE UPDATE ON budget_space_schedule_version
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_schedule_version_identity_mutation();

REVOKE DELETE ON budget_space_schedule_version FROM cobudget_worker, cobudget_api;

-- scope: budget-space
CREATE TABLE budget_space_period (
    period_id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id           uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    schedule_version_id      uuid        NOT NULL,

    status                    text        NOT NULL
                                         CHECK (status IN ('active', 'planned')),
    period_start_date        date        NOT NULL,
    period_end_date           date        NOT NULL
                                         CHECK (period_end_date >= period_start_date),

    created_at                timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (period_id),

    -- A period's schedule version must belong to the same budget
    -- (BSL-231-010): the composite foreign key ties both columns together
    -- rather than trusting a bare schedule_version_id.
    FOREIGN KEY (budget_space_id, schedule_version_id)
        REFERENCES budget_space_schedule_version (budget_space_id, schedule_version_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- Composite unique target for budget_space's deferred current_period_id
    -- foreign key (matched together with current_schedule_version_id).
    UNIQUE (budget_space_id, schedule_version_id, period_id)
);

COMMENT ON TABLE budget_space_period IS
    'CBD-231 SS3.3: the immutable reviewed preview periods persisted at creation. Exactly one period per budget is active at a time (DB-231-006).';

-- DB-231-006: a second active current period for the same budget is
-- rejected outright.
CREATE UNIQUE INDEX budget_space_period_one_active
    ON budget_space_period (budget_space_id)
    WHERE status = 'active';

CREATE FUNCTION forbid_budget_space_period_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.period_id IS DISTINCT FROM OLD.period_id THEN
        RAISE EXCEPTION 'period_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id THEN
        RAISE EXCEPTION 'budget_space_period.budget_space_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.schedule_version_id IS DISTINCT FROM OLD.schedule_version_id THEN
        RAISE EXCEPTION 'budget_space_period.schedule_version_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_period_forbid_identity_mutation
    BEFORE UPDATE ON budget_space_period
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_period_identity_mutation();

REVOKE DELETE ON budget_space_period FROM cobudget_worker, cobudget_api;
