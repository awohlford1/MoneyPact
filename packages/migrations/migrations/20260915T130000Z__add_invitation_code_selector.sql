-- PROTO-SCHEMA-FOLLOWUPS-001 (EXEC-FOLLOWUPS-003 item 5(b); PK5-F02, PK5-F03):
-- budget_space_invitation_code gains an opaque lookup selector.
--
-- The stored verifier of DR-73-02 is an HMAC bound to (invitation_id,
-- invitation_version, destination_token), so it cannot be recomputed from a
-- presented value alone and the presented value cannot be a database
-- predicate. Until now the locator therefore recomputed the bound verifier
-- for every real code row and compared in constant time -- correct, and
-- O(every real code row) HMACs per resolve. The fix is the shape
-- packages/sessions already uses for account_session.session_selector
-- (20260913T110001Z, CBD-191 SS3.2): the bearer becomes
-- <selector>.<secret>, the selector is an opaque random handle that encodes
-- nothing (IC-73-002 still holds: not the space, not the record, not the
-- recipient) and proves nothing, and the row is looked up by it before the
-- bound verifier is recomputed over the secret half and compared in constant
-- time.
--
-- Nullable, not backfilled. A selector cannot be handed to the holder of a
-- bearer that was already delivered without one, so a backfilled random
-- selector would only make every outstanding pre-selector bearer
-- unresolvable. A row issued before this migration keeps code_selector NULL
-- and stays resolvable by the scan over exactly those rows, which the
-- application keeps running to completion; every row TR-73-02 inserts from
-- now on carries a selector, and the scan set empties as the old rows are
-- consumed, invalidated or expired out of relevance. Nothing is dropped or
-- renamed, so this is not a contract step.
--
-- No -- scope: annotation here: this migration creates no table.
-- budget_space_invitation_code is already declared budget-space scoped by
-- 20260915T100001Z.

ALTER TABLE budget_space_invitation_code
    ADD COLUMN code_selector text NULL
        CHECK (code_selector IS NULL OR char_length(code_selector) > 0);

COMMENT ON COLUMN budget_space_invitation_code.code_selector IS
    'CBD-73 DR-73-02 (PK5-F02): the opaque random lookup handle issued as the first half of the bearer, in the shape of account_session.session_selector. Encodes nothing and proves nothing; the bound verifier_digest over the secret half is the proof. NULL only on rows issued before the column existed, which the locator still answers by scan. Write-once.';

-- One row per selector. Partial so the pre-selector rows do not collide on
-- NULL (they would not anyway, but the intent should be visible).
CREATE UNIQUE INDEX budget_space_invitation_code_selector
    ON budget_space_invitation_code (code_selector)
    WHERE code_selector IS NOT NULL;

-- Replaces the 20260915T100001Z function of the same name; the trigger that
-- calls it is unchanged. The existing clauses are carried over verbatim and
-- code_selector joins the write-once set: a lookup handle that could be
-- repointed after issue would let one bearer locate another record.
CREATE OR REPLACE FUNCTION forbid_budget_space_invitation_code_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.code_selector IS DISTINCT FROM OLD.code_selector
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
