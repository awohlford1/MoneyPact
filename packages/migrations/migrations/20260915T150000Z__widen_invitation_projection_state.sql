-- PROTO-INVITATIONS-AWAITING-CONFIRMATION-001 (EXEC-PK8-RULINGS-001 item (a);
-- PK8-F05; CBD-73 SS4.5): budget_space_invitation.projection_state admits
-- 'awaiting_confirmation'.
--
-- 20260915T100001Z closed projection_state to 'pending', 'accepted',
-- 'replaced', 'cancelled', 'no_longer_active', so a real invitation whose
-- acceptance is awaiting the owner's TR-73-39 confirmation projected to the
-- inviter as 'pending' -- indistinguishable from a link nobody had used yet.
-- EXEC-PK8-RULINGS-001 item (a) requires the inviter to see a distinct
-- 'awaiting_confirmation' projection once TR-73-38 records the acceptance.
-- This widens the CHECK by that one value; the write-once trigger from
-- 20260915T100001Z already permits projection_state to change, and no other
-- column or constraint moves.
--
-- The inline CHECK carries PostgreSQL's generated name
-- (budget_space_invitation_projection_state_check); it is dropped and
-- re-added by that name, the way 20260915T130001Z widened
-- account_lifecycle_notice.message_code. ALTER TABLE ... DROP CONSTRAINT is
-- not a destructive pattern under config/migrations.json, so no
-- contract-step header is needed; nothing is dropped or renamed.
--
-- No -- scope: annotation here: this migration creates no table.
-- budget_space_invitation is already declared identity scoped by
-- 20260915T100001Z.

ALTER TABLE budget_space_invitation
    DROP CONSTRAINT budget_space_invitation_projection_state_check;

ALTER TABLE budget_space_invitation
    ADD CONSTRAINT budget_space_invitation_projection_state_check
        CHECK (projection_state IN (
            'pending', 'awaiting_confirmation', 'accepted', 'replaced',
            'cancelled', 'no_longer_active'
        ));
