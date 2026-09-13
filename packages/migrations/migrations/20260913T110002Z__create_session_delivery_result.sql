-- CBD-191 SS3.1, SS5.3. The one sealed, temporary exception to "raw cookie
-- material is not durable": `sealed_envelope` is an authenticated-encryption
-- envelope over the exact selector/verifier and CSRF delivery values, keyed
-- outside this database, audience-bound to one session_handoff_id, and
-- erased on acknowledgement or bounded expiry (SS3.1, SS5.3). This table is
-- categorically excluded from analytics replicas, backups, dumps, support
-- tooling, logs, telemetry, queues, and exports -- an operational and
-- infrastructure obligation this migration cannot itself enforce, recorded
-- here as the schema-side half of that requirement.
--
-- scope: identity
CREATE TABLE session_delivery_result (
    session_handoff_id   uuid        NOT NULL,

    session_ref            text        NOT NULL
                                       CHECK (char_length(session_ref) > 0),

    sealed_envelope          bytea       NOT NULL,
    envelope_key_version     text        NOT NULL
                                       CHECK (char_length(envelope_key_version) > 0),

    deliver_until             timestamptz NOT NULL,
    acknowledged_at           timestamptz,

    created_at                 timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (session_handoff_id),

    -- SS5.3: consumption is keyed by session_handoff_id and stores the sealed
    -- result in the same transaction; each handoff produces at most one
    -- delivery result and it names exactly one session.
    UNIQUE (session_ref)
);

COMMENT ON TABLE session_delivery_result IS
    'CBD-191 SS3.1/SS5.3: the recoverable prior issuance result CBD-190 v0.3 SS6 requires after a commit/result-loss fault. Erased on acknowledgement or expiry; never restored past expiry.';

REVOKE DELETE ON session_delivery_result FROM cobudget_worker, cobudget_api;

-- SS5.3: session_handoff_id, session_ref, envelope_key_version, and
-- deliver_until are immutable once inserted. acknowledged_at may only move
-- once, from NULL to a timestamp. `sealed_envelope` is immutable except for
-- exactly that same transition, where it may only be *erased* (zeroed),
-- never replaced with different non-empty ciphertext -- this is what makes
-- "erased on acknowledgement" (SS3.1/SS5.3) an update rather than requiring
-- a delete, while still forbidding any other envelope mutation.
CREATE FUNCTION forbid_session_delivery_result_envelope_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.session_ref <> OLD.session_ref
        OR NEW.envelope_key_version <> OLD.envelope_key_version
        OR NEW.deliver_until <> OLD.deliver_until
        OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at)
    THEN
        RAISE EXCEPTION 'session_delivery_result envelope fields are immutable and acknowledged_at can only be set once'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.sealed_envelope <> OLD.sealed_envelope THEN
        IF NOT (OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL AND octet_length(NEW.sealed_envelope) = 0) THEN
            RAISE EXCEPTION 'sealed_envelope may only be erased (zeroed) at the moment acknowledged_at is first set'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER session_delivery_result_forbid_envelope_update
    BEFORE UPDATE ON session_delivery_result
    FOR EACH ROW
    EXECUTE FUNCTION forbid_session_delivery_result_envelope_update();
