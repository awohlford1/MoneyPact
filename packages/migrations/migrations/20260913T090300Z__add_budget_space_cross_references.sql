-- CBD-231 SS3, SS5 (DB-231-004, DB-231-005). Adds the composite foreign keys
-- from budget_space to the membership/schedule/period tables created by the
-- three migrations before this one, and the deferred constraint trigger that
-- proves the referenced rows are the right *kind* of row -- a foreign key
-- alone proves existence and same-budget membership, not that the
-- referenced membership is an active Primary Owner, that the referenced
-- initial schedule is sequence 1, or that the referenced current period is
-- active under the current schedule.
--
-- Every foreign key here is DEFERRABLE INITIALLY DEFERRED so budget_space
-- and its first membership/schedule/period rows can be inserted in either
-- order inside one transaction (CBD-233 SS4 step 6) without a temporarily
-- unbound or nullable budget shape (CBD-231 SS7).

ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_primary_owner_fkey
        FOREIGN KEY (budget_space_id, primary_owner_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_initial_schedule_fkey
        FOREIGN KEY (budget_space_id, initial_schedule_version_id)
        REFERENCES budget_space_schedule_version (budget_space_id, schedule_version_id)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_current_schedule_fkey
        FOREIGN KEY (budget_space_id, current_schedule_version_id)
        REFERENCES budget_space_schedule_version (budget_space_id, schedule_version_id)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_current_period_fkey
        FOREIGN KEY (budget_space_id, current_schedule_version_id, current_period_id)
        REFERENCES budget_space_period (budget_space_id, schedule_version_id, period_id)
        DEFERRABLE INITIALLY DEFERRED;

-- DB-231-004 (bidirectional half) and DB-231-005 (current-period/initial-
-- sequence half). Runs once per statement affecting the relevant columns,
-- deferred to just before commit alongside the foreign keys above.
CREATE FUNCTION check_budget_space_creation_invariants() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_owner_role   text;
    v_owner_status text;
    v_period_status text;
    v_schedule_seq  integer;
    v_schedule_status text;
BEGIN
    SELECT role, status INTO v_owner_role, v_owner_status
        FROM budget_space_membership
        WHERE budget_space_id = NEW.budget_space_id
          AND membership_id = NEW.primary_owner_membership_id;
    IF v_owner_role IS DISTINCT FROM 'primary_owner' OR v_owner_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION
            'budget_space %: primary_owner_membership_id % is not an active primary_owner membership',
            NEW.budget_space_id, NEW.primary_owner_membership_id
            USING ERRCODE = '23514';
    END IF;

    SELECT sequence, status INTO v_schedule_seq, v_schedule_status
        FROM budget_space_schedule_version
        WHERE budget_space_id = NEW.budget_space_id
          AND schedule_version_id = NEW.initial_schedule_version_id;
    IF v_schedule_seq IS DISTINCT FROM 1 OR v_schedule_status IS DISTINCT FROM 'authoritative' THEN
        RAISE EXCEPTION
            'budget_space %: initial_schedule_version_id % is not the sequence-1 authoritative schedule',
            NEW.budget_space_id, NEW.initial_schedule_version_id
            USING ERRCODE = '23514';
    END IF;

    -- BSL-231-005 / SS3.1: "current_schedule_version_id ... equals
    -- initial_schedule_version_id at creation." Nothing in this migration
    -- set gives a budget a second schedule version, so this contract holds
    -- unconditionally today; a future approved schedule-rollover migration
    -- owns any relaxation of it.
    IF NEW.current_schedule_version_id IS DISTINCT FROM NEW.initial_schedule_version_id THEN
        RAISE EXCEPTION
            'budget_space %: current_schedule_version_id % must equal initial_schedule_version_id % at creation',
            NEW.budget_space_id, NEW.current_schedule_version_id, NEW.initial_schedule_version_id
            USING ERRCODE = '23514';
    END IF;

    SELECT status INTO v_period_status
        FROM budget_space_period
        WHERE budget_space_id = NEW.budget_space_id
          AND schedule_version_id = NEW.current_schedule_version_id
          AND period_id = NEW.current_period_id;
    IF v_period_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION
            'budget_space %: current_period_id % is not an active period under the current schedule version',
            NEW.budget_space_id, NEW.current_period_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER budget_space_creation_invariants
    AFTER INSERT OR UPDATE OF
        primary_owner_membership_id,
        initial_schedule_version_id,
        current_schedule_version_id,
        current_period_id
    ON budget_space
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_budget_space_creation_invariants();

-- DB-231-005/006 (referenced-side half). The trigger above only re-fires
-- when budget_space's own reference columns change; it never fires when the
-- currently-referenced period itself is mutated in place (its status moved
-- off 'active'). Without this trigger, `UPDATE budget_space_period SET
-- status = 'planned'` on the row a budget currently points to as its
-- current_period_id commits cleanly and leaves that budget referencing an
-- inactive period, which is exactly the state DB-231-005/006 exist to make
-- unreachable at every committed state, not only immediately after
-- creation. budget_space_period's identity columns (period_id,
-- budget_space_id, schedule_version_id) are already immutable
-- (20260913T090200Z), so status is the only column that can move a
-- currently-referenced row out of compliance.
CREATE FUNCTION check_budget_space_period_reference_invariant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_referencing_budget uuid;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT budget_space_id INTO v_referencing_budget
        FROM budget_space
        WHERE budget_space_id = NEW.budget_space_id
          AND current_schedule_version_id = NEW.schedule_version_id
          AND current_period_id = NEW.period_id;

    IF v_referencing_budget IS NOT NULL AND NEW.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION
            'budget_space %: current_period_id % can no longer be updated to status % because it is the active current period',
            v_referencing_budget, NEW.period_id, NEW.status
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER budget_space_period_reference_invariant
    AFTER UPDATE OF status
    ON budget_space_period
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_budget_space_period_reference_invariant();
