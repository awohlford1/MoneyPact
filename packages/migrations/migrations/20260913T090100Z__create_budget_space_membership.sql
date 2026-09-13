-- CBD-231 SS3.2, SS5 (DB-231-001, DB-231-004, DB-231-007, DB-231-009).
--
-- The initial Primary Owner membership row inserted by the creation
-- transaction. budget_space already exists (previous migration in this set),
-- so the ordinary foreign key to it can be declared directly; it is still
-- marked DEFERRABLE so either insert order works inside one transaction.
--
-- DEFERRED IDENTITY FK (Manager ruling, CBD231-IMPL-001, 2026-09-13):
-- account_subject_id, profile_id, and created_by_subject_id are plain
-- identifier columns with no foreign key. CBD-212's identity/profile schema
-- is not implemented yet (CBD-190 unimplemented), so DB-231-007's "composite
-- subject/profile validation" cannot reference a real table today; only the
-- membership-to-budget foreign key half of DB-231-007 is enforced here. The
-- same follow-up migration named in the previous file
-- (create_budget_space_identity_foreign_keys) must add the subject/profile
-- foreign keys once CBD-212 lands. See packages/migrations/README.md.
--
-- scope: budget-space
CREATE TABLE budget_space_membership (
    membership_id           uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id         uuid        NOT NULL
                                        REFERENCES budget_space (budget_space_id)
                                        DEFERRABLE INITIALLY DEFERRED,

    profile_id               uuid        NOT NULL,
    account_subject_id       uuid        NOT NULL,

    role                      text        NOT NULL
                                        CHECK (role = 'primary_owner'),
    status                    text        NOT NULL
                                        CHECK (status = 'active'),
    authorization_version    integer     NOT NULL DEFAULT 1
                                        CHECK (authorization_version >= 1),

    created_by_subject_id    uuid        NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (membership_id),

    -- Composite unique target for budget_space's deferred
    -- primary_owner_membership_id foreign key (BSL-231-010 tenant coherence:
    -- a membership from another budget cannot satisfy the reference).
    UNIQUE (budget_space_id, membership_id)
);

COMMENT ON TABLE budget_space_membership IS
    'CBD-231 SS3.2: the creation-transaction Primary Owner membership. Additional roles/statuses and later membership rows are out of this contract''s scope (widening the role/status CHECK is a future migration).';

COMMENT ON COLUMN budget_space_membership.account_subject_id IS
    'Plain identifier, foreign key deliberately deferred: see this migration''s header and packages/migrations/README.md.';

COMMENT ON COLUMN budget_space_membership.profile_id IS
    'Plain identifier, foreign key deliberately deferred: see this migration''s header and packages/migrations/README.md.';

-- DB-231-004 (first half): a second active Primary Owner for the same budget
-- is rejected outright by this partial unique index, independent of the
-- deferred bidirectional trigger added once budget_space's own reference
-- exists (20260913T090300Z).
CREATE UNIQUE INDEX budget_space_membership_one_active_primary_owner
    ON budget_space_membership (budget_space_id)
    WHERE role = 'primary_owner' AND status = 'active';

-- DB-231-001: identity/provenance columns are write-once.
CREATE FUNCTION forbid_budget_space_membership_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.membership_id IS DISTINCT FROM OLD.membership_id THEN
        RAISE EXCEPTION 'membership_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id THEN
        RAISE EXCEPTION 'budget_space_membership.budget_space_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id THEN
        RAISE EXCEPTION 'budget_space_membership.account_subject_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'budget_space_membership.profile_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_by_subject_id IS DISTINCT FROM OLD.created_by_subject_id THEN
        RAISE EXCEPTION 'budget_space_membership.created_by_subject_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'budget_space_membership.created_at is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_membership_forbid_identity_mutation
    BEFORE UPDATE ON budget_space_membership
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_membership_identity_mutation();

-- DB-231-009: membership rows for the initial Primary Owner are not hard
-- deleted through an application role.
REVOKE DELETE ON budget_space_membership FROM cobudget_worker, cobudget_api;
