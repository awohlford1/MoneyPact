-- CBD-191 SS4 (SC-191-002). One row per account subject, holding the
-- monotonic session-version allocator and the subject-wide revocation
-- epoch. Session issuance and epoch bumps allocate both under an
-- optimistic compare-and-swap on this row (packages/sessions/src/store.ts;
-- @cobudget/data-access's client exposes no `SELECT ... FOR UPDATE`/
-- transaction primitive this package may add), so subject-wide revocation
-- is an O(1) update regardless of how many session rows exist for the
-- subject (CBD-191-AC04, AC08 bulk case). CBD191-REVIEW-IMPL-001 correctly
-- flagged an earlier revision of this comment for claiming a row lock that
-- was never implemented; this revision states the real mechanism.
--
-- `subject_lifecycle` and `latest_applied_cursor` were added in the
-- CBD191-CORRECTION-001 round: the first lets `consumeAndIssue` fail closed
-- on a disabled/deletion-pending/deleted/security-blocked subject inside the
-- same atomic allocation as the epoch/version fence (`SC-191-003A`); the
-- second lets provider-event cursor ordering (SS6.2 step 6) be decided
-- atomically alongside the epoch bump it may accompany, using the same
-- compare-and-swap this row already provides, rather than a separate
-- unsynchronized read.
--
-- DEFERRED IDENTITY FK (packet CBD191-IMPL-001, 2026-09-13): account_subject_id
-- is a plain identifier column with no foreign key, for the same reason
-- given in packages/migrations/migrations/20260913T090000Z__create_budget_space.sql
-- -- CBD-190/212's identity schema does not exist yet in this wave. A
-- follow-up migration (create_account_subject_identity_foreign_keys) must
-- add the reference to CBD-190's account_subject table once it lands.
--
-- scope: identity
CREATE TABLE account_subject_authority (
    account_subject_id   uuid        NOT NULL,

    next_session_version  bigint      NOT NULL DEFAULT 1
                                      CHECK (next_session_version > 0),

    revocation_epoch       integer     NOT NULL DEFAULT 1
                                      CHECK (revocation_epoch > 0),

    -- CBD191-CORRECTION-001 item 6 / SC-191-003A: the subject lifecycle the
    -- issuance fence rechecks. 'active' is the only state that may issue a
    -- new session; every other state is terminal-once-reached (see the
    -- guard trigger below) and represents disablement, pending deletion,
    -- confirmed deletion, or a confirmed security block.
    subject_lifecycle       text        NOT NULL DEFAULT 'active'
                                      CHECK (subject_lifecycle IN ('active', 'disabled', 'deletion_pending', 'deleted', 'security_blocked')),

    -- SS6.2 step 6: the highest authenticated provider ordering_cursor
    -- applied for this subject so far, updated atomically with
    -- revocation_epoch under the same compare-and-swap. Defaults to the
    -- empty string rather than NULL: `platformUpdate`'s CAS conditions bind
    -- an equality parameter (`column = $n`), and `x = NULL` is never true in
    -- SQL regardless of `x`, which would make a NULL sentinel impossible to
    -- include as a real CAS guard. The empty string sorts lexically below
    -- every real cursor value, so "no cursor applied yet" still compares
    -- correctly against a first real cursor.
    latest_applied_cursor   text        NOT NULL DEFAULT '',

    epoch_bumped_at         timestamptz,

    -- SS6.1 closed vocabulary. NULL until the first bump.
    epoch_bump_cause         text        CHECK (
                                        epoch_bump_cause IS NULL OR epoch_bump_cause IN (
                                            'logout_everywhere',
                                            'recovery_completed',
                                            'credential_or_factor_change',
                                            'account_deletion',
                                            'security_action',
                                            'permission_loss',
                                            'provider_global_sign_out',
                                            'provider_account_disabled',
                                            'provider_account_deleted',
                                            'provider_compromised_credentials_action'
                                        )
                                    ),

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (account_subject_id)
);

COMMENT ON TABLE account_subject_authority IS
    'CBD-191 SS4: one row per account subject; next_session_version, revocation_epoch, subject_lifecycle, and latest_applied_cursor are all allocated together under this row''s compare-and-swap so subject-wide revocation and provider-event ordering both stay O(1).';

CREATE FUNCTION account_subject_authority_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_subject_authority_set_updated_at
    BEFORE UPDATE ON account_subject_authority
    FOR EACH ROW
    EXECUTE FUNCTION account_subject_authority_touch_updated_at();

-- CBD191-REVIEW-IMPL-001 Medium finding: nothing previously stopped
-- next_session_version or revocation_epoch from decreasing, or
-- subject_lifecycle from leaving a terminal state. This guard makes both
-- monotonic and the terminal states sticky, independent of the application
-- code's own compare-and-swap discipline.
CREATE FUNCTION forbid_account_subject_authority_regression() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.next_session_version < OLD.next_session_version THEN
        RAISE EXCEPTION 'next_session_version must never decrease' USING ERRCODE = '23514';
    END IF;
    IF NEW.revocation_epoch < OLD.revocation_epoch THEN
        RAISE EXCEPTION 'revocation_epoch must never decrease' USING ERRCODE = '23514';
    END IF;
    IF NEW.latest_applied_cursor < OLD.latest_applied_cursor THEN
        RAISE EXCEPTION 'latest_applied_cursor must never decrease' USING ERRCODE = '23514';
    END IF;
    IF OLD.subject_lifecycle IN ('deleted', 'security_blocked') AND NEW.subject_lifecycle <> OLD.subject_lifecycle THEN
        RAISE EXCEPTION 'subject_lifecycle is terminal once deleted or security_blocked' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_subject_authority_forbid_regression
    BEFORE UPDATE ON account_subject_authority
    FOR EACH ROW
    EXECUTE FUNCTION forbid_account_subject_authority_regression();

REVOKE DELETE ON account_subject_authority FROM cobudget_worker, cobudget_api;
