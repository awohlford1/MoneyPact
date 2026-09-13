-- CBD-191 SS3.1, SS6.1, SS6.3. The transactional outbox for
-- provider/delegation revocation actions: inserted in the same application
-- transaction as the epoch bump or single-row revoke it accompanies, and
-- drained by a worker job (packages/sessions exports the job function; a
-- follow-up assigns apps/worker registration). Contains no cookie, token,
-- contact attribute, or provider credential.
--
-- DEFERRED IDENTITY FK (packet CBD191-IMPL-001, 2026-09-13): account_subject_id
-- and identity_binding_id are plain identifier columns with no foreign key,
-- for the reason given in 20260913T110001Z__create_account_session.sql.
--
-- scope: identity
CREATE TABLE revocation_outbox (
    revocation_action_id   uuid        NOT NULL DEFAULT gen_random_uuid(),

    account_subject_id        uuid        NOT NULL,
    identity_binding_id        uuid,
    environment_id              text        NOT NULL
                                           CHECK (char_length(environment_id) > 0),

    -- SS6.1 closed vocabulary, shared with account_session.revocation_cause
    -- and account_subject_authority.epoch_bump_cause.
    cause                         text        NOT NULL
                                           CHECK (cause IN (
                                               'logout',
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
                                           )),

    -- SS3.1 closed vocabulary.
    target                         text        NOT NULL
                                           CHECK (target IN ('provider_global_invalidation', 'provider_current_browser_bound', 'delegation_retirement')),

    revocation_epoch                integer     NOT NULL
                                           CHECK (revocation_epoch > 0),

    occurred_at                      timestamptz NOT NULL,
    committed_at                     timestamptz NOT NULL DEFAULT now(),
    deadline_at                       timestamptz NOT NULL,

    -- SS6.1 closed vocabulary: durable exponential-backoff retry state.
    attempt_state                     text        NOT NULL DEFAULT 'pending'
                                           CHECK (attempt_state IN ('pending', 'in_flight', 'succeeded', 'ambiguous', 'failed_will_retry', 'failed_deadline_exceeded')),
    attempt_count                     integer     NOT NULL DEFAULT 0
                                           CHECK (attempt_count >= 0),
    next_attempt_at                   timestamptz,

    provider_reconciliation_cursor   text,

    created_at                         timestamptz NOT NULL DEFAULT now(),
    updated_at                         timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (revocation_action_id),

    CONSTRAINT revocation_outbox_deadline_after_occurrence CHECK (deadline_at >= occurred_at)
);

COMMENT ON TABLE revocation_outbox IS
    'CBD-191 SS6.1/SS6.3: durable provider/delegation revocation actions, inserted transactionally with the application epoch bump or row revoke that caused them.';

CREATE INDEX revocation_outbox_claimable_idx ON revocation_outbox (deadline_at)
    WHERE attempt_state IN ('pending', 'failed_will_retry');
CREATE INDEX revocation_outbox_subject_idx ON revocation_outbox (account_subject_id);

CREATE FUNCTION revocation_outbox_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER revocation_outbox_set_updated_at
    BEFORE UPDATE ON revocation_outbox
    FOR EACH ROW
    EXECUTE FUNCTION revocation_outbox_touch_updated_at();

-- Only the retry/attempt bookkeeping columns are ever updated in place; the
-- cause, target, subject/binding/environment, epoch, and timing fields that
-- describe *what* was committed are immutable once inserted (SS6.1).
CREATE FUNCTION forbid_revocation_outbox_identity_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.account_subject_id <> OLD.account_subject_id
        OR NEW.environment_id <> OLD.environment_id
        OR NEW.cause <> OLD.cause
        OR NEW.target <> OLD.target
        OR NEW.revocation_epoch <> OLD.revocation_epoch
        OR NEW.occurred_at <> OLD.occurred_at
        OR NEW.committed_at <> OLD.committed_at
        OR NEW.deadline_at <> OLD.deadline_at
    THEN
        RAISE EXCEPTION 'revocation_outbox identity, cause, target, and timing fields are immutable once inserted'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER revocation_outbox_forbid_identity_update
    BEFORE UPDATE ON revocation_outbox
    FOR EACH ROW
    EXECUTE FUNCTION forbid_revocation_outbox_identity_update();

REVOKE DELETE ON revocation_outbox FROM cobudget_worker, cobudget_api;
