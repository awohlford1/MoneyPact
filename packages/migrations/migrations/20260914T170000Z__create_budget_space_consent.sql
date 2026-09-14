-- CBD-236 consent record (CBD236-CONSENT-SEMANTICS-001 items 2 and 4;
-- docs/cbd-236-consent-facts-proposal.md SS4 `CF-236-004` and SS6).
--
-- budget_space_consent is the physical DI-91-007 consent evidence record for
-- memberships, shaped from CBD-73 DR-73-04. One row per consent event. The
-- Primary Owner's creation-time self-disclosure row is the first row of a
-- space's consent history; invitation acceptance, membership change and
-- Primary transfer (CBD-8, later) add rows of the same shape and never a
-- second store.
--
-- The row is historical evidence, never an authorization input (CBD-73 SS2,
-- SS6 rule 6): budget_space_membership and its authorization_version
-- authorize. A consent row can only deny -- by its absence (input_invalid) or
-- by a state other than 'current' (consent_not_current, CBD-236 SS5.2).
--
-- THIS MIGRATION WRITES, ALTERS AND SYNTHESIZES NO ROW. Consent evidence is
-- created by a consent ceremony and by nothing else (CBD-73 SS6 rule 1;
-- CBD-231 SS7). There is deliberately no backfill: an existing local budget
-- space keeps its membership and gains no consent row, so from this migration
-- on every ordinary cell in that space denies input_invalid until the
-- database is reset and the space is recreated through the CBD-233
-- confirmation that now records consent. `npm run db:reset` and re-migrate is
-- the sanctioned local recovery (config/migrations.json `reset`); no hosted
-- database exists under PROVIDERS-LOCAL-001, so nothing is orphaned.
--
-- The role, resource_scope, source and disclosure_kind CHECK constraints are
-- deliberately closed to the one value the prototype can produce, exactly as
-- CBD-231 closes budget_space_membership.role/.status. Widening them is a
-- later migration in the CBD-73 invitation packet.
--
-- scope: budget-space
CREATE TABLE budget_space_consent (
    consent_id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id           uuid        NOT NULL
                                          REFERENCES budget_space (budget_space_id)
                                          DEFERRABLE INITIALLY DEFERRED,

    membership_id             uuid        NOT NULL,
    account_subject_id        uuid        NOT NULL
                                          REFERENCES account_subject (account_subject_id)
                                          DEFERRABLE INITIALLY DEFERRED,

    role                      text        NOT NULL
                                          CHECK (role = 'primary_owner'),
    resource_scope            text        NOT NULL
                                          CHECK (resource_scope = 'full'),

    source                    text        NOT NULL
                                          CHECK (source = 'self_disclosure'),
    source_record_id          uuid        NOT NULL,
    source_record_version     integer     NOT NULL
                                          CHECK (source_record_version >= 1),

    disclosure_kind           text        NOT NULL
                                          CHECK (disclosure_kind = 'primary_owner_self'),
    disclosure_version        integer     NOT NULL
                                          CHECK (disclosure_version >= 1),
    disclosure_digest         text        NOT NULL
                                          CHECK (disclosure_digest <> ''),

    policy_version            text        NOT NULL
                                          CHECK (policy_version <> ''),
    policy_digest             text        NOT NULL
                                          CHECK (policy_digest <> ''),

    state                     text        NOT NULL
                                          CHECK (state IN ('current', 'superseded', 'ended')),

    assurance_ref             text        NULL,

    recorded_at               timestamptz NOT NULL DEFAULT now(),
    recorded_by_subject_id    uuid        NOT NULL
                                          REFERENCES account_subject (account_subject_id)
                                          DEFERRABLE INITIALLY DEFERRED,

    supersedes_consent_id     uuid        NULL
                                          REFERENCES budget_space_consent (consent_id)
                                          DEFERRABLE INITIALLY DEFERRED,
    ended_by_event_id         uuid        NULL,
    ended_at                  timestamptz NULL,
    ended_reason_class        text        NULL,

    PRIMARY KEY (consent_id),

    -- BSL-231-010 tenant coherence: a membership row from another budget space
    -- cannot satisfy this reference.
    CONSTRAINT budget_space_consent_membership_fkey
        FOREIGN KEY (budget_space_id, membership_id)
        REFERENCES budget_space_membership (budget_space_id, membership_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- DR-73-04: ended_at is set exactly when the state leaves 'current'.
    CONSTRAINT budget_space_consent_ended_at_matches_state
        CHECK ((state = 'current') = (ended_at IS NULL))
);

COMMENT ON TABLE budget_space_consent IS
    'CBD-73 DR-73-04 and CBD-91 DI-91-007 historical consent evidence. '
    'One row per consent event. '
    'Never an authorization input: the membership row and its own '
    'authorization version are what authorize. This row can only deny, by '
    'absence or by a state other than current (CBD-73 SS6 rule 6; CBD-236 '
    'SS4.1 and SS5.2). Rows are write-once except the state transition and '
    'are never deleted by an application role.';

COMMENT ON COLUMN budget_space_consent.disclosure_version IS
    'The version of an approved disclosure text in config/consent-disclosure-registry.json that was current at the event. Never authorization_version, never a policy version, never a request value (CBD236-CONSENT-SEMANTICS-001 item 3).';

COMMENT ON COLUMN budget_space_consent.disclosure_digest IS
    'The registry content digest of that disclosure version, so the row proves which text was shown even if the registry file is later appended to.';

COMMENT ON COLUMN budget_space_consent.source_record_id IS
    'For self_disclosure, the CBD-233 proposal_id that keys the budget_creation_operation row; for later sources, the invitation, change-proposal or transfer-workflow record.';

-- CBD-73 SS6 rule 6 / TR-73-21 / TR-73-43: at most one current consent per
-- membership. A superseding row is inserted and the prior row transitions to
-- superseded in one transaction.
CREATE UNIQUE INDEX budget_space_consent_one_current_per_membership
    ON budget_space_consent (budget_space_id, membership_id)
    WHERE state = 'current';

-- The assembler's read path: (space, membership, subject).
CREATE INDEX budget_space_consent_membership_subject
    ON budget_space_consent (budget_space_id, membership_id, account_subject_id);

-- IC-73-018: consent evidence is immutable for historical explanation. Only
-- the state transition and its end-of-life columns may change, and only
-- current -> superseded or current -> ended. Shaped after
-- forbid_budget_space_membership_identity_mutation (20260913T090100Z).
CREATE FUNCTION forbid_budget_space_consent_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.consent_id IS DISTINCT FROM OLD.consent_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
        OR NEW.account_subject_id IS DISTINCT FROM OLD.account_subject_id
        OR NEW.role IS DISTINCT FROM OLD.role
        OR NEW.resource_scope IS DISTINCT FROM OLD.resource_scope
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
        OR NEW.source_record_version IS DISTINCT FROM OLD.source_record_version
        OR NEW.disclosure_kind IS DISTINCT FROM OLD.disclosure_kind
        OR NEW.disclosure_version IS DISTINCT FROM OLD.disclosure_version
        OR NEW.disclosure_digest IS DISTINCT FROM OLD.disclosure_digest
        OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
        OR NEW.policy_digest IS DISTINCT FROM OLD.policy_digest
        OR NEW.assurance_ref IS DISTINCT FROM OLD.assurance_ref
        OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
        OR NEW.recorded_by_subject_id IS DISTINCT FROM OLD.recorded_by_subject_id
        OR NEW.supersedes_consent_id IS DISTINCT FROM OLD.supersedes_consent_id
    THEN
        RAISE EXCEPTION 'budget_space_consent evidence is write-once; only the state transition may change'
            USING ERRCODE = '23514';
    END IF;
    IF NOT (OLD.state = 'current' AND NEW.state IN ('superseded', 'ended')) THEN
        RAISE EXCEPTION 'budget_space_consent admits only the transitions current to superseded and current to ended'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_space_consent_forbid_evidence_mutation
    BEFORE UPDATE ON budget_space_consent
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_space_consent_evidence_mutation();

-- Subject coherence (SS4): the consenting person is the membership's own
-- subject. The composite foreign key above already rejects a membership from
-- another space.
CREATE FUNCTION budget_space_consent_subject_matches_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    member_subject uuid;
BEGIN
    SELECT m.account_subject_id INTO member_subject
        FROM budget_space_membership m
        WHERE m.budget_space_id = NEW.budget_space_id
          AND m.membership_id = NEW.membership_id;
    IF member_subject IS NOT NULL AND member_subject IS DISTINCT FROM NEW.account_subject_id THEN
        RAISE EXCEPTION 'budget_space_consent.account_subject_id must equal the membership subject'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER budget_space_consent_subject_coherence
    AFTER INSERT ON budget_space_consent
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION budget_space_consent_subject_matches_membership();

-- Activation atomicity (SS4; CBD-73 TR-73-13 "membership/consent/authorization
-- activate atomically"). Deferred to commit so the creation transaction may
-- insert the membership and its consent row in either order. It inspects only
-- the row being inserted, so pre-existing memberships are never examined or
-- repaired.
CREATE FUNCTION budget_space_membership_requires_current_consent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    current_rows integer;
BEGIN
    SELECT count(*) INTO current_rows
        FROM budget_space_consent c
        WHERE c.budget_space_id = NEW.budget_space_id
          AND c.membership_id = NEW.membership_id
          AND c.state = 'current';
    IF current_rows <> 1 THEN
        RAISE EXCEPTION 'a new budget_space_membership must have exactly one current consent row at commit'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER budget_space_membership_activation_requires_consent
    AFTER INSERT ON budget_space_membership
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION budget_space_membership_requires_current_consent();

-- IC-73-018 / DB-231-009 pattern: consent evidence is not hard deleted through
-- an application role. The state transition is how consent ends.
REVOKE DELETE ON budget_space_consent FROM cobudget_worker, cobudget_api;
