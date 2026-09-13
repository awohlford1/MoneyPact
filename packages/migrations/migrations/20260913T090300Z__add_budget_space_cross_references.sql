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
