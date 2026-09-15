-- PROTO-API-HARDENING-003 (SEC-C200-F1). The replay hook in
-- apps/api/src/transactions/http.ts answers a manual-transaction
-- idempotency replay after the session and CSRF gates but before policy, so
-- a membership that stayed active through a role change (demotion) was
-- still served its own earlier response even though a fresh write and the
-- history read were both refused under the new role. Binding the stored
-- response to the membership's authorization_version at write time closes
-- that gap without adding a second policy evaluation to the replay path:
-- the route refuses a replay whose stored version is behind the
-- membership's current authorization_version with the same uniform denial
-- a fresh denied request receives, before the response is ever read back.
--
-- manual_transaction_idempotency (20260915T140000Z) gains a required
-- authorization_version column, set from budget_space_membership.
-- authorization_version by the route at write time going forward. Existing
-- rows -- this table has held data only inside migrated scratch and
-- prototype databases since 20260915T140000Z landed earlier the same day --
-- are backfilled from their own (budget_space_id, membership_id) row's
-- current authorization_version, the same value a fresh write would have
-- captured for that membership at this instant.
--
-- The table's append-only trigger (manual_transaction_idempotency_forbid_
-- update, 20260915T140000Z) fires on every UPDATE regardless of role, by
-- design: no runtime code may ever revise a committed response. The
-- one-time backfill below is schema evolution, not runtime revision, so the
-- trigger is disabled for the single UPDATE that performs it and
-- re-enabled immediately after, inside this migration's one transaction;
-- the invariant it protects is unchanged once this file has applied.
--
-- No structure is removed or renamed, so no contract-step header applies
-- (config/migrations.json contractStep).

ALTER TABLE manual_transaction_idempotency
    ADD COLUMN authorization_version integer;

ALTER TABLE manual_transaction_idempotency
    DISABLE TRIGGER manual_transaction_idempotency_forbid_update;

UPDATE manual_transaction_idempotency AS idempotency
    SET authorization_version = membership.authorization_version
    FROM budget_space_membership AS membership
    WHERE membership.budget_space_id = idempotency.budget_space_id
      AND membership.membership_id = idempotency.membership_id;

ALTER TABLE manual_transaction_idempotency
    ENABLE TRIGGER manual_transaction_idempotency_forbid_update;

ALTER TABLE manual_transaction_idempotency
    ALTER COLUMN authorization_version SET NOT NULL,
    ADD CONSTRAINT manual_transaction_idempotency_authorization_version_check
        CHECK (authorization_version >= 1);

COMMENT ON COLUMN manual_transaction_idempotency.authorization_version IS
    'SEC-C200-F1: the acting membership''s budget_space_membership.authorization_version at the moment this row was written. A replay is refused with the uniform denial when this is behind the membership''s current authorization_version, so a demoted-but-active membership can never be served a response its current role no longer proves.';
