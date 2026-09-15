-- CBD-73 invitations, acceptance and Primary transfer, migration M1 of 3
-- (INVITATIONS-DESIGN-001, approved 2026-09-15;
-- docs/cbd-234-invitations-consent-design-proposal.md SS7.1, SS9, and
-- section 17 items 5, 6, 7 and 15).
--
-- This file widens what already exists so that a second person can hold a
-- membership and a consent row. It creates no table. The closed CHECKs of
-- CBD-231 (20260913T090100Z) and CBD-236 (20260914T170000Z) were deliberately
-- narrowed to the one value the creation transaction could produce; the
-- invitation packet is the migration that opens them, exactly as both files
-- said it would.
--
-- THIS MIGRATION WRITES, ALTERS AND SYNTHESIZES NO ROW. There is no backfill
-- and nothing to backfill: every existing membership row is
-- ('primary_owner', 'active') with no end, and every existing consent row is
-- ('primary_owner', 'self_disclosure', 'primary_owner_self'), so each one is
-- still valid under the wider CHECKs without being touched. Rollback of the
-- packet is a redeploy of the previous build (TD-103-028); the widened
-- domains leave every prior row readable by the prior code.
--
-- Every trigger, index and REVOKE of 20260914T170000Z is left in place. The
-- one function that changes, budget_space_consent_subject_matches_membership,
-- is replaced rather than dropped, so the constraint trigger that calls it
-- keeps its identity, its timing and its deferral.
--
-- Security result PROTO-CONSENT-LANDING-SEC-001 SEC-F02 is the reason this
-- file must land before any packet inserts a second membership: the deferred
-- activation trigger refuses at COMMIT any membership without exactly one
-- current consent row, and until the CHECKs below are widened that consent
-- row cannot be written for any role but Primary Owner. SEC-F04 is closed by
-- the recorded_by_subject_id rule at the end of this file.
--
-- No structure is removed or renamed here, so no contract-step header applies
-- (config/migrations.json contractStep): ALTER TABLE ... DROP CONSTRAINT is
-- not one of its destructive patterns, and the constraints dropped below are
-- immediately re-added in a strictly wider form in the same statement, inside
-- the runner's single transaction.

-- ---------------------------------------------------------------------------
-- 1. budget_space_membership: the five CBD-72 roles, the DR-73-09 end of a
--    membership, and one active role per person per space.
-- ---------------------------------------------------------------------------

-- The CBD-231 inline CHECKs carry PostgreSQL's generated names. They are
-- dropped by those exact names (not IF EXISTS) so that a database whose shape
-- does not match this contract fails loudly here rather than silently keeping
-- a narrower domain.
ALTER TABLE budget_space_membership
    DROP CONSTRAINT budget_space_membership_role_check,
    DROP CONSTRAINT budget_space_membership_status_check,
    ADD CONSTRAINT budget_space_membership_role_check
        CHECK (role IN (
            'primary_owner', 'co_owner', 'collaborator',
            'viewer', 'accountability_partner'
        )),
    ADD CONSTRAINT budget_space_membership_status_check
        CHECK (status IN ('active', 'revoked', 'removed'));

-- DR-73-09: how a membership ended. The revocation and removal packet is
-- deferred (section 17 item 13), but its columns land here so that packet
-- needs no second widening and so an ended membership is expressible the
-- moment it exists.
ALTER TABLE budget_space_membership
    ADD COLUMN ended_at           timestamptz NULL,
    ADD COLUMN ended_reason_class text        NULL,
    ADD COLUMN ended_by_event_id  uuid        NULL;

ALTER TABLE budget_space_membership
    ADD CONSTRAINT budget_space_membership_ended_at_matches_status
        CHECK ((status = 'active') = (ended_at IS NULL));

COMMENT ON COLUMN budget_space_membership.ended_at IS
    'CBD-73 DR-73-09: set exactly when status leaves active, by the constraint budget_space_membership_ended_at_matches_status. Never a soft delete: the row and its attributed records stay.';

COMMENT ON COLUMN budget_space_membership.ended_reason_class IS
    'DR-73-09 reason class, never free text and never another member''s personal state.';

COMMENT ON COLUMN budget_space_membership.ended_by_event_id IS
    'The budget_space_lifecycle_audit event that ended the membership (that table is created by the next migration; deliberately not a foreign key, so the audit write and the membership update are not ordered against each other).';

-- CBD-72 SS2.1: one active role per person per space. The existing
-- budget_space_membership_one_active_primary_owner index is untouched and
-- still forbids a second active Primary Owner; this one forbids the same
-- subject holding two active memberships of any roles in one space, which is
-- what invitation acceptance (SS8 step 5) and Primary transfer (SS10.3) rely
-- on. Every ended membership is excluded, so IC-73-017 re-invitation after an
-- end stays possible.
CREATE UNIQUE INDEX budget_space_membership_one_active_per_subject
    ON budget_space_membership (budget_space_id, account_subject_id)
    WHERE status = 'active';

COMMENT ON TABLE budget_space_membership IS
    'CBD-231 SS3.2 membership, widened by CBD-73 (INVITATIONS-DESIGN-001) to the five CBD-72 roles, the three statuses, and the DR-73-09 end columns. A row is still only ever created together with exactly one current budget_space_consent row (the deferred activation trigger of 20260914T170000Z).';

-- ---------------------------------------------------------------------------
-- 2. budget_space: the primary-ownership version TR-73-43 bumps.
-- ---------------------------------------------------------------------------

ALTER TABLE budget_space
    ADD COLUMN primary_ownership_version integer NOT NULL DEFAULT 1;

ALTER TABLE budget_space
    ADD CONSTRAINT budget_space_primary_ownership_version_check
        CHECK (primary_ownership_version >= 1);

COMMENT ON COLUMN budget_space.primary_ownership_version IS
    'CBD-73 TR-73-43 optimistic version of who holds primary ownership, incremented in the transfer commit transaction. It is the datastore source of ApiUserCapturedVersions.primaryOwnershipVersion; which packet wires it into the fact assembler is OQ-IV-004 and is not this migration.';

-- ---------------------------------------------------------------------------
-- 3. budget_space_consent: the roles, sources and disclosure kinds that an
--    invitation acceptance and a Primary transfer produce.
-- ---------------------------------------------------------------------------

ALTER TABLE budget_space_consent
    DROP CONSTRAINT budget_space_consent_role_check,
    DROP CONSTRAINT budget_space_consent_source_check,
    DROP CONSTRAINT budget_space_consent_disclosure_kind_check,
    ADD CONSTRAINT budget_space_consent_role_check
        CHECK (role IN (
            'primary_owner', 'co_owner', 'collaborator',
            'viewer', 'accountability_partner'
        )),
    ADD CONSTRAINT budget_space_consent_source_check
        CHECK (source IN (
            'self_disclosure', 'invitation_acceptance',
            'membership_change', 'primary_transfer'
        )),
    ADD CONSTRAINT budget_space_consent_disclosure_kind_check
        CHECK (disclosure_kind IN (
            'primary_owner_self',
            'invitation_collaborator',
            'invitation_co_owner',
            'invitation_viewer',
            'invitation_accountability_partner',
            'membership_change',
            'primary_transfer_recipient',
            'primary_transfer_outgoing'
        ));

-- resource_scope stays closed to 'full': Viewer and Accountability Partner
-- profiles do not exist in this increment (section 17 item 2), so there is no
-- second scope a row could carry.
--
-- Three of the kinds above -- invitation_viewer,
-- invitation_accountability_partner and membership_change -- have no
-- registered text and no route that can produce them (section 17 item 5).
-- They are admitted by the CHECK so that registering each later text is a
-- registry append and not a migration; the API startup guard, not this CHECK,
-- is what refuses a kind whose text is missing.

ALTER TABLE budget_space_consent
    ADD COLUMN source_ceremony_id uuid NULL;

COMMENT ON COLUMN budget_space_consent.source_ceremony_id IS
    'CBD-73 DR-73-04 ceremony correlation (section 17 item 7): the budget_space_invitation_ceremony row the consent came from, for source invitation_acceptance. NULL for self_disclosure and for primary_transfer, whose correlation is source_record_id. Deliberately not a foreign key in this migration: the ceremony table is created by the next one, and the correlation is evidence, not a dependency.';

-- Section 17 item 6, closing SEC-F04 of PROTO-CONSENT-LANDING-SEC-001: a
-- consent row evidences the consenting person's own explicit action, for
-- every source. The other party's action lives on the confirmation record
-- (DR-73-13) or the transfer record (DR-73-12), never here. Replaced in
-- place, so the DEFERRABLE INITIALLY DEFERRED constraint trigger
-- budget_space_consent_subject_coherence of 20260914T170000Z keeps calling
-- it, unchanged, at commit.
CREATE OR REPLACE FUNCTION budget_space_consent_subject_matches_membership() RETURNS trigger
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
    IF NEW.recorded_by_subject_id IS DISTINCT FROM NEW.account_subject_id THEN
        RAISE EXCEPTION 'budget_space_consent.recorded_by_subject_id must equal account_subject_id: the row evidences the consenting person''s own action (INVITATIONS-DESIGN-001 item 6)'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON COLUMN budget_space_consent.recorded_by_subject_id IS
    'Always equal to account_subject_id, enforced at commit by budget_space_consent_subject_coherence (INVITATIONS-DESIGN-001 item 6, closing SEC-F04). The confirming owner of an acceptance, and the other party of a transfer, are recorded on budget_space_invitation_confirmation and budget_space_primary_transfer respectively.';

-- ---------------------------------------------------------------------------
-- 4. financial_profile.display_name (DI-91-065; SS9, section 17 item 15).
-- ---------------------------------------------------------------------------
--
-- The prototype needs one safe display identity in three places -- the
-- disclosure's item 1, the confirmation prompt and the members list -- and no
-- column carried one. It is subject-owned identity data on the subject's own
-- profile row, nullable because a subject may have none: every surface then
-- shows the neutral label and never the contact. This is the CBD-212
-- amendment that section 14 routes to that document's owner.
ALTER TABLE financial_profile
    ADD COLUMN display_name text NULL;

ALTER TABLE financial_profile
    ADD CONSTRAINT financial_profile_display_name_check
        CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80);

COMMENT ON COLUMN financial_profile.display_name IS
    'CBD-91 DI-91-065 display identity: the name other members of a shared space see. Subject-owned, set by the subject (or from the provider name claim at first sign-in), never derived from a contact address and never the contact itself. NULL means every surface shows the neutral label.';
