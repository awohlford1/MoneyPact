-- CBD-73 invitations, acceptance and Primary transfer, migration M2 of 3
-- (INVITATIONS-DESIGN-001, approved 2026-09-15;
-- docs/cbd-234-invitations-consent-design-proposal.md SS4, SS5.3 and SS13).
--
-- The physical records of CBD-73 SS13: DR-73-01 the invitation, DR-73-02 the
-- code verifier and its custody, DR-73-03 the ceremony binding, DR-73-13 the
-- intended-recipient confirmation, and the audit and security-event records
-- of SS13. No application code reads or writes them yet: the statement
-- modules and the state service are PK-5, and the routes are PK-6.
--
-- THIS MIGRATION WRITES, ALTERS AND SYNTHESIZES NO ROW, and it alters nothing
-- that already exists. Every table here is new.
--
-- Three rules repeat on every table below, each for the same reason they
-- exist on budget_space_membership and budget_space_consent:
--
--   * Identity columns are write-once, enforced by a BEFORE UPDATE trigger in
--     the shape of forbid_budget_space_membership_identity_mutation
--     (20260913T090100Z). A PRIMARY KEY does not stop an UPDATE from changing
--     the key, and provenance that can be rewritten is not evidence.
--   * State transitions are closed in the same trigger to the edges CBD-73
--     SS4.2 draws, minus Delivered and Failed, which this increment does not
--     have (IV-001, section 17 item 3). An accepted invitation can therefore
--     never leave accepted, and a declined one can never become
--     awaiting_confirmation. This is the mechanical half of CBD-41-AC06.
--   * DELETE is revoked from cobudget_api and cobudget_worker (IC-73-018).
--     Evidence ends by transition and by tombstoning a ciphertext, never by
--     disappearing.
--
-- Foreign keys to account_subject and to budget_space_membership are
-- DEFERRABLE INITIALLY DEFERRED (the CBD-231 SS3.2 pattern), so one
-- transaction may assemble mutually referring rows in any order and only the
-- committed state is checked.

-- ===========================================================================
-- budget_space_invitation (DR-73-01)
-- ===========================================================================
-- scope: budget-space
CREATE TABLE budget_space_invitation (
    invitation_id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id            uuid        NOT NULL
                                           REFERENCES budget_space (budget_space_id)
                                           DEFERRABLE INITIALLY DEFERRED,

    kind                       text        NOT NULL
                                           CHECK (kind IN ('real', 'synthetic')),

    created_by_membership_id   uuid        NOT NULL,
    created_by_subject_id      uuid        NOT NULL
                                           REFERENCES account_subject (account_subject_id)
                                           DEFERRABLE INITIALLY DEFERRED,

    -- The exact CBD-72 permission the creation required. Losing it cancels
    -- every invitation the person created under it (TR-73-06 system path,
    -- rule 7; SS10.3 step 6).
    required_permission        text        NOT NULL
                                           CHECK (required_permission IN ('24', '26')),
    creating_authorization_version integer  NOT NULL
                                           CHECK (creating_authorization_version >= 1),

    channel_type               text        NOT NULL
                                           CHECK (channel_type = 'email'),
    destination_token          text        NOT NULL
                                           CHECK (destination_token <> ''),
    destination_ciphertext     bytea       NOT NULL,
    destination_masked         text        NOT NULL
                                           CHECK (destination_masked <> ''),

    proposed_role              text        NOT NULL
                                           CHECK (proposed_role IN ('collaborator', 'co_owner')),
    resource_scope             text        NOT NULL
                                           CHECK (resource_scope = 'full'),

    disclosure_kind            text        NOT NULL
                                           CHECK (disclosure_kind IN (
                                               'invitation_collaborator',
                                               'invitation_co_owner'
                                           )),
    disclosure_version         integer     NOT NULL
                                           CHECK (disclosure_version >= 1),
    disclosure_digest          text        NOT NULL
                                           CHECK (disclosure_digest <> ''),

    policy_version             text        NOT NULL
                                           CHECK (policy_version <> ''),
    policy_digest              text        NOT NULL
                                           CHECK (policy_digest <> ''),

    invitation_version         integer     NOT NULL DEFAULT 1
                                           CHECK (invitation_version >= 1),

    state                      text        NOT NULL
                                           CHECK (state IN (
                                               'created', 'pending', 'awaiting_confirmation',
                                               'accepted', 'declined', 'expired',
                                               'superseded', 'cancelled',
                                               'synthetic_created', 'synthetic_pending',
                                               'synthetic_inactive'
                                           )),
    state_version              integer     NOT NULL DEFAULT 1
                                           CHECK (state_version >= 1),

    issued_at                  timestamptz NOT NULL DEFAULT now(),
    expires_at                 timestamptz NOT NULL,
    projection_inactive_at     timestamptz NOT NULL,
    projection_state           text        NOT NULL
                                           CHECK (projection_state IN (
                                               'pending', 'accepted', 'replaced',
                                               'cancelled', 'no_longer_active'
                                           )),

    private_terminal_cause     text        NULL
                                           CHECK (private_terminal_cause IS NULL
                                                  OR private_terminal_cause IN (
                                               'already_member', 'self_invitation',
                                               'stale_after_membership_end',
                                               'permission_lost', 'sibling_accepted'
                                           )),

    predecessor_invitation_id  uuid        NULL
                                           REFERENCES budget_space_invitation (invitation_id)
                                           DEFERRABLE INITIALLY DEFERRED,
    successor_invitation_id    uuid        NULL
                                           REFERENCES budget_space_invitation (invitation_id)
                                           DEFERRABLE INITIALLY DEFERRED,

    candidate_subject_id       uuid        NULL
                                           REFERENCES account_subject (account_subject_id)
                                           DEFERRABLE INITIALLY DEFERRED,
    accepted_membership_id     uuid        NULL,

    commit_idempotency_key     text        NULL,
    commit_request_digest      text        NULL,
    committed_response         jsonb       NULL,

    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (invitation_id),

    -- Composite unique target for the companion records below, so a code,
    -- ceremony or confirmation row from another space cannot bind to this
    -- invitation (BSL-231-010 tenant coherence).
    UNIQUE (budget_space_id, invitation_id),

    -- IC-73-012: the creating membership is a membership of this same space.
    CONSTRAINT budget_space_invitation_created_by_membership_fkey
        FOREIGN KEY (budget_space_id, created_by_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- AE-73-13: the membership TR-73-13 created, in this same space.
    CONSTRAINT budget_space_invitation_accepted_membership_fkey
        FOREIGN KEY (budget_space_id, accepted_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- DR-73-10: a synthetic suppressed record holds synthetic states and a
    -- real record holds real ones; the two sets never mix.
    CONSTRAINT budget_space_invitation_kind_matches_state
        CHECK ((kind = 'synthetic') = (state IN (
            'synthetic_created', 'synthetic_pending', 'synthetic_inactive'
        ))),

    -- CBD-73 SS4.5: for a real record the customer projection retires at the
    -- authoritative expiry, never later.
    CONSTRAINT budget_space_invitation_projection_deadline
        CHECK (kind <> 'real' OR projection_inactive_at = expires_at),

    -- A terminal cause is private evidence about a terminal record only.
    CONSTRAINT budget_space_invitation_private_cause_is_terminal
        CHECK (private_terminal_cause IS NULL OR state IN (
            'declined', 'expired', 'superseded', 'cancelled', 'synthetic_inactive'
        )),

    -- CBD-275-AC03/AC04: the receipt is whole or absent.
    CONSTRAINT budget_space_invitation_commit_receipt_complete
        CHECK (num_nonnulls(commit_idempotency_key, commit_request_digest, committed_response) IN (0, 3)),

    -- TR-73-13 sets the membership exactly when the invitation is accepted.
    CONSTRAINT budget_space_invitation_accepted_has_membership
        CHECK ((state = 'accepted') = (accepted_membership_id IS NOT NULL))
);

COMMENT ON TABLE budget_space_invitation IS
    'CBD-73 DR-73-01: one row per real or synthetic invitation, budget-space scoped. Authoritative state is the state column; the customer projection the inviter sees is projection_state and is deliberately a different, smaller vocabulary (CBD-73 SS4.5). Identity columns are write-once and transitions are closed by trigger; DELETE is revoked from both application roles.';

COMMENT ON COLUMN budget_space_invitation.destination_token IS
    'The canonical privacy-preserving normalized-destination token (an HMAC over the lower-cased, trimmed address under the CBD-246 field-encryption key derivation). Never the raw address, and never reversible. The alias rule of OI-73-010 is not in this increment.';

COMMENT ON COLUMN budget_space_invitation.destination_ciphertext IS
    'The raw address, envelope-encrypted with the existing COBUDGET_FIELD_ENCRYPTION provider. Readable only by the delivery adapter and the masked-projection reader; never logged, never projected, never a query predicate.';

COMMENT ON COLUMN budget_space_invitation.destination_masked IS
    'The owner-visible masked form, the only destination shape CBD-72 SS5.7 lets the inviter see.';

COMMENT ON COLUMN budget_space_invitation.private_terminal_cause IS
    'Restricted evidence (AE-73-27 classes). Never projected to any customer surface, including the inviter''s: CBD-73 SS4.5 gives the inviter one uniform retirement, so that a suppressed record cannot be told apart from an ordinary one.';

COMMENT ON COLUMN budget_space_invitation.candidate_subject_id IS
    'The durable candidate-account binding written by TR-73-10, cleared with a state_version bump when that subject''s membership in this space ends (IC-73-017).';

COMMENT ON COLUMN budget_space_invitation.disclosure_version IS
    'The registry version current when the invitation was created. Acceptance against any other version denies stale_disclosure at commit (TR-73-13); the value is never taken from a request (CF-236-005).';

-- CBD-73 SS4.4 rule 4: one dispatched real invitation per destination per
-- space at a time. A second create for the same destination routes TR-73-05
-- replacement instead of producing a second usable code; under SERIALIZABLE
-- a concurrent race loses here rather than in application code
-- (CBD-276-AC04).
CREATE UNIQUE INDEX budget_space_invitation_one_dispatched_per_destination
    ON budget_space_invitation (budget_space_id, destination_token)
    WHERE kind = 'real' AND state IN ('created', 'pending', 'awaiting_confirmation');

-- TR-73-05: a predecessor has at most one successor.
CREATE UNIQUE INDEX budget_space_invitation_one_successor
    ON budget_space_invitation (predecessor_invitation_id)
    WHERE predecessor_invitation_id IS NOT NULL;

-- The inviter's list read, and the TR-73-07 expiry sweep a request performs.
CREATE INDEX budget_space_invitation_space_state
    ON budget_space_invitation (budget_space_id, state);

-- The candidate-sibling cancellation of SS8 step 9.
CREATE INDEX budget_space_invitation_candidate_subject
    ON budget_space_invitation (budget_space_id, candidate_subject_id)
    WHERE candidate_subject_id IS NOT NULL;

CREATE FUNCTION forbid_budget_space_invitation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id
        OR NEW.created_by_subject_id IS DISTINCT FROM OLD.created_by_subject_id
        OR NEW.required_permission IS DISTINCT FROM OLD.required_permission
        OR NEW.creating_authorization_version IS DISTINCT FROM OLD.creating_authorization_version
        OR NEW.channel_type IS DISTINCT FROM OLD.channel_type
        OR NEW.destination_token IS DISTINCT FROM OLD.destination_token
        OR NEW.destination_ciphertext IS DISTINCT FROM OLD.destination_ciphertext
        OR NEW.destination_masked IS DISTINCT FROM OLD.destination_masked
        OR NEW.proposed_role IS DISTINCT FROM OLD.proposed_role
        OR NEW.resource_scope IS DISTINCT FROM OLD.resource_scope
        OR NEW.disclosure_kind IS DISTINCT FROM OLD.disclosure_kind
        OR NEW.disclosure_version IS DISTINCT FROM OLD.disclosure_version
        OR NEW.disclosure_digest IS DISTINCT FROM OLD.disclosure_digest
        OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
        OR NEW.policy_digest IS DISTINCT FROM OLD.policy_digest
        OR NEW.invitation_version IS DISTINCT FROM OLD.invitation_version
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.projection_inactive_at IS DISTINCT FROM OLD.projection_inactive_at
        OR NEW.predecessor_invitation_id IS DISTINCT FROM OLD.predecessor_invitation_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'budget_space_invitation identity is write-once; only state, state_version, projection_state, private_terminal_cause, successor_invitation_id, candidate_subject_id, accepted_membership_id, the commit receipt and updated_at may change'
            USING ERRCODE = '23514';
    END IF;

    -- CBD-73 SS4.2 as this increment executes it (Delivered and Failed are
    -- absent, IV-001), plus the synthetic edges of TR-73-16/17/18.
    IF NEW.state IS DISTINCT FROM OLD.state THEN
        IF NOT (
            (OLD.state = 'created' AND NEW.state IN ('pending', 'superseded', 'cancelled', 'expired'))
            OR (OLD.state = 'pending' AND NEW.state IN (
                'superseded', 'cancelled', 'expired', 'declined', 'awaiting_confirmation'
            ))
            OR (OLD.state = 'awaiting_confirmation' AND NEW.state IN ('accepted', 'cancelled', 'expired'))
            OR (OLD.state = 'synthetic_created' AND NEW.state IN ('synthetic_pending', 'synthetic_inactive'))
            OR (OLD.state = 'synthetic_pending' AND NEW.state = 'synthetic_inactive')
        ) THEN
            RAISE EXCEPTION 'budget_space_invitation transition % to % is not an edge of CBD-73 4.2', OLD.state, NEW.state
                USING ERRCODE = '23514';
        END IF;
        IF NEW.state_version <= OLD.state_version THEN
            RAISE EXCEPTION 'budget_space_invitation.state_version must increase with every transition (IC-73-011)'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.state_version < OLD.state_version THEN
        RAISE EXCEPTION 'budget_space_invitation.state_version never decreases'
            USING ERRCODE = '23514';
    END IF;

    -- PROTO-INVITATIONS-PK2-SEC-001 SEC-PK2-F02: the columns the identity block
    -- leaves mutable are not all the same kind of column. state, state_version,
    -- projection_state, successor_invitation_id and candidate_subject_id are
    -- lifecycle; the five below are evidence, written once by the transaction
    -- that earned them and never again. The identity block refuses a column
    -- that never takes a second value at all; this block refuses a third.
    IF OLD.accepted_membership_id IS NOT NULL
        AND NEW.accepted_membership_id IS DISTINCT FROM OLD.accepted_membership_id
    THEN
        RAISE EXCEPTION 'budget_space_invitation.accepted_membership_id is set once, by TR-73-13'
            USING ERRCODE = '23514';
    END IF;
    IF (OLD.commit_idempotency_key IS NOT NULL
            AND NEW.commit_idempotency_key IS DISTINCT FROM OLD.commit_idempotency_key)
        OR (OLD.commit_request_digest IS NOT NULL
            AND NEW.commit_request_digest IS DISTINCT FROM OLD.commit_request_digest)
        OR (OLD.committed_response IS NOT NULL
            AND NEW.committed_response IS DISTINCT FROM OLD.committed_response)
    THEN
        RAISE EXCEPTION 'budget_space_invitation commit receipt is write-once once recorded (CBD-275-AC03/AC04)'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.private_terminal_cause IS NOT NULL
        AND NEW.private_terminal_cause IS DISTINCT FROM OLD.private_terminal_cause
    THEN
        RAISE EXCEPTION 'budget_space_invitation.private_terminal_cause is write-once once set'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_invitation_forbid_mutation
    BEFORE UPDATE ON budget_space_invitation
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_invitation_mutation();

-- SEC-PK2-F06 item 2: IC-73-012 says the invitation was created by a member of
-- this space, and the composite foreign key above proves the membership is of
-- this space -- but nothing yet proved that created_by_subject_id is that
-- membership's own subject, so an invitation could name one member's
-- membership and another member's subject and pass both deferred keys. The
-- same shape, and the same deferral, as budget_space_consent_subject_coherence
-- (20260914T170000Z).
CREATE FUNCTION budget_space_invitation_creator_matches_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    member_subject uuid;
BEGIN
    SELECT m.account_subject_id INTO member_subject
        FROM budget_space_membership m
        WHERE m.budget_space_id = NEW.budget_space_id
          AND m.membership_id = NEW.created_by_membership_id;
    IF member_subject IS NOT NULL AND member_subject IS DISTINCT FROM NEW.created_by_subject_id THEN
        RAISE EXCEPTION 'budget_space_invitation.created_by_subject_id must be the subject of created_by_membership_id (IC-73-012)'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER budget_space_invitation_creator_coherence
    AFTER INSERT ON budget_space_invitation
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION budget_space_invitation_creator_matches_membership();

REVOKE DELETE ON budget_space_invitation FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- budget_space_invitation_code (DR-73-02)
-- ===========================================================================
-- scope: budget-space
CREATE TABLE budget_space_invitation_code (
    invitation_id            uuid        NOT NULL,
    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    -- The one-way verifier: HMAC-SHA-256 over the raw bearer, keyed by the
    -- field-encryption provider and bound to invitation_id,
    -- invitation_version and destination_token. The raw bearer is never here
    -- (IC-73-002: the code encodes nothing).
    verifier_digest          text        NOT NULL
                                         CHECK (verifier_digest <> ''),

    issued_at                timestamptz NOT NULL DEFAULT now(),
    expires_at               timestamptz NOT NULL,

    disposition              text        NOT NULL DEFAULT 'active'
                                         CHECK (disposition IN ('active', 'consumed', 'invalidated')),
    disposition_reason_class text        NULL,
    disposition_at           timestamptz NULL,

    -- A non-reversible fingerprint of the presented raw value, for the
    -- TR-73-14 unknown-value envelope and its abuse counting. Never the value.
    abuse_fingerprint        text        NULL,

    PRIMARY KEY (invitation_id),

    CONSTRAINT budget_space_invitation_code_invitation_fkey
        FOREIGN KEY (budget_space_id, invitation_id)
        REFERENCES budget_space_invitation (budget_space_id, invitation_id)
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT budget_space_invitation_code_disposition_at_matches
        CHECK ((disposition = 'active') = (disposition_at IS NULL))
);

COMMENT ON TABLE budget_space_invitation_code IS
    'CBD-73 DR-73-02: one row per dispatched real invitation, holding only the one-way verifier of the bearer code. A created invitation has no row; TR-73-02 inserts exactly one. The raw bearer exists only in the simulated delivery outbox row and in the recipient''s link.';

CREATE UNIQUE INDEX budget_space_invitation_code_verifier
    ON budget_space_invitation_code (verifier_digest);

CREATE FUNCTION forbid_budget_space_invitation_code_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.verifier_digest IS DISTINCT FROM OLD.verifier_digest
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    THEN
        RAISE EXCEPTION 'budget_space_invitation_code is write-once; only the disposition and the abuse fingerprint may change'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.disposition IS DISTINCT FROM OLD.disposition
        AND NOT (OLD.disposition = 'active' AND NEW.disposition IN ('consumed', 'invalidated'))
    THEN
        RAISE EXCEPTION 'budget_space_invitation_code admits only active to consumed and active to invalidated'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_invitation_code_forbid_mutation
    BEFORE UPDATE ON budget_space_invitation_code
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_invitation_code_mutation();

REVOKE DELETE ON budget_space_invitation_code FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- budget_space_invitation_ceremony (DR-73-03)
-- ===========================================================================
-- scope: budget-space
CREATE TABLE budget_space_invitation_ceremony (
    ceremony_id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    invitation_id            uuid        NOT NULL,

    -- The digest of the opaque one-time ceremony token the server sets as the
    -- __Host-mp_invitation_ceremony cookie. Never the reconciliation code,
    -- and never the token itself.
    ceremony_secret_digest   text        NOT NULL
                                         CHECK (ceremony_secret_digest <> ''),
    is_current               boolean     NOT NULL DEFAULT true,

    channel_proof_state      text        NOT NULL DEFAULT 'none'
                                         CHECK (channel_proof_state IN (
                                             'none', 'challenged', 'proved', 'exhausted'
                                         )),
    channel_challenge_digest text        NULL,
    channel_attempts         integer     NOT NULL DEFAULT 0
                                         CHECK (channel_attempts BETWEEN 0 AND 5),
    channel_proved_at        timestamptz NULL,

    attached_subject_id      uuid        NULL
                                         REFERENCES account_subject (account_subject_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    attached_session_ref     text        NULL,
    attached_at              timestamptz NULL,

    -- Restricted evidence only (IC-73-005): never projected, never a reason a
    -- customer surface gives, never compared to anything the invitee sees.
    primary_contact_match    boolean     NULL,

    disclosure_kind          text        NOT NULL
                                         CHECK (disclosure_kind IN (
                                             'invitation_collaborator',
                                             'invitation_co_owner'
                                         )),
    disclosure_version       integer     NOT NULL
                                         CHECK (disclosure_version >= 1),
    disclosure_digest        text        NOT NULL
                                         CHECK (disclosure_digest <> ''),

    acceptance_action_at     timestamptz NULL,
    accepted_disclosure_version integer  NULL
                                         CHECK (accepted_disclosure_version IS NULL
                                                OR accepted_disclosure_version >= 1),

    state                    text        NOT NULL DEFAULT 'open'
                                         CHECK (state IN (
                                             'open', 'declined',
                                             'accepted_pending_confirmation',
                                             'consumed', 'invalidated'
                                         )),
    expires_at               timestamptz NOT NULL,

    -- The CBD-232 SS8.1 environment key: a ceremony from another environment
    -- is unreadable, because the assembler loads it by
    -- (environment, attached_subject_id, ceremony_id).
    environment              text        NOT NULL
                                         CHECK (environment <> ''),

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (ceremony_id),

    UNIQUE (budget_space_id, ceremony_id),

    CONSTRAINT budget_space_invitation_ceremony_invitation_fkey
        FOREIGN KEY (budget_space_id, invitation_id)
        REFERENCES budget_space_invitation (budget_space_id, invitation_id)
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT budget_space_invitation_ceremony_proved_at_matches
        CHECK ((channel_proof_state = 'proved') = (channel_proved_at IS NOT NULL)),

    CONSTRAINT budget_space_invitation_ceremony_attachment_complete
        CHECK (num_nonnulls(attached_subject_id, attached_at) IN (0, 2)),

    -- SS5.2: the partial order is the row's, never the client's. An
    -- acceptance action exists only on an attached, channel-proved ceremony.
    CONSTRAINT budget_space_invitation_ceremony_acceptance_requires_attachment
        CHECK (acceptance_action_at IS NULL
               OR (attached_subject_id IS NOT NULL AND channel_proof_state = 'proved')),

    CONSTRAINT budget_space_invitation_ceremony_accepted_records_version
        CHECK (state <> 'accepted_pending_confirmation'
               OR (accepted_disclosure_version IS NOT NULL AND acceptance_action_at IS NOT NULL)),

    -- A terminal ceremony is not current; only a live one can be.
    CONSTRAINT budget_space_invitation_ceremony_terminal_not_current
        CHECK (NOT is_current OR state IN ('open', 'accepted_pending_confirmation'))
);

COMMENT ON TABLE budget_space_invitation_ceremony IS
    'CBD-73 DR-73-03: one row per TR-73-08 resolution. It is the server-side record of the fixed partial order of CBD-73 SS5 -- channel proof, then attachment, then the disclosure, then the acceptance action -- and the invitee''s subject-owned resource for the subject-scoped policy cells once attached_subject_id is set. At most one current ceremony per invitation.';

COMMENT ON COLUMN budget_space_invitation_ceremony.primary_contact_match IS
    'Restricted evidence under IC-73-005: whether the attached account''s primary contact matches the invited destination. Never shown, never a denial reason, and never a reason the person is asked about; an account with a different primary contact attaches exactly the same way (CBD-274-AC01/AC02).';

COMMENT ON COLUMN budget_space_invitation_ceremony.accepted_disclosure_version IS
    'The disclosure version the person actually acted on at TR-73-38, compared at commit against the invitation''s version and the registry''s current entry. A difference denies stale_disclosure and writes nothing.';

-- TR-73-08: at most one current ceremony per invitation, so a leaked link
-- cannot ride an in-progress ceremony; a new resolve invalidates the previous
-- one in the same transaction.
CREATE UNIQUE INDEX budget_space_invitation_ceremony_one_current
    ON budget_space_invitation_ceremony (invitation_id)
    WHERE is_current;

CREATE UNIQUE INDEX budget_space_invitation_ceremony_secret
    ON budget_space_invitation_ceremony (ceremony_secret_digest);

CREATE INDEX budget_space_invitation_ceremony_attached_subject
    ON budget_space_invitation_ceremony (environment, attached_subject_id, ceremony_id)
    WHERE attached_subject_id IS NOT NULL;

CREATE FUNCTION forbid_budget_space_invitation_ceremony_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.ceremony_id IS DISTINCT FROM OLD.ceremony_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
        OR NEW.ceremony_secret_digest IS DISTINCT FROM OLD.ceremony_secret_digest
        OR NEW.disclosure_kind IS DISTINCT FROM OLD.disclosure_kind
        OR NEW.disclosure_version IS DISTINCT FROM OLD.disclosure_version
        OR NEW.disclosure_digest IS DISTINCT FROM OLD.disclosure_digest
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.environment IS DISTINCT FROM OLD.environment
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony identity is write-once'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.state IS DISTINCT FROM OLD.state
        AND NOT (
            (OLD.state = 'open' AND NEW.state IN (
                'declined', 'accepted_pending_confirmation', 'invalidated'
            ))
            OR (OLD.state = 'accepted_pending_confirmation' AND NEW.state IN ('consumed', 'invalidated'))
        )
    THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony transition % to % is not admitted', OLD.state, NEW.state
            USING ERRCODE = '23514';
    END IF;

    -- A ceremony that has become current again would revive an invalidated
    -- binding; SS5.4 account switch and TR-73-08 both only ever clear it.
    IF NEW.is_current AND NOT OLD.is_current THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony.is_current never returns to true'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.channel_attempts < OLD.channel_attempts THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony.channel_attempts never decreases'
            USING ERRCODE = '23514';
    END IF;

    -- SEC-PK2-F03: the attachment is made once. SS5.4's account switch
    -- invalidates the ceremony and TR-73-08 resolves a new one; it never
    -- re-points an attached ceremony at a second subject. The acceptance action
    -- bound to the attachment by
    -- budget_space_invitation_ceremony_acceptance_requires_attachment is only
    -- evidence of who acted if the attachment it names cannot be replaced
    -- afterwards.
    IF OLD.attached_at IS NOT NULL
        AND (NEW.attached_subject_id IS DISTINCT FROM OLD.attached_subject_id
             OR NEW.attached_session_ref IS DISTINCT FROM OLD.attached_session_ref
             OR NEW.attached_at IS DISTINCT FROM OLD.attached_at
             OR NEW.primary_contact_match IS DISTINCT FROM OLD.primary_contact_match)
    THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony attachment evidence is write-once once attached_at is set (SS5.4 invalidates a ceremony, it never re-attaches one)'
            USING ERRCODE = '23514';
    END IF;

    -- The channel proof is monotonic. proved cannot be un-proved, which would
    -- retire the SS5.2 precondition of an acceptance action already taken, and
    -- exhausted cannot be reset into a fresh challenge, which is the whole
    -- point of the bounded attempt counter above.
    IF OLD.channel_proof_state IN ('proved', 'exhausted')
        AND NEW.channel_proof_state IS DISTINCT FROM OLD.channel_proof_state
    THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony.channel_proof_state never leaves %', OLD.channel_proof_state
            USING ERRCODE = '23514';
    END IF;
    IF OLD.channel_proved_at IS NOT NULL
        AND NEW.channel_proved_at IS DISTINCT FROM OLD.channel_proved_at
    THEN
        RAISE EXCEPTION 'budget_space_invitation_ceremony.channel_proved_at is write-once'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_invitation_ceremony_forbid_mutation
    BEFORE UPDATE ON budget_space_invitation_ceremony
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_invitation_ceremony_mutation();

REVOKE DELETE ON budget_space_invitation_ceremony FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- budget_space_invitation_confirmation (DR-73-13)
-- ===========================================================================
-- scope: budget-space
CREATE TABLE budget_space_invitation_confirmation (
    confirmation_id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    invitation_id            uuid        NOT NULL,
    ceremony_id              uuid        NOT NULL,

    acceptor_subject_id      uuid        NOT NULL
                                         REFERENCES account_subject (account_subject_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    -- The financial_profile.version whose display_name (M1, SS9) was shown to
    -- the confirming owner, so the receipt proves which display identity the
    -- confirmation was given against.
    displayed_identity_version integer   NOT NULL
                                         CHECK (displayed_identity_version >= 1),

    binding_rule_id          text        NOT NULL DEFAULT 'CBD-73-5.1'
                                         CHECK (binding_rule_id = 'CBD-73-5.1'),
    binding_rule_version     integer     NOT NULL DEFAULT 1
                                         CHECK (binding_rule_version = 1),

    state                    text        NOT NULL DEFAULT 'requested'
                                         CHECK (state IN ('requested', 'confirmed', 'rejected', 'expired')),
    expires_at               timestamptz NOT NULL,

    decided_by_membership_id uuid        NULL,
    decided_by_subject_id    uuid        NULL
                                         REFERENCES account_subject (account_subject_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    decided_at               timestamptz NULL,
    decided_authorization_version integer NULL
                                         CHECK (decided_authorization_version IS NULL
                                                OR decided_authorization_version >= 1),

    committed_consent_id     uuid        NULL
                                         REFERENCES budget_space_consent (consent_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    created_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (confirmation_id),

    CONSTRAINT budget_space_invitation_confirmation_invitation_fkey
        FOREIGN KEY (budget_space_id, invitation_id)
        REFERENCES budget_space_invitation (budget_space_id, invitation_id)
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT budget_space_invitation_confirmation_ceremony_fkey
        FOREIGN KEY (budget_space_id, ceremony_id)
        REFERENCES budget_space_invitation_ceremony (budget_space_id, ceremony_id)
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT budget_space_invitation_confirmation_decided_by_membership_fkey
        FOREIGN KEY (budget_space_id, decided_by_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- An owner decision is whole: who, when, and under which authorization
    -- version. An expiry is nobody's decision and carries none of it.
    CONSTRAINT budget_space_invitation_confirmation_decision_complete
        CHECK (
            (state IN ('requested', 'expired')
             AND num_nonnulls(decided_by_membership_id, decided_by_subject_id,
                              decided_at, decided_authorization_version) = 0)
            OR (state IN ('confirmed', 'rejected')
                AND num_nonnulls(decided_by_membership_id, decided_by_subject_id,
                                 decided_at, decided_authorization_version) = 4)
        ),

    -- TR-73-13: the consent row exists exactly when the confirmation
    -- committed one.
    CONSTRAINT budget_space_invitation_confirmation_consent_on_confirm
        CHECK ((state = 'confirmed') = (committed_consent_id IS NOT NULL))
);

COMMENT ON TABLE budget_space_invitation_confirmation IS
    'CBD-73 DR-73-13: the intended-recipient confirmation. One row per TR-73-38 acceptance action; the owner''s TR-73-39 decision on it is what makes TR-73-13 commit a membership and a consent row. Retained as authority evidence under IC-73-018.';

COMMENT ON COLUMN budget_space_invitation_confirmation.displayed_identity_version IS
    'The financial_profile.version of the acceptor whose display_name was shown at the confirmation prompt (SS9, DI-91-065). The confirmation is evidence of a decision about a particular displayed identity, so the version is recorded rather than the name.';

-- At most one live confirmation per invitation: the acceptance action is
-- singular, and a second requested row would let two owners each decide.
CREATE UNIQUE INDEX budget_space_invitation_confirmation_one_requested
    ON budget_space_invitation_confirmation (invitation_id)
    WHERE state = 'requested';

CREATE INDEX budget_space_invitation_confirmation_space_state
    ON budget_space_invitation_confirmation (budget_space_id, state);

CREATE FUNCTION forbid_budget_space_invitation_confirmation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
        OR NEW.ceremony_id IS DISTINCT FROM OLD.ceremony_id
        OR NEW.acceptor_subject_id IS DISTINCT FROM OLD.acceptor_subject_id
        OR NEW.displayed_identity_version IS DISTINCT FROM OLD.displayed_identity_version
        OR NEW.binding_rule_id IS DISTINCT FROM OLD.binding_rule_id
        OR NEW.binding_rule_version IS DISTINCT FROM OLD.binding_rule_version
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'budget_space_invitation_confirmation identity is write-once; only the decision may be recorded'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state
        AND NOT (OLD.state = 'requested' AND NEW.state IN ('confirmed', 'rejected', 'expired'))
    THEN
        RAISE EXCEPTION 'budget_space_invitation_confirmation admits only requested to confirmed, rejected or expired'
            USING ERRCODE = '23514';
    END IF;

    -- SEC-PK2-F03: once the owner has decided, the decision is closed. DR-73-13
    -- retains this row as the authority evidence of IC-73-018; a decision that
    -- can be re-attributed afterwards to another membership, another subject,
    -- another time or another authorization version is evidence of nothing.
    IF OLD.decided_at IS NOT NULL
        AND (NEW.decided_by_membership_id IS DISTINCT FROM OLD.decided_by_membership_id
             OR NEW.decided_by_subject_id IS DISTINCT FROM OLD.decided_by_subject_id
             OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
             OR NEW.decided_authorization_version IS DISTINCT FROM OLD.decided_authorization_version)
    THEN
        RAISE EXCEPTION 'budget_space_invitation_confirmation decision evidence is write-once once decided_at is set'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.committed_consent_id IS NOT NULL
        AND NEW.committed_consent_id IS DISTINCT FROM OLD.committed_consent_id
    THEN
        RAISE EXCEPTION 'budget_space_invitation_confirmation.committed_consent_id is write-once'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_invitation_confirmation_forbid_mutation
    BEFORE UPDATE ON budget_space_invitation_confirmation
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_invitation_confirmation_mutation();

REVOKE DELETE ON budget_space_invitation_confirmation FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- budget_space_invitation_outbox (SS5.3, DR-73-02 custody)
-- ===========================================================================
-- Identity scope, not budget-space scope: this is the custody record of a
-- delivery to a person, not shared budget-space content, and under
-- PROVIDERS-LOCAL-001 there is no provider to deliver it. The raw bearer and
-- the six-digit channel challenge live here, envelope-encrypted, until the
-- code is consumed or invalidated or the custody deadline passes, whichever
-- is first; then the ciphertexts are tombstoned. The row itself is retained
-- as custody evidence and is never deleted by an application role.
--
-- scope: identity
CREATE TABLE budget_space_invitation_outbox (
    outbox_id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    invitation_id            uuid        NOT NULL
                                         REFERENCES budget_space_invitation (invitation_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    channel_type             text        NOT NULL
                                         CHECK (channel_type = 'email'),

    -- FIDELITY_LABEL, exactly as the CBD-190 local adapter carries it: this
    -- record is a simulation of a delivery and must never be mistaken for one.
    fidelity_label           text        NOT NULL DEFAULT 'simulated'
                                         CHECK (fidelity_label = 'simulated'),

    destination_ciphertext   bytea       NULL,
    bearer_ciphertext        bytea       NULL,
    challenge_ciphertext     bytea       NULL,

    delivery_state           text        NOT NULL DEFAULT 'pending'
                                         CHECK (delivery_state IN ('pending', 'rendered', 'tombstoned')),
    rendered_at              timestamptz NULL,
    custody_deadline         timestamptz NOT NULL,
    tombstoned_at            timestamptz NULL,
    tombstone_reason_class   text        NULL
                                         CHECK (tombstone_reason_class IS NULL
                                                OR tombstone_reason_class IN (
                                             'code_consumed', 'code_invalidated', 'custody_deadline'
                                         )),

    created_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (outbox_id),

    UNIQUE (invitation_id),

    CONSTRAINT budget_space_invitation_outbox_tombstone_complete
        CHECK ((delivery_state = 'tombstoned')
               = (tombstoned_at IS NOT NULL AND tombstone_reason_class IS NOT NULL)),

    -- Before the tombstone the custody payload is whole; after it, gone. A
    -- half-cleared row would leave a bearer readable past its deadline.
    CONSTRAINT budget_space_invitation_outbox_payload_matches_state
        CHECK (
            (delivery_state = 'tombstoned'
             AND destination_ciphertext IS NULL
             AND bearer_ciphertext IS NULL
             AND challenge_ciphertext IS NULL)
            OR (delivery_state <> 'tombstoned'
                AND destination_ciphertext IS NOT NULL
                AND bearer_ciphertext IS NOT NULL
                AND challenge_ciphertext IS NOT NULL)
        )
);

COMMENT ON TABLE budget_space_invitation_outbox IS
    'CBD-234 design SS5.3 under PROVIDERS-LOCAL-001: the simulated local delivery record. TR-73-02 writes the raw bearer and the channel challenge here, envelope-encrypted; a local-only, developer-only surface renders them, present only when COBUDGET_IDENTITY_PROVIDER=local. This is a tolerated absence of provider delivery for a synthetic-identity prototype, not a delivery design (section 17 item 3); the provider adapter and the OI-73-008 custody evidence are a later packet.';

COMMENT ON COLUMN budget_space_invitation_outbox.custody_deadline IS
    'DR-73-02: equal to the invitation expiry. The ciphertexts are cleared at the deadline, or earlier when the code is consumed or invalidated, whichever comes first.';

CREATE INDEX budget_space_invitation_outbox_custody_sweep
    ON budget_space_invitation_outbox (custody_deadline)
    WHERE delivery_state <> 'tombstoned';

CREATE FUNCTION forbid_budget_space_invitation_outbox_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.outbox_id IS DISTINCT FROM OLD.outbox_id
        OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
        OR NEW.channel_type IS DISTINCT FROM OLD.channel_type
        OR NEW.fidelity_label IS DISTINCT FROM OLD.fidelity_label
        OR NEW.custody_deadline IS DISTINCT FROM OLD.custody_deadline
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'budget_space_invitation_outbox identity and custody deadline are write-once'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.delivery_state IS DISTINCT FROM OLD.delivery_state
        AND NOT (
            (OLD.delivery_state = 'pending' AND NEW.delivery_state IN ('rendered', 'tombstoned'))
            OR (OLD.delivery_state = 'rendered' AND NEW.delivery_state = 'tombstoned')
        )
    THEN
        RAISE EXCEPTION 'budget_space_invitation_outbox transition % to % is not admitted', OLD.delivery_state, NEW.delivery_state
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_invitation_outbox_forbid_mutation
    BEFORE UPDATE ON budget_space_invitation_outbox
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_invitation_outbox_mutation();

REVOKE DELETE ON budget_space_invitation_outbox FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- budget_space_lifecycle_audit (SS13, section 17 item 16)
-- ===========================================================================
-- scope: budget-space
CREATE TABLE budget_space_lifecycle_audit (
    event_id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    event_code               text        NOT NULL
                                         CHECK (event_code IN (
                                             'AE-73-01', 'AE-73-02', 'AE-73-03', 'AE-73-04',
                                             'AE-73-05', 'AE-73-06', 'AE-73-07', 'AE-73-08',
                                             'AE-73-09', 'AE-73-10', 'AE-73-11', 'AE-73-12',
                                             'AE-73-13', 'AE-73-14', 'AE-73-15', 'AE-73-16',
                                             'AE-73-17', 'AE-73-18', 'AE-73-19', 'AE-73-20',
                                             'AE-73-21', 'AE-73-22', 'AE-73-23', 'AE-73-24',
                                             'AE-73-25', 'AE-73-26', 'AE-73-27', 'AE-73-28',
                                             'AE-73-29', 'AE-73-30', 'AE-73-31', 'AE-73-32'
                                         )),
    -- The subtype column AE-73-25 and AE-73-32 need (transfer_committed;
    -- confirmation_requested, confirmation_confirmed, confirmation_rejected).
    event_subtype            text        NULL,

    occurred_at              timestamptz NOT NULL DEFAULT now(),

    actor_subject_id         uuid        NULL
                                         REFERENCES account_subject (account_subject_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    acting_membership_id     uuid        NULL,

    target_type              text        NOT NULL
                                         CHECK (target_type IN (
                                             'invitation', 'invitation_code', 'invitation_ceremony',
                                             'invitation_confirmation', 'membership', 'consent',
                                             'primary_transfer', 'budget_space', 'notice'
                                         )),
    target_id                uuid        NULL,

    result                   text        NOT NULL
                                         CHECK (result IN ('allow', 'deny', 'system')),
    reason_class             text        NULL,

    policy_version           text        NULL,
    policy_digest            text        NULL,
    correlation_id           uuid        NOT NULL,

    audience                 text        NOT NULL
                                         CHECK (audience IN ('customer', 'restricted')),

    -- Allowlisted keys only, written by the application: never a raw
    -- destination, code, bearer, or another member's personal state. The
    -- database enforces the shape; the allowlist itself is PK-5's and PK-6's
    -- and is proven there.
    payload                  jsonb       NOT NULL DEFAULT '{}'::jsonb
                                         CHECK (jsonb_typeof(payload) = 'object'),

    PRIMARY KEY (event_id),

    CONSTRAINT budget_space_lifecycle_audit_acting_membership_fkey
        FOREIGN KEY (budget_space_id, acting_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- A denial always names its class; CBD-73 SS9 has no unexplained deny.
    CONSTRAINT budget_space_lifecycle_audit_denial_has_reason
        CHECK (result <> 'deny' OR reason_class IS NOT NULL),

    -- SEC-PK2-F04: the restricted-only classes of CBD-73 SS14 cannot be
    -- labelled for a customer surface. AE-73-03 and AE-73-04 are internal
    -- delivery evidence, AE-73-11 and AE-73-12 restricted decline and block
    -- evidence, AE-73-26 a personal-account event, and AE-73-27 the synthetic
    -- suppression security event; each is security scope only. audience is the
    -- one mechanical thing between such a cause and the customer projection
    -- PK-6 will build on this table, so the rule is a CHECK and not only the
    -- comment on the column below.
    CONSTRAINT budget_space_lifecycle_audit_restricted_classes
        CHECK (event_code NOT IN (
                   'AE-73-03', 'AE-73-04', 'AE-73-11',
                   'AE-73-12', 'AE-73-26', 'AE-73-27'
               ) OR audience = 'restricted')
);

COMMENT ON TABLE budget_space_lifecycle_audit IS
    'CBD-234 design SS13 (section 17 item 16): the AE-73-* lifecycle events of one budget space, with the CBD-72 SS9 envelope and an allowlisted payload. Append-only: rows are never updated and DELETE is revoked from both application roles. The CBD-236 PolicyAuditEvent allowlist is a separate record and is unchanged; there is no consent_recorded class (OQ-CF-003), because the consent identifiers travel in the AE-73-13 and AE-73-25 payloads.';

COMMENT ON COLUMN budget_space_lifecycle_audit.audience IS
    'Whether the event may reach a customer surface at all. A restricted event (for example AE-73-27''s suppression classes, or AE-73-11 decline) is never projected: CBD-73 gives every customer one uniform outcome so that a suppressed record cannot be told from an ordinary one.';

CREATE INDEX budget_space_lifecycle_audit_space_occurred
    ON budget_space_lifecycle_audit (budget_space_id, occurred_at DESC);

CREATE INDEX budget_space_lifecycle_audit_correlation
    ON budget_space_lifecycle_audit (correlation_id);

CREATE FUNCTION forbid_budget_space_lifecycle_audit_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'budget_space_lifecycle_audit rows are append-only and never updated'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER budget_space_lifecycle_audit_forbid_update
    BEFORE UPDATE ON budget_space_lifecycle_audit
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_lifecycle_audit_update();

REVOKE DELETE ON budget_space_lifecycle_audit FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- invitation_security_event (SS13; AE-73-14)
-- ===========================================================================
-- AE-73-14 records the presentation of an unknown, malformed or terminal code
-- by anyone, authenticated or not. There is by definition no budget space to
-- attribute it to, so it cannot live in the budget-space-scoped audit table
-- above without a nullable tenant column, which the tenant statement layer
-- would have no way to scope. It is therefore an identity-scope sibling.
--
-- scope: identity
CREATE TABLE invitation_security_event (
    event_id                 uuid        NOT NULL DEFAULT gen_random_uuid(),

    event_code               text        NOT NULL
                                         CHECK (event_code = 'AE-73-14'),
    occurred_at              timestamptz NOT NULL DEFAULT now(),

    -- Present only when the presented value did resolve to a record and the
    -- space is therefore known; NULL for an unknown or malformed value, which
    -- is the ordinary case this table exists for.
    budget_space_id          uuid        NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    outcome_class            text        NOT NULL
                                         CHECK (outcome_class IN (
                                             'unknown_value', 'malformed_value',
                                             'terminal_record', 'expired_record'
                                         )),
    -- The same non-reversible fingerprint budget_space_invitation_code holds,
    -- so repeated presentation of one value is countable without the value
    -- ever being stored.
    abuse_fingerprint        text        NULL,
    correlation_id           uuid        NOT NULL,

    payload                  jsonb       NOT NULL DEFAULT '{}'::jsonb
                                         CHECK (jsonb_typeof(payload) = 'object'),

    PRIMARY KEY (event_id)
);

COMMENT ON TABLE invitation_security_event IS
    'CBD-234 design SS13: the TR-73-14 unknown-value envelope, identity scope because budget_space_id is unknowable for the case it exists for. Never the presented value, only a non-reversible fingerprint. Append-only; DELETE revoked from both application roles.';

CREATE INDEX invitation_security_event_fingerprint
    ON invitation_security_event (abuse_fingerprint, occurred_at DESC)
    WHERE abuse_fingerprint IS NOT NULL;

CREATE FUNCTION forbid_invitation_security_event_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'invitation_security_event rows are append-only and never updated'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER invitation_security_event_forbid_update
    BEFORE UPDATE ON invitation_security_event
    FOR EACH ROW
    EXECUTE FUNCTION forbid_invitation_security_event_update();

REVOKE DELETE ON invitation_security_event FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- What the DDL cannot prove, said in the catalog (SEC-PK2-F07)
-- ===========================================================================
-- Three of the text columns above carry a value whose safety is a property of
-- what PK-5 writes into them, not of their type. A comment is the only place
-- the database can carry that rule, and PK-5 carries the matching acceptance
-- criterion.

COMMENT ON COLUMN budget_space_invitation_ceremony.attached_session_ref IS
    'The account_session row identifier of the session the ceremony was attached from -- never the opaque session token, never its verifier digest, and never any value a client presents. It exists so that a revoked session can be correlated to the attachment it made; a token here would put a live credential in a table read for evidence.';

COMMENT ON COLUMN budget_space_invitation_ceremony.channel_challenge_digest IS
    'The digest of the six-digit channel challenge. It must be a keyed HMAC under the CBD-246 field-encryption key derivation, exactly like the session verifier digests: an unkeyed hash over a 10^6 value space is reversible by enumeration in negligible time, so an unkeyed digest here would be the challenge itself.';

COMMENT ON COLUMN budget_space_invitation_code.abuse_fingerprint IS
    'A non-reversible keyed fingerprint of a presented value, for TR-73-14 abuse counting. Keyed for the same reason channel_challenge_digest is: the terminal_record and expired_record outcomes fingerprint a real bearer, so an unkeyed digest would be a rainbow-table target. Never the presented value.';

COMMENT ON COLUMN invitation_security_event.abuse_fingerprint IS
    'The same non-reversible keyed fingerprint budget_space_invitation_code holds, under the same rule: keyed, never the presented value.';

-- ===========================================================================
-- Worker privileges on the secret-bearing records (SEC-PK2-F05)
-- ===========================================================================
-- The default privileges of 20260912T170000Z__grant_application_roles.sql give
-- cobudget_worker INSERT, SELECT and UPDATE on every table this migration
-- creates, including the three that carry secrets: the outbox holds the raw
-- bearer and the raw channel challenge as envelope ciphertext until custody
-- ends, the ceremony holds the ceremony secret digest and the channel
-- challenge digest, and the code row holds the bearer verifier digest.
--
-- Under PROVIDERS-LOCAL-001 there is no worker path to any of them: TR-73-02
-- writes the outbox inside the API transaction, the developer-only surface
-- reads it from the API, and TR-73-07 expiry and the custody sweep run on
-- request, because there is no scheduler (design proposal SS4.6). The CBD-191
-- correction round (20260913T110005Z, CBD191-SECURITY-002 finding 5)
-- established the rule this follows: a role with no code path to a
-- secret-bearing table gets no grant on it, and the grant comes back with the
-- code path, per operation, when one lands.
REVOKE ALL ON budget_space_invitation_outbox FROM cobudget_worker;
REVOKE ALL ON budget_space_invitation_ceremony FROM cobudget_worker;
REVOKE ALL ON budget_space_invitation_code FROM cobudget_worker;
