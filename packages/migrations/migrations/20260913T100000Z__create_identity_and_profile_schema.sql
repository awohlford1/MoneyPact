-- CBD-190 SS5.1-5.3 (identity mapping schema) and CBD-212 SS3-SS5, SS7-SS8
-- (financial-profile persistence, lifecycle, and the CBD190-PROFILE-ATOMIC-001
-- deferred cardinality invariant). SCHEMA half only (CBD190-SCHEMA-001): this
-- migration creates the tables, constraints, and deferred triggers the
-- contract requires; the identity adapter, mapping transaction, and CBD-212
-- application ports (getOrCreateActiveProfile, the CBD-246 subject-scoped
-- statement path) are separate, later work and are deliberately not touched
-- here.
--
-- Column exclusions (CBD-190 SS5.1): identity_callback carries no raw token,
-- code, state, nonce, contact attribute, or provider-error text -- only a
-- keyed replay digest, opaque references, and a closed outcome vocabulary.
--
-- Physical choices made here that the contract leaves open (recorded for the
-- Manager/reviewer rather than silently assumed):
--   * every opaque identifier is `uuid DEFAULT gen_random_uuid()`, matching
--     the CBD-231 convention already in this directory;
--   * `account_subject.lifecycle_state` is the closed vocabulary CBD-212 SS4
--     SS5 already names by name: active, disabled, deletion_pending, deleted,
--     security_blocked -- deleted is the sole terminal state;
--   * `identity_binding.lifecycle_state` is `active` / `revoked`, since
--     CBD-190 SS5.1 requires only "a lifecycle state" and never a second
--     value for it;
--   * `identity_callback.processing_state` is `processing` / `handoff_ready`
--     / `terminal`, exactly SS5.2's three named states, with
--     `terminal_outcome` a nullable closed vocabulary populated only once
--     `processing_state = 'terminal'`, taken verbatim from the SS7 outcome
--     table;
--   * `identity_session_handoff.state` is `prepared` / `consumed` /
--     `terminal_failed`, exactly SS5.1's three named states;
--   * index names follow `<table>_<columns>_key` for uniqueness constraints
--     and `<table>_<purpose>` for the deferred-trigger function/trigger pair,
--     matching the CBD-231 files' naming;
--   * `identity_callback.session_handoff_id` and
--     `identity_session_handoff.challenge_id` reference each other, so both
--     foreign keys are added by `ALTER TABLE ... DEFERRABLE INITIALLY
--     DEFERRED` after both tables exist, the same technique CBD-231 used for
--     `budget_space`'s forward references.
--
-- scope: identity
CREATE TABLE account_subject (
    account_subject_id  uuid        NOT NULL DEFAULT gen_random_uuid(),

    lifecycle_state       text        NOT NULL DEFAULT 'active'
                                      CHECK (lifecycle_state IN (
                                          'active', 'disabled', 'deletion_pending',
                                          'deleted', 'security_blocked'
                                      )),
    lifecycle_version     integer     NOT NULL DEFAULT 1
                                      CHECK (lifecycle_version >= 1),

    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (account_subject_id)
);

COMMENT ON TABLE account_subject IS
    'CBD-190 SS5.1: the opaque account-subject identity and lifecycle/version state. A row here never commits without exactly one active financial_profile row (CBD190-PROFILE-ATOMIC-001), enforced by the deferred pair trigger below.';

-- CBD-190 SS5.1: identifier and creation time are write-once.
CREATE FUNCTION forbid_account_subject_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id THEN
        RAISE EXCEPTION 'account_subject_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'account_subject.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_subject_forbid_identity_mutation
    BEFORE UPDATE ON account_subject
    FOR EACH ROW
    EXECUTE FUNCTION forbid_account_subject_identity_mutation();

-- Terminal deletion is a lifecycle exit, never a hard delete of the row
-- itself (CBD-212 SS5 LC-212-06: the terminal subject/tombstone remains the
-- non-resurrection authority).
REVOKE DELETE ON account_subject FROM cobudget_worker, cobudget_api;

-- scope: identity
CREATE TABLE identity_binding (
    identity_binding_id  uuid        NOT NULL DEFAULT gen_random_uuid(),

    environment_id         text        NOT NULL
                                       CHECK (char_length(environment_id) > 0),
    issuer                  text        NOT NULL
                                       CHECK (char_length(issuer) > 0),
    provider_subject        text        NOT NULL
                                       CHECK (char_length(provider_subject) > 0),

    account_subject_id     uuid        NOT NULL
                                       REFERENCES account_subject (account_subject_id)
                                       DEFERRABLE INITIALLY DEFERRED,

    lifecycle_state         text        NOT NULL DEFAULT 'active'
                                       CHECK (lifecycle_state IN ('active', 'revoked')),
    binding_version         integer     NOT NULL DEFAULT 1
                                       CHECK (binding_version >= 1),

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (identity_binding_id),

    -- CBD-190 SS5.1: "Unique on (environment_id, issuer, provider_subject)".
    -- An issuer is part of identity; the same sub under a different issuer or
    -- environment is a different provider identity.
    UNIQUE (environment_id, issuer, provider_subject),
    -- CBD-190 SS5.1: "separately unique on (environment_id, account_subject_id)".
    -- One account subject holds at most one binding per environment.
    UNIQUE (environment_id, account_subject_id)
);

COMMENT ON TABLE identity_binding IS
    'CBD-190 SS5.1: the immutable provider-identity-to-account-subject mapping. No raw token, code, state, or nonce is stored here.';

CREATE FUNCTION forbid_identity_binding_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.identity_binding_id IS DISTINCT FROM OLD.identity_binding_id THEN
        RAISE EXCEPTION 'identity_binding_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.environment_id IS DISTINCT FROM OLD.environment_id THEN
        RAISE EXCEPTION 'identity_binding.environment_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.issuer IS DISTINCT FROM OLD.issuer THEN
        RAISE EXCEPTION 'identity_binding.issuer is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.provider_subject IS DISTINCT FROM OLD.provider_subject THEN
        RAISE EXCEPTION 'identity_binding.provider_subject is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id THEN
        RAISE EXCEPTION 'identity_binding.account_subject_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'identity_binding.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER identity_binding_forbid_identity_mutation
    BEFORE UPDATE ON identity_binding
    FOR EACH ROW
    EXECUTE FUNCTION forbid_identity_binding_identity_mutation();

-- CBD-190 SS5.3: a binding is never remapped and never deleted as
-- compensation; it remains even for a terminal subject.
REVOKE DELETE ON identity_binding FROM cobudget_worker, cobudget_api;

-- scope: identity
CREATE TABLE identity_callback (
    challenge_id           uuid        NOT NULL DEFAULT gen_random_uuid(),

    environment_id          text        NOT NULL
                                        CHECK (char_length(environment_id) > 0),
    replay_digest            text        NOT NULL
                                        CHECK (char_length(replay_digest) > 0),

    processing_state         text        NOT NULL DEFAULT 'processing'
                                        CHECK (processing_state IN (
                                            'processing', 'handoff_ready', 'terminal'
                                        )),
    -- CBD-190 SS7: the closed public-outcome vocabulary. NULL until
    -- processing_state = 'terminal'.
    terminal_outcome          text        NULL
                                        CHECK (terminal_outcome IS NULL OR terminal_outcome IN (
                                            'verification_pending', 'cancelled', 'not_completed',
                                            'temporarily_unavailable', 'invalid_or_expired',
                                            'account_unavailable', 'callback_failure',
                                            'still_processing'
                                        )),
    CHECK (
        (processing_state = 'terminal' AND terminal_outcome IS NOT NULL)
        OR (processing_state <> 'terminal' AND terminal_outcome IS NULL)
    ),

    -- Populated once resolution succeeds; NULL for an unresolved or
    -- fail-closed-before-mapping challenge.
    identity_binding_id       uuid        NULL
                                        REFERENCES identity_binding (identity_binding_id)
                                        DEFERRABLE INITIALLY DEFERRED,
    account_subject_id        uuid        NULL
                                        REFERENCES account_subject (account_subject_id)
                                        DEFERRABLE INITIALLY DEFERRED,
    -- Foreign key to identity_session_handoff is added below by ALTER TABLE,
    -- once that table exists (the two tables reference each other).
    session_handoff_id         uuid        NULL,

    receipt_at                  timestamptz NOT NULL DEFAULT now(),
    commit_at                    timestamptz NULL,
    expires_at                   timestamptz NOT NULL,

    PRIMARY KEY (challenge_id),

    -- CBD-190 SS5.1: "replay digest unique within the environment".
    UNIQUE (environment_id, replay_digest)
);

COMMENT ON TABLE identity_callback IS
    'CBD-190 SS5.1: the one-time challenge/callback processing record. No raw token, code, state, nonce, contact attribute, or provider-error text is stored here -- only a keyed replay digest and opaque references.';

CREATE FUNCTION forbid_identity_callback_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.challenge_id IS DISTINCT FROM OLD.challenge_id THEN
        RAISE EXCEPTION 'challenge_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.environment_id IS DISTINCT FROM OLD.environment_id THEN
        RAISE EXCEPTION 'identity_callback.environment_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.replay_digest IS DISTINCT FROM OLD.replay_digest THEN
        RAISE EXCEPTION 'identity_callback.replay_digest is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.receipt_at IS DISTINCT FROM OLD.receipt_at THEN
        RAISE EXCEPTION 'identity_callback.receipt_at is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER identity_callback_forbid_identity_mutation
    BEFORE UPDATE ON identity_callback
    FOR EACH ROW
    EXECUTE FUNCTION forbid_identity_callback_identity_mutation();

REVOKE DELETE ON identity_callback FROM cobudget_worker, cobudget_api;

-- scope: identity
CREATE TABLE identity_session_handoff (
    session_handoff_id    uuid        NOT NULL DEFAULT gen_random_uuid(),

    -- CBD-190 SS5.1: "unique challenge_id". Foreign key to identity_callback
    -- is added below by ALTER TABLE, once identity_callback's own forward
    -- reference to this table is satisfiable.
    challenge_id             uuid        NOT NULL,

    account_subject_id        uuid        NOT NULL
                                         REFERENCES account_subject (account_subject_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    identity_binding_id        uuid        NOT NULL
                                         REFERENCES identity_binding (identity_binding_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    identity_event_id           uuid        NOT NULL,

    authenticated_at              timestamptz NOT NULL,
    assurance                      text        NOT NULL
                                             CHECK (char_length(assurance) > 0),
    ceremony                        text        NOT NULL
                                             CHECK (ceremony IN (
                                                 'register', 'verify', 'sign_in',
                                                 'enroll_factor', 'account_switch'
                                             )),
    previous_session_id             text        NULL,

    state                             text        NOT NULL DEFAULT 'prepared'
                                             CHECK (state IN ('prepared', 'consumed', 'terminal_failed')),
    attempt_count                     integer     NOT NULL DEFAULT 1
                                             CHECK (attempt_count >= 1),
    issued_session_reference           text        NULL,
    expires_at                          timestamptz NOT NULL,

    created_at                           timestamptz NOT NULL DEFAULT now(),
    updated_at                           timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (session_handoff_id),

    UNIQUE (challenge_id)
);

COMMENT ON TABLE identity_session_handoff IS
    'CBD-190 SS5.1, SS6: the purpose-specific, single-use hand-off record CBD-191 consumes by session_handoff_id. It is not a general queue or event bus.';

ALTER TABLE identity_callback
    ADD CONSTRAINT identity_callback_session_handoff_id_fkey
    FOREIGN KEY (session_handoff_id)
    REFERENCES identity_session_handoff (session_handoff_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE identity_session_handoff
    ADD CONSTRAINT identity_session_handoff_challenge_id_fkey
    FOREIGN KEY (challenge_id)
    REFERENCES identity_callback (challenge_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION forbid_identity_session_handoff_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.session_handoff_id IS DISTINCT FROM OLD.session_handoff_id THEN
        RAISE EXCEPTION 'session_handoff_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.challenge_id IS DISTINCT FROM OLD.challenge_id THEN
        RAISE EXCEPTION 'identity_session_handoff.challenge_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id THEN
        RAISE EXCEPTION 'identity_session_handoff.account_subject_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.identity_binding_id IS DISTINCT FROM OLD.identity_binding_id THEN
        RAISE EXCEPTION 'identity_session_handoff.identity_binding_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'identity_session_handoff.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER identity_session_handoff_forbid_identity_mutation
    BEFORE UPDATE ON identity_session_handoff
    FOR EACH ROW
    EXECUTE FUNCTION forbid_identity_session_handoff_identity_mutation();

REVOKE DELETE ON identity_session_handoff FROM cobudget_worker, cobudget_api;

-- CBD-212 SS3-SS4: the financial_profile row CBD-190 SS5.1 defers to "the
-- CBD-82/CBD-212 boundary". profile_state is closed to active/deleted --
-- CBD190-PROFILE-ATOMIC-001 removes the former absent/pending branch, so
-- every row this table ever holds is created already active.
-- scope: financial-profile
CREATE TABLE financial_profile (
    profile_id             uuid        NOT NULL DEFAULT gen_random_uuid(),

    account_subject_id       uuid        NOT NULL
                                        REFERENCES account_subject (account_subject_id)
                                        DEFERRABLE INITIALLY DEFERRED,

    profile_state             text        NOT NULL
                                        CHECK (profile_state IN ('active', 'deleted')),

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    version                       integer     NOT NULL DEFAULT 1
                                        CHECK (version >= 1),

    PRIMARY KEY (profile_id),

    -- CBD-212 SS4 FP-212-01: the unconditional (not partial) unique
    -- constraint is the at-most-one backstop. It is unconditional because
    -- this table never holds a second row for one subject in any lifecycle
    -- state, per FP-212-01's own reasoning (a partial index would still
    -- permit a second deleted row).
    CONSTRAINT financial_profile_account_subject_id_key UNIQUE (account_subject_id)
);

COMMENT ON TABLE financial_profile IS
    'CBD-212 SS3-SS4: exactly one row per account_subject, enforced together by the unconditional unique constraint and the deferred pair trigger below (FP-212-01-03). profile_id is never derived from account_subject_id, email, phone, display name, provider account number, or asserted legal identity (CBD-212-AC04).';

-- CBD-212 SS3: profile_id, account_subject_id, and created_at are write-once.
CREATE FUNCTION forbid_financial_profile_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'profile_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id THEN
        RAISE EXCEPTION 'financial_profile.account_subject_id is immutable (no profile transfer, CBD-212-AC06)'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'financial_profile.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER financial_profile_forbid_identity_mutation
    BEFORE UPDATE ON financial_profile
    FOR EACH ROW
    EXECUTE FUNCTION forbid_financial_profile_identity_mutation();

-- CBD-212 SS8 LC-212-06: physical purge is the one deliberate post-terminal
-- exception, and it is authorized application code, not an ordinary DELETE
-- grant. Revoked here; the migration role keeps DELETE for the reconciled,
-- authorized purge/backfill tooling CBD-212 SS8 describes.
REVOKE DELETE ON financial_profile FROM cobudget_worker, cobudget_api;

-- CBD190-PROFILE-ATOMIC-001; CBD-212 SS4 FP-212-02/03: the deferred
-- commit-time pair invariant. Both constraint triggers below call this one
-- function for the affected account_subject_id, so CBD-190 SS5.2 may insert
-- the subject and profile row in either statement order inside its single
-- SERIALIZABLE transaction; the pair is evaluated only against the
-- transaction's final state at commit (AFTER ROW CONSTRAINT TRIGGER,
-- DEFERRABLE INITIALLY DEFERRED). It never creates or repairs a row -- it
-- only aborts the whole transaction with a named integrity exception.
--
-- Enforced invariant, exactly CBD-212 SS4's three clauses:
--   * every non-terminal subject (active, disabled, deletion_pending,
--     security_blocked) has exactly one profile row, and it is active;
--   * an active profile belongs to a non-terminal subject; and
--   * physical purge is the one post-terminal exception: a terminal
--     (deleted) subject may hold zero profile rows (after an authorized
--     purge) or exactly one deleted row -- never an active row, and never
--     more than one row.
CREATE FUNCTION identity_subject_profile_invariant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_subject_id    uuid;
    v_lifecycle     text;
    v_profile_count integer;
    v_active_count  integer;
    v_deleted_count integer;
BEGIN
    v_subject_id := COALESCE(NEW.account_subject_id, OLD.account_subject_id);

    -- The subject row itself may have been the row that fired this trigger,
    -- in which case NEW already carries its post-transaction lifecycle_state;
    -- otherwise it is read back from the table.
    IF TG_TABLE_NAME = 'account_subject' THEN
        v_lifecycle := NEW.lifecycle_state;
    ELSE
        SELECT lifecycle_state INTO v_lifecycle
        FROM account_subject
        WHERE account_subject_id = v_subject_id;
    END IF;

    IF v_lifecycle IS NULL THEN
        -- No account_subject row exists for this identifier at commit. The
        -- ordinary foreign keys on financial_profile already forbid an
        -- orphaned profile; this branch exists only so the function never
        -- raises a confusing null-comparison error if it is ever reached.
        RETURN NULL;
    END IF;

    SELECT count(*) FILTER (WHERE profile_state = 'active'),
           count(*) FILTER (WHERE profile_state = 'deleted'),
           count(*)
        INTO v_active_count, v_deleted_count, v_profile_count
    FROM financial_profile
    WHERE account_subject_id = v_subject_id;

    IF v_lifecycle = 'deleted' THEN
        IF v_profile_count = 0 THEN
            RETURN NULL;
        END IF;
        IF v_profile_count = 1 AND v_deleted_count = 1 THEN
            RETURN NULL;
        END IF;
        RAISE EXCEPTION
            'CBD190-PROFILE-ATOMIC-001: terminal account_subject % must hold zero profile rows or exactly one deleted row at commit; found % row(s) (% active, % deleted)',
            v_subject_id, v_profile_count, v_active_count, v_deleted_count
            USING ERRCODE = '23514';
    END IF;

    IF v_profile_count = 1 AND v_active_count = 1 THEN
        RETURN NULL;
    END IF;

    RAISE EXCEPTION
        'CBD190-PROFILE-ATOMIC-001: account_subject % (lifecycle %) must hold exactly one active financial_profile row at commit; found % row(s) (% active, % deleted)',
        v_subject_id, v_lifecycle, v_profile_count, v_active_count, v_deleted_count
        USING ERRCODE = '23514';
END;
$$;

CREATE CONSTRAINT TRIGGER account_subject_profile_invariant
    AFTER INSERT OR UPDATE ON account_subject
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION identity_subject_profile_invariant();

CREATE CONSTRAINT TRIGGER financial_profile_subject_invariant
    AFTER INSERT OR UPDATE OR DELETE ON financial_profile
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION identity_subject_profile_invariant();
