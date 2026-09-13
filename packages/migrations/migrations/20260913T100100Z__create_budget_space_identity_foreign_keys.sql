-- CBD-231 follow-up (Manager ruling CBD231-IMPL-001; packages/migrations/README.md
-- "Deferred identity foreign keys (CBD-231)"). CBD-212's identity/profile
-- schema now exists (20260913T100000Z, this same task packet,
-- CBD190-SCHEMA-001), so every plain account_subject_id/profile_id/
-- created_by_subject_id column named in that README note gets its foreign
-- key here, in one dedicated migration, exactly as promised.
--
-- Every reference is DEFERRABLE INITIALLY DEFERRED, matching the columns'
-- own tables' existing DEFERRABLE convention (see
-- 20260913T090000Z__create_budget_space.sql and
-- 20260913T090100Z__create_budget_space_membership.sql): the identity
-- mapping transaction (CBD-190 SS5.2) and the budget-creation transaction
-- (CBD-231/CBD-233) may each insert their own new rows in either order
-- inside one transaction, and only the final committed state is checked.
--
-- No data migration accompanies this file: the prototype milestone has no
-- pre-existing rows in any of the four tables below (CBD-212 SS8 -- "the
-- prototype milestone has no pre-existing subject population"), so there is
-- nothing to backfill or reconcile before installing these constraints.
ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_created_by_subject_id_fkey
    FOREIGN KEY (created_by_subject_id)
    REFERENCES account_subject (account_subject_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE budget_space_membership
    ADD CONSTRAINT budget_space_membership_account_subject_id_fkey
    FOREIGN KEY (account_subject_id)
    REFERENCES account_subject (account_subject_id)
    DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT budget_space_membership_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES financial_profile (profile_id)
    DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT budget_space_membership_created_by_subject_id_fkey
    FOREIGN KEY (created_by_subject_id)
    REFERENCES account_subject (account_subject_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE budget_creation_operation
    ADD CONSTRAINT budget_creation_operation_account_subject_id_fkey
    FOREIGN KEY (account_subject_id)
    REFERENCES account_subject (account_subject_id)
    DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT budget_creation_operation_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES financial_profile (profile_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE budget_creation_idempotency
    ADD CONSTRAINT budget_creation_idempotency_account_subject_id_fkey
    FOREIGN KEY (account_subject_id)
    REFERENCES account_subject (account_subject_id)
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN budget_space.created_by_subject_id IS
    'References account_subject (foreign key added 20260913T100100Z, CBD190-SCHEMA-001). Immutable, per the trigger in 20260913T090000Z.';

COMMENT ON COLUMN budget_space_membership.account_subject_id IS
    'References account_subject (foreign key added 20260913T100100Z, CBD190-SCHEMA-001). Immutable, per the trigger in 20260913T090100Z.';

COMMENT ON COLUMN budget_space_membership.profile_id IS
    'References financial_profile (foreign key added 20260913T100100Z, CBD190-SCHEMA-001). Immutable, per the trigger in 20260913T090100Z.';
