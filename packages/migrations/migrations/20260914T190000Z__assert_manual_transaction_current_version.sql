-- CBD-200 / CBD-201 (PROTO-INCREMENT-B-001): the reviewer follow-up to the
-- 20260914T1800xxZ increment-A tables. Forward-only; the merged files are
-- immutable, so the two structural gaps PROTO-INCREMENT-A-REVIEW-001 found
-- are closed here as additional triggers rather than by editing them.
--
-- F-REV-001 and F-REV-002 -- exactly one current version, not at most one.
-- 20260914T180001Z gives manual_transaction a partial unique index on
-- (budget_space_id, transaction_id) WHERE superseded_at IS NULL, which makes
-- two current versions unrepresentable. It says nothing about zero. An UPDATE
-- that stamps superseded_at without an accompanying insert therefore passed
-- every check, and the sharp edge the review named is the autocommit misuse of
-- dataAccessTransactionsRepository.appendVersion: the stamp commits on its
-- own, the following insert fails at its own statement end, and the identity is
-- left with no current version -- unreadable, uneditable and unremovable for
-- ever. The deferred constraint trigger below asserts the other half of the
-- invariant at commit, so the stamp rolls back with SQLSTATE 23514 instead.
-- It is AFTER UPDATE only: an INSERT that creates a first version is checked
-- by the index, and asserting on insert would refuse the legal intermediate
-- state an edit passes through (new version inserted, old one not yet
-- stamped), which is exactly the kind of mid-transaction state a deferred
-- constraint exists to tolerate.
--
-- F-REV-003 -- an allocation may not be added to a superseded version.
-- transaction_allocation_forbid_change covers UPDATE and DELETE only, and the
-- deferred exact-sum trigger accepts new rows that net to zero, so a 0-amount
-- row or a +x/-x pair could be appended to a historical version and change the
-- detail set CBD-211 itemizes without changing any sum. The BEFORE INSERT
-- trigger below refuses an allocation whose version is already history, with
-- the same SQLSTATE 55000 the sibling immutability trigger raises.
--
-- No table, column, index or constraint is removed and no data is rewritten;
-- both triggers are additions over the merged shape.
--
-- scope: budget-space

CREATE FUNCTION assert_manual_transaction_one_current() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_current integer;
BEGIN
    SELECT count(*) INTO v_current
    FROM manual_transaction t
    WHERE t.budget_space_id = NEW.budget_space_id
      AND t.transaction_id = NEW.transaction_id
      AND t.superseded_at IS NULL;

    IF v_current <> 1 THEN
        RAISE EXCEPTION
            'manual transaction % must have exactly one current version at commit; found % (F-REV-001, F-REV-002)',
            NEW.transaction_id, v_current
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION assert_manual_transaction_one_current() IS
    'CBD-200: at commit every manual_transaction identity that was superseded in this transaction still has exactly one current version. A supersession stamp with no accompanying insert rolls back with 23514.';

CREATE CONSTRAINT TRIGGER manual_transaction_assert_one_current
    AFTER UPDATE ON manual_transaction
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION assert_manual_transaction_one_current();

CREATE FUNCTION forbid_allocation_on_superseded_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_superseded timestamptz;
    v_found boolean;
BEGIN
    SELECT t.superseded_at, true INTO v_superseded, v_found
    FROM manual_transaction t
    WHERE t.transaction_version_id = NEW.transaction_version_id;

    -- An absent version is the deferred foreign key's business, not this
    -- trigger's: the row may still be inserted later in the same transaction.
    IF v_found IS NOT TRUE THEN
        RETURN NEW;
    END IF;
    IF v_superseded IS NOT NULL THEN
        RAISE EXCEPTION
            'a superseded manual transaction version is history; its allocation set cannot be added to (F-REV-003, CBD-201-AC04)'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION forbid_allocation_on_superseded_version() IS
    'CBD-201-AC04: an allocation belongs to the version it was written with. Appending one to a superseded version raises 55000.';

CREATE TRIGGER transaction_allocation_forbid_superseded_insert
    BEFORE INSERT ON transaction_allocation
    FOR EACH ROW
    EXECUTE FUNCTION forbid_allocation_on_superseded_version();
