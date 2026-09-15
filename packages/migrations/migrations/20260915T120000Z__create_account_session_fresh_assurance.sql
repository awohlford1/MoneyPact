-- PK-4 fresh-assurance step-up (CBD-234 design section 10.4; CBD-236 section
-- 5.3's `fresh_assurance` obligation and section 8.2's protected-cell rule;
-- CBD-190 ceremony vocabulary; CBD-191 section 5.1 fresh assurance).
--
-- Two forward-only changes, both identity scope:
--
--   1. `identity_session_handoff.ceremony` gains `step_up`. CBD-190 section
--      5.1 fixes the ceremony vocabulary in this column, so widening the
--      vocabulary is this CHECK constraint plus the CBD-190 amendment row
--      that proposes it (docs/cbd-190-identity-ceremony-and-mapping-contract.md).
--      A `step_up` ceremony issues no session and maps no subject, so it
--      prepares no hand-off row in this increment -- the vocabulary is
--      widened here because the column is where the vocabulary lives, not
--      because this increment writes `step_up` into it. Widening a CHECK is
--      not a contract step: every value that was legal before is still
--      legal, and no reader loses a column or a table.
--
--   2. `account_session_fresh_assurance`: the per-session, write-once,
--      consumed-once grant a completed step-up produces. `account_session`
--      already carries `assurance_level` and three `fresh_assurance_*`
--      columns (20260913T110001Z), but those are mutable row state on a
--      long-lived session: nothing there records who issued the grant, and
--      nothing there can be consumed exactly once. The grant is therefore
--      its own row, bound at issue time to one action code and one budget
--      space, with an issue and expiry instant and a single-use consumption
--      mark. Those four session columns are left exactly as they are; this
--      table does not complete an expand of them and removes nothing.
--
-- Revocation: a grant is scoped to one session row by `session_ref`, which
-- is `account_session`'s own unique key, so a revoked, rotated or expired
-- session takes its grants with it -- the reader joins the session row and
-- requires it live, and no separate revocation sweep exists to fall behind
-- (CBD-191 section 6.1).
--
-- scope: identity
ALTER TABLE identity_session_handoff
    DROP CONSTRAINT identity_session_handoff_ceremony_check;

ALTER TABLE identity_session_handoff
    ADD CONSTRAINT identity_session_handoff_ceremony_check
    CHECK (ceremony IN (
        'register', 'verify', 'sign_in',
        'enroll_factor', 'account_switch', 'step_up'
    ));

-- scope: identity
CREATE TABLE account_session_fresh_assurance (
    fresh_assurance_id           uuid        NOT NULL DEFAULT gen_random_uuid(),

    -- The session the grant belongs to. `account_session.session_ref` is
    -- unique, and a grant without its session is meaningless, so the
    -- reference is real rather than a loose identifier column.
    session_ref                   text        NOT NULL
                                             REFERENCES account_session (session_ref)
                                             DEFERRABLE INITIALLY DEFERRED,
    account_subject_id            uuid        NOT NULL,
    environment_id                 text        NOT NULL
                                             CHECK (char_length(environment_id) > 0),

    -- The step-up ceremony that produced this grant. Unique: one completed
    -- ceremony can never produce a second grant, which is the write-once
    -- half of the record (the replayed callback finds the row already there).
    challenge_id                   uuid        NOT NULL,

    -- CBD-190 section 5.1 vocabulary; only a step-up ever issues a grant.
    ceremony                        text        NOT NULL DEFAULT 'step_up'
                                             CHECK (ceremony = 'step_up'),

    -- The binding `decide` re-proves (evaluate.ts: assurance.boundAction and
    -- assurance.boundSpaceId must equal the request's action and acting
    -- space, and assurance.expiresAt must be after evaluation.evaluatedAt).
    bound_action                   text        NOT NULL
                                             CHECK (char_length(bound_action) > 0),
    bound_space_id                 uuid        NOT NULL,

    issued_at                       timestamptz NOT NULL DEFAULT now(),
    expires_at                      timestamptz NOT NULL,

    -- Consumed exactly once, by the protected allow that used it.
    --
    -- The state is a closed text value rather than "consumed_at IS NULL"
    -- because @cobudget/data-access's platform statement API composes every
    -- condition as `column <operator> $n` and has no IS NULL predicate: a
    -- condition on a nullable column would silently never match. The
    -- consumption instant and the consuming action are still recorded, as
    -- evidence; nothing ever conditions on them.
    state                            text        NOT NULL DEFAULT 'issued'
                                             CHECK (state IN ('issued', 'consumed')),
    consumed_at                     timestamptz,
    consumed_by_action             text,

    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (fresh_assurance_id),

    UNIQUE (challenge_id),

    CONSTRAINT account_session_fresh_assurance_window CHECK (expires_at > issued_at),

    CONSTRAINT account_session_fresh_assurance_consumption_fields_together CHECK (
        (state = 'issued' AND consumed_at IS NULL AND consumed_by_action IS NULL)
        OR (state = 'consumed' AND consumed_at IS NOT NULL AND consumed_by_action IS NOT NULL)
    )
);

COMMENT ON TABLE account_session_fresh_assurance IS
    'CBD-234 section 10.4 / CBD-236 section 5.3: the write-once, consumed-once fresh-assurance grant a completed step_up ceremony binds to one session, one action code and one budget space.';

-- A session may hold at most one unconsumed grant for a given action and
-- space at a time: a second step-up for the same pair replaces nothing and
-- is refused, so grants cannot be stacked up and spent later.
CREATE UNIQUE INDEX account_session_fresh_assurance_live_idx
    ON account_session_fresh_assurance (session_ref, bound_action, bound_space_id)
    WHERE state = 'issued';

CREATE INDEX account_session_fresh_assurance_session_idx
    ON account_session_fresh_assurance (session_ref);

CREATE FUNCTION account_session_fresh_assurance_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_session_fresh_assurance_set_updated_at
    BEFORE UPDATE ON account_session_fresh_assurance
    FOR EACH ROW
    EXECUTE FUNCTION account_session_fresh_assurance_touch_updated_at();

-- Write-once: every column except the consumption mark and updated_at is
-- immutable once the row exists, so a grant can never be re-pointed at
-- another action, another space, another session or a later expiry after
-- the fact. Consumed-once: a consumption mark, once set, is itself
-- immutable, so no path un-consumes a spent grant. The application's
-- conditional UPDATE already refuses a second consumption; this makes it a
-- database guarantee rather than application discipline, which is what the
-- live proof asserts.
CREATE FUNCTION forbid_account_session_fresh_assurance_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.fresh_assurance_id IS DISTINCT FROM OLD.fresh_assurance_id
        OR NEW.session_ref IS DISTINCT FROM OLD.session_ref
        OR NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id
        OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
        OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
        OR NEW.ceremony IS DISTINCT FROM OLD.ceremony
        OR NEW.bound_action IS DISTINCT FROM OLD.bound_action
        OR NEW.bound_space_id IS DISTINCT FROM OLD.bound_space_id
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'account_session_fresh_assurance is write-once; only the consumption mark may be set'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'consumed'
        AND (NEW.state IS DISTINCT FROM OLD.state
             OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
             OR NEW.consumed_by_action IS DISTINCT FROM OLD.consumed_by_action)
    THEN
        RAISE EXCEPTION 'account_session_fresh_assurance is consumed once; a consumption mark is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_session_fresh_assurance_forbid_rewrite
    BEFORE UPDATE ON account_session_fresh_assurance
    FOR EACH ROW
    EXECUTE FUNCTION forbid_account_session_fresh_assurance_rewrite();

-- Least privilege, exactly as 20260913T110005Z set it for the other session
-- tables: the API issues, reads and consumes grants; the worker has no
-- business seeing an assurance grant at all; nobody deletes one.
REVOKE ALL ON account_session_fresh_assurance FROM cobudget_worker, cobudget_api;
GRANT SELECT, INSERT, UPDATE ON account_session_fresh_assurance TO cobudget_api;
