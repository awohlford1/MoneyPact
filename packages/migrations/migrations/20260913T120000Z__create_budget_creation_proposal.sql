-- CBD233-PERSISTENCE-001: subject-owned, non-authoritative proposal locator.
-- The account subject foreign key lands with the CBD-190 identity schema.
-- Payload retains the server-owned CBD-232 record; confirmation never takes
-- authoritative inputs from the caller. Candidate identity survives retries.
-- scope: identity
CREATE TABLE budget_creation_proposal (
    proposal_id uuid NOT NULL,
    account_subject_id uuid NOT NULL,
    environment text NOT NULL,
    proposal_version text NOT NULL,
    proposal_digest text NOT NULL,
    proposal_state text NOT NULL CHECK (proposal_state IN ('previewed', 'invalidated', 'expired', 'confirmed')),
    candidate_budget_space_id uuid NOT NULL,
    binding_digest text NOT NULL,
    proposal_payload jsonb NOT NULL,
    proposal_idempotency jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    lifecycle_revision integer NOT NULL DEFAULT 1 CHECK (lifecycle_revision > 0),
    PRIMARY KEY (proposal_id)
);

CREATE INDEX budget_creation_proposal_subject
    ON budget_creation_proposal (environment, account_subject_id);

COMMENT ON TABLE budget_creation_proposal IS
    'CBD-232 durable pre-budget proposal; CBD-233 subject-predicated locator. No budget access is conferred by this row.';
