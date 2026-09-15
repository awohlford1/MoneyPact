-- PROTO-SCHEMA-FOLLOWUPS-001 (EXEC-FOLLOWUPS-003 item 5(c); PK7A-F01):
-- account_lifecycle_notice.message_code admits the transfer notices.
--
-- 20260915T100002Z closed message_code to MSG-73-015, MSG-73-019, MSG-73-042,
-- MSG-73-050 and MSG-73-052, so the only Primary-transfer message with a
-- durable DR-73-11 notice row was the commit's MSG-73-042. The mandatory
-- lifecycle notices of TR-73-40 (MSG-73-040 to the recipient), TR-73-44
-- (MSG-73-043 to the proposer), TR-73-45 (MSG-73-044 to the recipient) and
-- TR-73-46 (MSG-73-045 on expiry, MSG-73-027 on invalidation, to both
-- parties) were returned as message codes and audited as AE-73-30 enqueues
-- but could not be persisted. This widens the CHECK by the five codes so
-- the transfer commands write the rows they already audit.
--
-- The inline CHECK carries PostgreSQL's generated name
-- (account_lifecycle_notice_message_code_check); it is dropped and re-added
-- by that name, the way 20260915T100000Z widened
-- budget_space_membership_role_check. ALTER TABLE ... DROP CONSTRAINT is not
-- a destructive pattern under config/migrations.json, so no contract-step
-- header is needed; nothing is dropped or renamed.
--
-- No -- scope: annotation here: this migration creates no table.
-- account_lifecycle_notice is already declared identity scoped by
-- 20260915T100002Z.

ALTER TABLE account_lifecycle_notice
    DROP CONSTRAINT account_lifecycle_notice_message_code_check;

ALTER TABLE account_lifecycle_notice
    ADD CONSTRAINT account_lifecycle_notice_message_code_check
        CHECK (message_code IN (
            -- 20260915T100002Z: invitation and commit notices.
            'MSG-73-015', 'MSG-73-019', 'MSG-73-042', 'MSG-73-050', 'MSG-73-052',
            -- PK7A-F01: the transfer lifecycle notices of TR-73-40, TR-73-44,
            -- TR-73-45 and TR-73-46.
            'MSG-73-040', 'MSG-73-043', 'MSG-73-044', 'MSG-73-045', 'MSG-73-027'
        ));
