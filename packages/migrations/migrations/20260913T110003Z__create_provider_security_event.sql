-- CBD-191 SS6.2 (SC-191-004). One canonical row per provider security event,
-- keyed by the provider's own (environment_id, issuer, provider_event_id)
-- identity so a duplicate delivery never creates a second row. No raw
-- provider token, credential, or contact attribute is stored here.
--
-- DEFERRED IDENTITY FK (packet CBD191-IMPL-001, 2026-09-13): identity_binding_id
-- is a plain identifier column with no foreign key, for the reason given in
-- 20260913T110001Z__create_account_session.sql.
--
-- scope: identity
CREATE TABLE provider_security_event (
    provider_security_event_id   uuid        NOT NULL DEFAULT gen_random_uuid(),

    environment_id                  text        NOT NULL
                                                CHECK (char_length(environment_id) > 0),
    issuer                            text        NOT NULL
                                                CHECK (char_length(issuer) > 0),
    provider_event_id                text        NOT NULL
                                                CHECK (char_length(provider_event_id) > 0),

    provider_subject                  text        NOT NULL
                                                CHECK (char_length(provider_subject) > 0),

    -- SS6.2 closed vocabulary.
    event_class                        text        NOT NULL
                                                CHECK (event_class IN (
                                                    'credential_changed',
                                                    'factor_changed',
                                                    'account_disabled',
                                                    'account_deleted',
                                                    'global_sign_out',
                                                    'compromised_credentials_action'
                                                )),

    provider_event_time               timestamptz NOT NULL,
    ordering_cursor                     text,
    received_at                         timestamptz NOT NULL DEFAULT now(),

    identity_binding_id                 uuid,

    -- SS3.1 closed vocabulary.
    processing_state                     text        NOT NULL
                                                CHECK (processing_state IN ('applied', 'applied_pending_reconciliation', 'superseded', 'rejected')),

    rejection_reason                      text        CHECK (
                                                (processing_state = 'rejected' AND rejection_reason IS NOT NULL)
                                                OR (processing_state <> 'rejected' AND rejection_reason IS NULL)
                                            ),

    created_at                             timestamptz NOT NULL DEFAULT now(),
    updated_at                             timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (provider_security_event_id),

    -- SS3.1: "Unique on (environment_id, issuer, provider_event_id)."
    UNIQUE (environment_id, issuer, provider_event_id)
);

COMMENT ON TABLE provider_security_event IS
    'CBD-191 SS6.2: the dedupe/ordering/quarantine record for one authenticated provider security event. A duplicate provider_event_id returns the existing row rather than creating a second one.';

CREATE INDEX provider_security_event_binding_idx ON provider_security_event (identity_binding_id) WHERE identity_binding_id IS NOT NULL;

CREATE FUNCTION provider_security_event_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER provider_security_event_set_updated_at
    BEFORE UPDATE ON provider_security_event
    FOR EACH ROW
    EXECUTE FUNCTION provider_security_event_touch_updated_at();

-- SS6.2 step 6: only a canonical row's processing_state may move from
-- applied_pending_reconciliation to applied on successful reconciliation
-- ("correction of metadata can never undo the bump"); every other field the
-- provider identified the event by is immutable once inserted.
CREATE FUNCTION forbid_provider_security_event_identity_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.environment_id <> OLD.environment_id
        OR NEW.issuer <> OLD.issuer
        OR NEW.provider_event_id <> OLD.provider_event_id
        OR NEW.provider_subject <> OLD.provider_subject
        OR NEW.event_class <> OLD.event_class
        OR NEW.provider_event_time <> OLD.provider_event_time
        OR NEW.received_at <> OLD.received_at
    THEN
        RAISE EXCEPTION 'provider_security_event identity fields are immutable once inserted'
            USING ERRCODE = '23514';
    END IF;
    -- CBD191-CORRECTION-001 item 6 (atomic provider dedupe/order): besides
    -- applied_pending_reconciliation -> applied, one more transition is
    -- legitimate -- applied -> superseded. The canonical event row is
    -- inserted with a best-effort decision (SS6.2 step 6) before the
    -- accompanying account_subject_authority compare-and-swap is attempted;
    -- if a concurrently-processed higher cursor wins that compare-and-swap
    -- first, this row's already-recorded "applied" decision is corrected to
    -- "superseded" rather than left to misstate an effect that never
    -- actually reached the authority row. No other transition is permitted.
    IF NEW.processing_state <> OLD.processing_state
        AND NOT (OLD.processing_state = 'applied_pending_reconciliation' AND NEW.processing_state = 'applied')
        AND NOT (OLD.processing_state = 'applied' AND NEW.processing_state = 'superseded')
    THEN
        RAISE EXCEPTION 'processing_state may only move applied_pending_reconciliation -> applied or applied -> superseded'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER provider_security_event_forbid_identity_update
    BEFORE UPDATE ON provider_security_event
    FOR EACH ROW
    EXECUTE FUNCTION forbid_provider_security_event_identity_update();

REVOKE DELETE ON provider_security_event FROM cobudget_worker, cobudget_api;
