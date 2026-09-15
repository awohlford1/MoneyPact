-- PROTO-CBD200-CONCURRENCY-IDEMPOTENCY-001 (CBD-200-AC04, CBD-200-AC05;
-- QA-F02, QA-F03 of PROTO-QA-CBD200-211-001): the manual-transaction
-- idempotency scope, and a constraint name on the one-current-version
-- refusal so a caller can map it.
--
-- (1) manual_transaction_idempotency, modelled on budget_creation_idempotency
-- (20260913T090400Z). One row per (budget space, acting membership, action,
-- Idempotency-Key), written in the same transaction as the version it
-- records, carrying the digest of the request that produced it and the
-- response the route returned. A replay with the same key and the same
-- digest is answered from committed_response and writes nothing; the same
-- key with a different digest is refused. The row references the version it
-- committed, so a response can never outlive the version it describes, and
-- the reference is deferred because the version is inserted in the same
-- transaction. Append-only like its model: no UPDATE, no DELETE by the
-- runtime roles.
--
-- (2) assert_manual_transaction_one_current (20260914T190000Z) raised
-- SQLSTATE 23514 with no constraint name, which is indistinguishable at a
-- caller from the exact-sum trigger's 23514 once the driver detail is
-- stripped (packages/data-access wraps every driver error and keeps only the
-- SQLSTATE and, from this change, the constraint identifier). The function
-- is replaced in place -- same name, same signature, same trigger, same
-- SQLSTATE -- adding CONSTRAINT = 'manual_transaction_assert_one_current' so
-- the API's transaction store can answer 409 conflict for exactly this
-- refusal and nothing else. CREATE OR REPLACE FUNCTION is additive: no
-- table, column, index or constraint is dropped or renamed, and the trigger
-- binding is untouched, so this is not a contract step.
--
-- scope: budget-space
CREATE TABLE manual_transaction_idempotency (
    idempotency_id           uuid        NOT NULL DEFAULT gen_random_uuid(),

    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    membership_id            uuid        NOT NULL,
    action                   text        NOT NULL
                                         CHECK (action IN ('create', 'edit', 'remove')),
    idempotency_key          text        NOT NULL
                                         CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),

    request_digest           text        NOT NULL
                                         CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    transaction_version_id   uuid        NOT NULL,
    committed_response       jsonb       NOT NULL,

    created_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (idempotency_id),

    -- The acting membership must belong to this budget (tenant coherence).
    FOREIGN KEY (budget_space_id, membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- The response describes a version of this budget, inserted in the same
    -- transaction, hence deferred.
    FOREIGN KEY (budget_space_id, transaction_version_id)
        REFERENCES manual_transaction (budget_space_id, transaction_version_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- The idempotency scope: one committed response per key, per action, per
    -- acting membership, per budget (CBD-200-AC05).
    UNIQUE (budget_space_id, membership_id, action, idempotency_key)
);

COMMENT ON TABLE manual_transaction_idempotency IS
    'CBD-200-AC05: the manual-transaction idempotency scope (budget space, acting membership, action, Idempotency-Key) and the response it committed, inserted once in the same transaction as the version it records.';

COMMENT ON COLUMN manual_transaction_idempotency.request_digest IS
    'SHA-256 over the canonical form of the parsed request (action, target, body). A replay with this digest is answered from committed_response; a different digest under the same key is refused idempotency_mismatch.';

CREATE FUNCTION forbid_manual_transaction_idempotency_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'manual_transaction_idempotency rows are append-only and never updated'
        USING ERRCODE = '23514', CONSTRAINT = 'manual_transaction_idempotency_append_only';
END;
$$;

CREATE TRIGGER manual_transaction_idempotency_forbid_update
    BEFORE UPDATE ON manual_transaction_idempotency
    FOR EACH ROW
    EXECUTE FUNCTION forbid_manual_transaction_idempotency_update();

REVOKE DELETE ON manual_transaction_idempotency FROM cobudget_worker, cobudget_api;

-- (2) The same refusal, now carrying its constraint name.
CREATE OR REPLACE FUNCTION assert_manual_transaction_one_current() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_current integer;
BEGIN
    SELECT count(*) INTO v_current
    FROM manual_transaction t
    WHERE t.budget_space_id = NEW.budget_space_id
      AND t.transaction_id = NEW.transaction_id
      AND t.superseded_at IS NULL;

    IF v_current <> 1 THEN
        RAISE EXCEPTION
            'manual transaction % must have exactly one current version at commit; found % (F-REV-001, F-REV-002)',
            NEW.transaction_id, v_current
            USING ERRCODE = '23514', CONSTRAINT = 'manual_transaction_assert_one_current';
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION assert_manual_transaction_one_current() IS
    'CBD-200: at commit every manual_transaction identity that was superseded in this transaction still has exactly one current version. A supersession stamp with no accompanying insert rolls back with 23514, constraint manual_transaction_assert_one_current (CBD-200-AC04 conflict mapping).';
