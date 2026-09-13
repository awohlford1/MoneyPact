-- CBD-191 SS3.1-SS3.3, SS4, SS5. The opaque, server-resolved session record.
-- `session_selector` is the indexed lookup key; `verifier_digest` is a
-- keyed (peppered) constant-time-compared digest of the verifier half --
-- the pepper lives outside this database (SC-191-001), so this table alone
-- never discloses whether a guessed verifier would succeed.
--
-- DEFERRED IDENTITY FK (packet CBD191-IMPL-001, 2026-09-13): account_subject_id
-- and identity_binding_id are plain identifier columns with no foreign key
-- for the same reason given in
-- 20260913T110000Z__create_account_subject_authority.sql -- CBD-190/212's
-- identity schema does not exist yet. A follow-up migration
-- (create_account_subject_identity_foreign_keys) must add both references
-- once it lands.
--
-- scope: identity
CREATE TABLE account_session (
    session_id                    uuid        NOT NULL DEFAULT gen_random_uuid(),

    session_selector                text        NOT NULL
                                                CHECK (char_length(session_selector) > 0),
    verifier_digest                  text        NOT NULL
                                                CHECK (char_length(verifier_digest) > 0),
    session_ref                       text        NOT NULL
                                                CHECK (char_length(session_ref) > 0),

    account_subject_id               uuid        NOT NULL,
    environment_id                    text        NOT NULL
                                                CHECK (char_length(environment_id) > 0),
    identity_binding_id               uuid,

    session_version                    bigint      NOT NULL
                                                CHECK (session_version > 0),
    issued_revocation_epoch           integer     NOT NULL
                                                CHECK (issued_revocation_epoch > 0),

    -- SS3.1 closed vocabulary.
    state                               text        NOT NULL
                                                CHECK (state IN ('active', 'rotated', 'revoked', 'expired')),
    superseded_by_session_ref          text
                                                CHECK (
                                                    (state = 'rotated' AND superseded_by_session_ref IS NOT NULL)
                                                    OR (state <> 'rotated' AND superseded_by_session_ref IS NULL)
                                                ),

    assurance_level                     text        NOT NULL DEFAULT 'session'
                                                CHECK (assurance_level IN ('session', 'fresh')),
    fresh_assurance_bound_action       text,
    fresh_assurance_bound_space_id    uuid,
    fresh_assurance_expires_at        timestamptz,

    csrf_digest                         text        NOT NULL
                                                CHECK (char_length(csrf_digest) > 0),

    issued_at                           timestamptz NOT NULL DEFAULT now(),
    idle_expires_at                     timestamptz NOT NULL,
    absolute_expires_at                 timestamptz NOT NULL,

    -- SS5.2 closed vocabulary. `authentication` and `account_switch` are the
    -- only causes representable from a CBD-190 v0.3 command; `recovery`
    -- and the bound-context branch of `authentication` remain named here
    -- because a future additive CBD-190 revision uses them (SS5.2, SS5.3).
    rotation_cause                      text        NOT NULL
                                                CHECK (rotation_cause IN ('authentication', 'recovery', 'assurance_elevation', 'account_switch')),

    -- SS6.1 closed vocabulary; present only once revoked.
    revocation_cause                    text        CHECK (
                                                revocation_cause IS NULL OR revocation_cause IN (
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
                                                    'provider_compromised_credentials_action',
                                                    'orphaned_delivery_result_expiry'
                                                )
                                            ),

    created_at                           timestamptz NOT NULL DEFAULT now(),
    updated_at                           timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (session_id),

    -- SS3.1: "Unique on session_selector, session_ref, and
    -- (account_subject_id, session_version)."
    UNIQUE (session_selector),
    UNIQUE (session_ref),
    UNIQUE (account_subject_id, session_version),

    CONSTRAINT account_session_fresh_assurance_fields_together CHECK (
        (assurance_level = 'fresh' AND fresh_assurance_expires_at IS NOT NULL)
        OR (assurance_level = 'session' AND fresh_assurance_bound_action IS NULL
            AND fresh_assurance_bound_space_id IS NULL AND fresh_assurance_expires_at IS NULL)
    ),

    CONSTRAINT account_session_revocation_cause_present_when_revoked CHECK (
        (state = 'revoked' AND revocation_cause IS NOT NULL)
        OR (state <> 'revoked' AND revocation_cause IS NULL)
    ),

    CONSTRAINT account_session_expiry_order CHECK (idle_expires_at <= absolute_expires_at)
);

COMMENT ON TABLE account_session IS
    'CBD-191 SS3.1: the opaque, server-resolved session record. session_selector/verifier_digest/session_ref are never logged or cached outside this store (SS3.1).';

CREATE INDEX account_session_subject_idx ON account_session (account_subject_id);
CREATE INDEX account_session_superseded_idx ON account_session (superseded_by_session_ref) WHERE superseded_by_session_ref IS NOT NULL;

CREATE FUNCTION account_session_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_session_set_updated_at
    BEFORE UPDATE ON account_session
    FOR EACH ROW
    EXECUTE FUNCTION account_session_touch_updated_at();

-- SS3.1/SS5.2: session_selector, verifier_digest, session_ref, environment_id,
-- account_subject_id, session_version, issued_revocation_epoch, issued_at,
-- and rotation_cause are immutable once a row is inserted -- only state,
-- superseded_by_session_ref, assurance/fresh-assurance fields,
-- idle_expires_at, revocation_cause, and updated_at ever change in place.
-- CBD191-REVIEW-IMPL-001 Medium finding: identity_binding_id was omitted
-- from this guard, so a row's revocation-correlation identity could be
-- silently changed after insertion. It is nullable, so the comparison uses
-- IS DISTINCT FROM rather than <>, which would never fire for two NULLs or
-- a NULL-to-value change.
CREATE FUNCTION forbid_account_session_identity_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.session_selector <> OLD.session_selector
        OR NEW.verifier_digest <> OLD.verifier_digest
        OR NEW.session_ref <> OLD.session_ref
        OR NEW.environment_id <> OLD.environment_id
        OR NEW.account_subject_id <> OLD.account_subject_id
        OR NEW.identity_binding_id IS DISTINCT FROM OLD.identity_binding_id
        OR NEW.session_version <> OLD.session_version
        OR NEW.issued_revocation_epoch <> OLD.issued_revocation_epoch
        OR NEW.issued_at <> OLD.issued_at
        OR NEW.rotation_cause <> OLD.rotation_cause
    THEN
        RAISE EXCEPTION 'account_session identity, version, and issuance fields are immutable once inserted'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_session_forbid_identity_update
    BEFORE UPDATE ON account_session
    FOR EACH ROW
    EXECUTE FUNCTION forbid_account_session_identity_update();

-- CBD191-REVIEW-IMPL-001 Medium finding: nothing stopped a row from moving
-- back to 'active' after being revoked, rotated, or (administratively)
-- marked expired. §3.3 case 5 already treats any non-active state as
-- terminal for resolution purposes; this trigger makes that a database
-- guarantee too, independent of application discipline.
CREATE FUNCTION forbid_account_session_reactivation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.state IN ('revoked', 'rotated', 'expired') AND NEW.state <> OLD.state THEN
        RAISE EXCEPTION 'account_session.state is terminal once revoked, rotated, or expired' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_session_forbid_reactivation
    BEFORE UPDATE ON account_session
    FOR EACH ROW
    EXECUTE FUNCTION forbid_account_session_reactivation();

REVOKE DELETE ON account_session FROM cobudget_worker, cobudget_api;
