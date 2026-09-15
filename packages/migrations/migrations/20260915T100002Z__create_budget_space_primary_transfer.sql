-- CBD-73 invitations, acceptance and Primary transfer, migration M3 of 3
-- (INVITATIONS-DESIGN-001, approved 2026-09-15;
-- docs/cbd-234-invitations-consent-design-proposal.md SS10.1 and SS13).
--
-- DR-73-12, the Primary transfer workflow record, and DR-73-11, the in-app
-- notice. Both are schema only: the workflow is PK-7 and depends on the
-- fresh-assurance step-up of PK-4 (section 17 item 9), and the notice list
-- page is PK-8. Nothing reads or writes either table yet.
--
-- THIS MIGRATION WRITES, ALTERS AND SYNTHESIZES NO ROW, and it alters nothing
-- that already exists.
--
-- The transfer is a consent-bearing membership change, not an administrative
-- flag: TR-73-43 supersedes both parties' consent rows and inserts two new
-- ones of source primary_transfer in the same transaction that moves
-- budget_space.primary_owner_membership_id and bumps both
-- authorization_versions and primary_ownership_version (M1). That is why this
-- table records both parties' captured versions and both disclosure tuples:
-- a version that moved after the proposal invalidates the workflow
-- (TR-73-46) rather than committing against a stale picture of who holds
-- what.

-- ===========================================================================
-- budget_space_primary_transfer (DR-73-12)
-- ===========================================================================
-- scope: budget-space
CREATE TABLE budget_space_primary_transfer (
    transfer_id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id                uuid        NOT NULL
                                               REFERENCES budget_space (budget_space_id)
                                               DEFERRABLE INITIALLY DEFERRED,

    proposer_membership_id         uuid        NOT NULL,
    recipient_membership_id        uuid        NOT NULL,

    -- Captured at proposal and re-checked at every step: TR-73-46 invalidates
    -- the workflow when any of the three has moved.
    proposer_authorization_version  integer     NOT NULL
                                               CHECK (proposer_authorization_version >= 1),
    recipient_authorization_version integer     NOT NULL
                                               CHECK (recipient_authorization_version >= 1),
    primary_ownership_version      integer     NOT NULL
                                               CHECK (primary_ownership_version >= 1),

    recipient_disclosure_kind      text        NOT NULL
                                               CHECK (recipient_disclosure_kind = 'primary_transfer_recipient'),
    recipient_disclosure_version   integer     NOT NULL
                                               CHECK (recipient_disclosure_version >= 1),
    recipient_disclosure_digest    text        NOT NULL
                                               CHECK (recipient_disclosure_digest <> ''),

    outgoing_disclosure_kind       text        NOT NULL
                                               CHECK (outgoing_disclosure_kind = 'primary_transfer_outgoing'),
    outgoing_disclosure_version    integer     NOT NULL
                                               CHECK (outgoing_disclosure_version >= 1),
    outgoing_disclosure_digest     text        NOT NULL
                                               CHECK (outgoing_disclosure_digest <> ''),

    state                          text        NOT NULL DEFAULT 'proposed'
                                               CHECK (state IN (
                                                   'proposed', 'recipient_accepted',
                                                   'primary_confirmed', 'ready', 'committed',
                                                   'declined', 'withdrawn', 'expired', 'invalidated'
                                               )),
    state_version                  integer     NOT NULL DEFAULT 1
                                               CHECK (state_version >= 1),
    expires_at                     timestamptz NOT NULL,

    recipient_accepted_at          timestamptz NULL,
    recipient_accepted_version     integer     NULL
                                               CHECK (recipient_accepted_version IS NULL
                                                      OR recipient_accepted_version >= 1),

    primary_confirmed_at           timestamptz NULL,
    primary_confirmed_version      integer     NULL
                                               CHECK (primary_confirmed_version IS NULL
                                                      OR primary_confirmed_version >= 1),
    -- The fresh-assurance evidence reference for the protected leg
    -- (29.transfer_primary_ownership). Never the assurance material itself.
    primary_assurance_ref          text        NULL,

    committed_at                   timestamptz NULL,
    recipient_consent_id           uuid        NULL
                                               REFERENCES budget_space_consent (consent_id)
                                               DEFERRABLE INITIALLY DEFERRED,
    outgoing_consent_id            uuid        NULL
                                               REFERENCES budget_space_consent (consent_id)
                                               DEFERRABLE INITIALLY DEFERRED,
    terminal_event_id              uuid        NULL,

    policy_version                 text        NOT NULL
                                               CHECK (policy_version <> ''),
    policy_digest                  text        NOT NULL
                                               CHECK (policy_digest <> ''),

    created_at                     timestamptz NOT NULL DEFAULT now(),
    updated_at                     timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (transfer_id),

    CONSTRAINT budget_space_primary_transfer_proposer_fkey
        FOREIGN KEY (budget_space_id, proposer_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT budget_space_primary_transfer_recipient_fkey
        FOREIGN KEY (budget_space_id, recipient_membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- TR-73-47: a Primary cannot transfer to themselves. The ineligible-target
    -- denials that need more than one row to see (a pending invitee, an ended
    -- member, a stale version) are the workflow's; this is the one the row
    -- itself can refuse.
    CONSTRAINT budget_space_primary_transfer_distinct_parties
        CHECK (proposer_membership_id <> recipient_membership_id),

    -- Each leg records its action whole, or not at all.
    CONSTRAINT budget_space_primary_transfer_recipient_leg_complete
        CHECK (num_nonnulls(recipient_accepted_at, recipient_accepted_version) IN (0, 2)),
    CONSTRAINT budget_space_primary_transfer_primary_leg_complete
        CHECK (num_nonnulls(primary_confirmed_at, primary_confirmed_version) IN (0, 2)),

    -- SS10.3 step 7: a committed transfer names both new consent rows and the
    -- instant it committed; an uncommitted one names none of them.
    CONSTRAINT budget_space_primary_transfer_commit_complete
        CHECK (
            (state = 'committed'
             AND num_nonnulls(committed_at, recipient_consent_id, outgoing_consent_id) = 3)
            OR (state <> 'committed'
                AND num_nonnulls(committed_at, recipient_consent_id, outgoing_consent_id) = 0)
        ),

    -- SS10.4: the protected leg is not confirmed without its fresh-assurance
    -- evidence reference.
    CONSTRAINT budget_space_primary_transfer_confirm_has_assurance
        CHECK (primary_confirmed_at IS NULL OR primary_assurance_ref IS NOT NULL)
);

COMMENT ON TABLE budget_space_primary_transfer IS
    'CBD-73 DR-73-12 (design SS10): the two-sided Primary transfer workflow. Both parties consent against their own disclosure kind, and the commit TR-73-43 runs inside whichever leg completes the pair. Identity columns are write-once, transitions are closed, at most one workflow per space is live, and DELETE is revoked from both application roles.';

COMMENT ON COLUMN budget_space_primary_transfer.primary_ownership_version IS
    'budget_space.primary_ownership_version as captured at proposal (added by M1). A change between proposal and commit means someone else moved primary ownership meanwhile, and the workflow invalidates rather than commits (TR-73-46).';

COMMENT ON COLUMN budget_space_primary_transfer.primary_assurance_ref IS
    'A reference to the fresh-assurance evidence for 29.transfer_primary_ownership bound to this action and space, never the assurance material. The prototype cannot produce it until the PK-4 step-up lands (section 17 item 9), so no transfer can commit before then -- by design, not by omission.';

-- SS10.1: one live workflow per space. Two concurrent transfers would race
-- for one primary ownership; the partial unique index makes the second lose
-- at proposal rather than at commit.
CREATE UNIQUE INDEX budget_space_primary_transfer_one_live_per_space
    ON budget_space_primary_transfer (budget_space_id)
    WHERE state IN ('proposed', 'recipient_accepted', 'primary_confirmed', 'ready');

CREATE INDEX budget_space_primary_transfer_recipient_state
    ON budget_space_primary_transfer (budget_space_id, recipient_membership_id, state);

CREATE FUNCTION forbid_budget_space_primary_transfer_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.transfer_id IS DISTINCT FROM OLD.transfer_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.proposer_membership_id IS DISTINCT FROM OLD.proposer_membership_id
        OR NEW.recipient_membership_id IS DISTINCT FROM OLD.recipient_membership_id
        OR NEW.proposer_authorization_version IS DISTINCT FROM OLD.proposer_authorization_version
        OR NEW.recipient_authorization_version IS DISTINCT FROM OLD.recipient_authorization_version
        OR NEW.primary_ownership_version IS DISTINCT FROM OLD.primary_ownership_version
        OR NEW.recipient_disclosure_kind IS DISTINCT FROM OLD.recipient_disclosure_kind
        OR NEW.recipient_disclosure_version IS DISTINCT FROM OLD.recipient_disclosure_version
        OR NEW.recipient_disclosure_digest IS DISTINCT FROM OLD.recipient_disclosure_digest
        OR NEW.outgoing_disclosure_kind IS DISTINCT FROM OLD.outgoing_disclosure_kind
        OR NEW.outgoing_disclosure_version IS DISTINCT FROM OLD.outgoing_disclosure_version
        OR NEW.outgoing_disclosure_digest IS DISTINCT FROM OLD.outgoing_disclosure_digest
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
        OR NEW.policy_digest IS DISTINCT FROM OLD.policy_digest
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'budget_space_primary_transfer identity and captured versions are write-once'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.state IS DISTINCT FROM OLD.state THEN
        IF NOT (
            (OLD.state = 'proposed' AND NEW.state IN (
                'recipient_accepted', 'primary_confirmed',
                'declined', 'withdrawn', 'expired', 'invalidated'
            ))
            OR (OLD.state = 'recipient_accepted' AND NEW.state IN (
                'ready', 'primary_confirmed', 'declined', 'withdrawn', 'expired', 'invalidated'
            ))
            OR (OLD.state = 'primary_confirmed' AND NEW.state IN (
                'ready', 'declined', 'withdrawn', 'expired', 'invalidated'
            ))
            OR (OLD.state = 'ready' AND NEW.state IN ('committed', 'expired', 'invalidated'))
        ) THEN
            RAISE EXCEPTION 'budget_space_primary_transfer transition % to % is not admitted', OLD.state, NEW.state
                USING ERRCODE = '23514';
        END IF;
        IF NEW.state_version <= OLD.state_version THEN
            RAISE EXCEPTION 'budget_space_primary_transfer.state_version must increase with every transition'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.state_version < OLD.state_version THEN
        RAISE EXCEPTION 'budget_space_primary_transfer.state_version never decreases'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_primary_transfer_forbid_mutation
    BEFORE UPDATE ON budget_space_primary_transfer
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_primary_transfer_mutation();

REVOKE DELETE ON budget_space_primary_transfer FROM cobudget_worker, cobudget_api;

-- ===========================================================================
-- account_lifecycle_notice (DR-73-11; SS13)
-- ===========================================================================
-- Identity scope: a notice belongs to a person, not to a budget space, and
-- one may exist with no space at all. Rows are written inside the transaction
-- that caused them (the AE-73-30 enqueue). There is no external delivery in
-- the prototype, and no delivery is ever an authorization or commit
-- dependency (CBD-280-AC06): the row is the notice.
--
-- scope: identity
CREATE TABLE account_lifecycle_notice (
    notice_id                uuid        NOT NULL DEFAULT gen_random_uuid(),

    account_subject_id       uuid        NOT NULL
                                         REFERENCES account_subject (account_subject_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    budget_space_id          uuid        NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,

    message_code             text        NOT NULL
                                         CHECK (message_code IN (
                                             'MSG-73-015', 'MSG-73-019', 'MSG-73-042',
                                             'MSG-73-050', 'MSG-73-052'
                                         )),
    event_correlation_id     uuid        NOT NULL,

    created_at               timestamptz NOT NULL DEFAULT now(),
    read_at                  timestamptz NULL,

    PRIMARY KEY (notice_id)
);

COMMENT ON TABLE account_lifecycle_notice IS
    'CBD-73 DR-73-11 (design SS13): the in-app notices of the invitation and transfer lifecycle. Written in the causing transaction; a code only, never the copy and never another person''s state -- MSG-73-052 in particular tells a declined acceptor nothing of who decided or why (CBD-73 SS5.1 item 6).';

COMMENT ON COLUMN account_lifecycle_notice.read_at IS
    'The only mutable column on the row: a notice is marked read by its own recipient and is otherwise immutable.';

CREATE INDEX account_lifecycle_notice_subject_unread
    ON account_lifecycle_notice (account_subject_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX account_lifecycle_notice_correlation
    ON account_lifecycle_notice (event_correlation_id);

CREATE FUNCTION forbid_account_lifecycle_notice_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.notice_id IS DISTINCT FROM OLD.notice_id
        OR NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.message_code IS DISTINCT FROM OLD.message_code
        OR NEW.event_correlation_id IS DISTINCT FROM OLD.event_correlation_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'account_lifecycle_notice is write-once; only read_at may change'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
        RAISE EXCEPTION 'account_lifecycle_notice.read_at is set once'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_lifecycle_notice_forbid_mutation
    BEFORE UPDATE ON account_lifecycle_notice
    FOR EACH ROW
    EXECUTE FUNCTION forbid_account_lifecycle_notice_mutation();

REVOKE DELETE ON account_lifecycle_notice FROM cobudget_worker, cobudget_api;
