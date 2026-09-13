-- CBD-231 SS3.4, SS5 (DB-231-008, DB-231-009). The creation operation,
-- confirmation-idempotency, audit, and terminal success records CBD-233 SS4
-- writes in the same transaction as the budget graph. Every uniqueness
-- constraint this file adds is what makes a duplicate outcome for the same
-- proposal, idempotency key, or budget impossible -- see the column comments
-- for which catalog guard each one is.
--
-- DEFERRED IDENTITY FK (Manager ruling, CBD231-IMPL-001, 2026-09-13):
-- account_subject_id and profile_id are plain identifier columns with no
-- foreign key, for the same reason given in
-- 20260913T090000Z__create_budget_space.sql and
-- 20260913T090100Z__create_budget_space_membership.sql: CBD-212's identity
-- schema does not exist yet. The same named follow-up migration
-- (create_budget_space_identity_foreign_keys) must add these once CBD-212
-- lands.
--
-- scope: budget-space
CREATE TABLE budget_creation_operation (
    operation_id      uuid        NOT NULL DEFAULT gen_random_uuid(),
    proposal_id        uuid        NOT NULL,

    budget_space_id     uuid        NOT NULL
                                    REFERENCES budget_space (budget_space_id)
                                    DEFERRABLE INITIALLY DEFERRED,

    environment          text        NOT NULL,
    account_subject_id  uuid        NOT NULL,
    profile_id           uuid        NOT NULL,
    proposal_version    text        NOT NULL,
    proposal_digest      text        NOT NULL,
    binding_version      text        NOT NULL,

    status                text        NOT NULL
                                    CHECK (status = 'succeeded'),

    created_at            timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (operation_id),

    -- DB-231-008: "unique proposal consumption" -- a proposal can be
    -- consumed by at most one creation operation (BSL-231-008).
    UNIQUE (proposal_id),
    -- DB-231-008: "operation-to-budget unique" -- at most one operation per
    -- candidate budget.
    UNIQUE (budget_space_id),
    -- Composite unique target for budget_creation_success's deferred
    -- (operation_id, budget_space_id) foreign key (BSL-231-010): binding
    -- both columns together, rather than trusting two independent foreign
    -- keys, is what makes it impossible for a success row to bind an
    -- operation from one budget to a different budget. UNIQUE(operation_id)
    -- above already makes this composite unique on its own, but it is
    -- declared explicitly because it is the referenced side of that
    -- composite foreign key.
    UNIQUE (operation_id, budget_space_id)
);

COMMENT ON TABLE budget_creation_operation IS
    'CBD-231 SS3.4: one row per consumed proposal, inserted only on a successful commit. Failed pre-commit attempts leave no row here (BSL-231-009).';

CREATE FUNCTION forbid_budget_creation_operation_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'budget_creation_operation rows are append-only and never updated'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER budget_creation_operation_forbid_update
    BEFORE UPDATE ON budget_creation_operation
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_creation_operation_update();

REVOKE DELETE ON budget_creation_operation FROM cobudget_worker, cobudget_api;

-- scope: budget-space
CREATE TABLE budget_creation_idempotency (
    idempotency_id                  uuid        NOT NULL DEFAULT gen_random_uuid(),

    environment                      text        NOT NULL,
    account_subject_id              uuid        NOT NULL,
    confirmation_idempotency_key    text        NOT NULL
                                                CHECK (char_length(confirmation_idempotency_key) > 0),

    request_digest                   text        NOT NULL,
    committed_response               jsonb       NOT NULL,

    operation_id                     uuid        NOT NULL
                                                REFERENCES budget_creation_operation (operation_id)
                                                DEFERRABLE INITIALLY DEFERRED,
    budget_space_id                   uuid        NOT NULL
                                                REFERENCES budget_space (budget_space_id)
                                                DEFERRABLE INITIALLY DEFERRED,

    created_at                        timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (idempotency_id),

    -- DB-231-008: "idempotency scope" -- (environment, account_subject_id,
    -- confirmation_idempotency_key) owns at most one committed response
    -- (BSL-231-008, CBD-233 SS4 step 1).
    UNIQUE (environment, account_subject_id, confirmation_idempotency_key)
);

COMMENT ON TABLE budget_creation_idempotency IS
    'CBD-231 SS3.4: the confirmation-idempotency scope and its stored committed response, inserted once in the same transaction as the success it records.';

CREATE FUNCTION forbid_budget_creation_idempotency_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'budget_creation_idempotency rows are append-only and never updated'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER budget_creation_idempotency_forbid_update
    BEFORE UPDATE ON budget_creation_idempotency
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_creation_idempotency_update();

REVOKE DELETE ON budget_creation_idempotency FROM cobudget_worker, cobudget_api;

-- scope: budget-space
CREATE TABLE budget_creation_audit (
    audit_id          uuid        NOT NULL DEFAULT gen_random_uuid(),

    operation_id       uuid        NOT NULL
                                   REFERENCES budget_creation_operation (operation_id)
                                   DEFERRABLE INITIALLY DEFERRED,
    budget_space_id      uuid        NOT NULL
                                   REFERENCES budget_space (budget_space_id)
                                   DEFERRABLE INITIALLY DEFERRED,

    event_type          text        NOT NULL
                                   CHECK (event_type = 'budget.created'),
    payload              jsonb       NOT NULL,
    occurred_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (audit_id),

    -- DB-231-008: "audit-to-operation unique" -- exactly one budget.created
    -- success record per operation (BSL-231-008, CBD-231 SS3.4). The
    -- separate CBD-236 denial-attempt audit is not this table.
    UNIQUE (operation_id)
);

COMMENT ON TABLE budget_creation_audit IS
    'CBD-231 SS3.4: exactly one budget.created success audit record per operation, inserted in the same transaction as the success it records.';

CREATE FUNCTION forbid_budget_creation_audit_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'budget_creation_audit rows are append-only and never updated'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER budget_creation_audit_forbid_update
    BEFORE UPDATE ON budget_creation_audit
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_creation_audit_update();

REVOKE DELETE ON budget_creation_audit FROM cobudget_worker, cobudget_api;

-- scope: budget-space
CREATE TABLE budget_creation_success (
    success_id         uuid        NOT NULL DEFAULT gen_random_uuid(),

    operation_id        uuid        NOT NULL,
    budget_space_id       uuid        NOT NULL,

    response_payload     jsonb       NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (success_id),

    -- DB-231-008: "success-to-operation" and "success-to-budget" unique --
    -- at most one terminal success per operation and per budget
    -- (BSL-231-008).
    UNIQUE (operation_id),
    UNIQUE (budget_space_id),

    -- BSL-231-010 tenant coherence: a single composite foreign key, not two
    -- independent ones, so a success row cannot bind the operation from one
    -- budget to a different budget_space_id. Two independent foreign keys
    -- (each individually satisfiable) would let a success row name
    -- (operation A, budget B) whenever operation A really belongs to budget
    -- A and budget B is separately valid; this composite reference to
    -- budget_creation_operation's own (operation_id, budget_space_id)
    -- forces the pair to agree with the operation that actually produced
    -- it. It also transitively guarantees budget_space_id names a real
    -- budget_space row, since budget_creation_operation.budget_space_id
    -- already carries that foreign key.
    FOREIGN KEY (operation_id, budget_space_id)
        REFERENCES budget_creation_operation (operation_id, budget_space_id)
        DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE budget_creation_success IS
    'CBD-231 SS3.4: the one terminal success per operation and budget, owning the authoritative response payload; inserted last before deferred checks and commit.';

CREATE FUNCTION forbid_budget_creation_success_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'budget_creation_success rows are append-only and never updated'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER budget_creation_success_forbid_update
    BEFORE UPDATE ON budget_creation_success
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_creation_success_update();

REVOKE DELETE ON budget_creation_success FROM cobudget_worker, cobudget_api;
