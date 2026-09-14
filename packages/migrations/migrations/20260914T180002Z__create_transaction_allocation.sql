-- CBD-201 / CBD-32 (PROTO-INCREMENT-A-001): how one transaction's signed
-- amount is divided across categories.
--
-- An allocation belongs to a transaction *version*, not to the identity. That
-- is what makes CBD-201-AC04 structural rather than procedural: replacing the
-- allocation set means writing a new version with its new allocations, so the
-- prior financial effect stops being the current effect at exactly one instant
-- and the ordered before/after set is still on disk afterwards. Allocations are
-- never updated and never deleted -- DELETE is revoked and the trigger refuses
-- both -- so an allocation row means the same thing forever.
--
-- CBD-201-AC02/AC03, the exact-sum rule: the signed sum of a version's
-- allocations equals that version's signed amount, to the minor unit, with no
-- tolerance in either direction. It is enforced here by a CONSTRAINT TRIGGER
-- declared DEFERRABLE INITIALLY DEFERRED, so the check runs once at commit
-- rather than after each row -- a five-way split is legal while it is being
-- written and illegal only if it does not add up when the transaction ends.
-- Both tables carry it, because the sum can be broken from either side: by
-- writing allocations that do not add up, or by writing a version whose amount
-- the allocations do not match. The application refuses a mismatch first with a
-- specific rule error; this is the defence that does not depend on it.
--
-- A tombstone version (removed_at set) carries no allocations at all, which is
-- the same rule seen from the other end: a removed transaction has no financial
-- effect, and "no effect" is spelled "no allocation rows", not "allocations
-- summing to zero".
--
-- scope: budget-space
CREATE TABLE transaction_allocation (
    allocation_id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    transaction_version_id   uuid        NOT NULL,
    category_id              uuid        NOT NULL,

    currency_code            text        NOT NULL
                                         CHECK (currency_code ~ '^[A-Z]{3}$'),
    minor_unit_precision     smallint    NOT NULL
                                         CHECK (minor_unit_precision IN (0, 2, 3)),
    amount_minor_units       bigint      NOT NULL,

    created_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (allocation_id),

    FOREIGN KEY (budget_space_id, transaction_version_id)
        REFERENCES manual_transaction (budget_space_id, transaction_version_id)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (budget_space_id, category_id)
        REFERENCES budget_category (budget_space_id, category_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- CBD-201-AC03: a category appears at most once in one version's set.
    UNIQUE (transaction_version_id, category_id)
);

COMMENT ON TABLE transaction_allocation IS
    'CBD-201: the signed minor-unit split of one manual transaction version across categories. The set sums to the version amount exactly, checked at commit by a deferred constraint trigger. Never updated, never deleted.';

CREATE INDEX transaction_allocation_version
    ON transaction_allocation (budget_space_id, transaction_version_id);

CREATE INDEX transaction_allocation_category
    ON transaction_allocation (budget_space_id, category_id);

-- The exact-sum rule, evaluated once per affected version at commit.
CREATE FUNCTION assert_transaction_allocation_exact_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_version_id uuid;
    v_amount bigint;
    v_removed timestamptz;
    v_currency text;
    v_precision smallint;
    v_count bigint;
    v_sum bigint;
    v_mismatched bigint;
BEGIN
    IF TG_TABLE_NAME = 'manual_transaction' THEN
        v_version_id := NEW.transaction_version_id;
    ELSE
        v_version_id := COALESCE(NEW.transaction_version_id, OLD.transaction_version_id);
    END IF;

    SELECT t.amount_minor_units, t.removed_at, t.currency_code, t.minor_unit_precision
      INTO v_amount, v_removed, v_currency, v_precision
    FROM manual_transaction t
    WHERE t.transaction_version_id = v_version_id;
    IF NOT FOUND THEN
        -- The version was never written, or was written and rolled back; its
        -- allocations cannot exist either and the foreign key says so.
        RAISE EXCEPTION 'transaction_allocation names a transaction version that does not exist'
            USING ERRCODE = '23503';
    END IF;

    SELECT count(*), COALESCE(sum(a.amount_minor_units), 0),
           count(*) FILTER (WHERE a.currency_code IS DISTINCT FROM v_currency
                               OR a.minor_unit_precision IS DISTINCT FROM v_precision)
      INTO v_count, v_sum, v_mismatched
    FROM transaction_allocation a
    WHERE a.transaction_version_id = v_version_id;

    IF v_removed IS NOT NULL THEN
        IF v_count <> 0 THEN
            RAISE EXCEPTION 'a removed manual transaction version carries no allocations (CBD-200-AC03)'
                USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
    END IF;

    IF v_count = 0 THEN
        RAISE EXCEPTION 'a live manual transaction version must carry at least one allocation (CBD-201-AC03)'
            USING ERRCODE = '23514';
    END IF;
    IF v_mismatched <> 0 THEN
        RAISE EXCEPTION 'every allocation is denominated in the transaction''s currency (CBD-201-AC03)'
            USING ERRCODE = '23514';
    END IF;
    IF v_sum <> v_amount THEN
        RAISE EXCEPTION 'allocations sum to % but the transaction amount is % (CBD-201-AC02)', v_sum, v_amount
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_allocation_assert_exact_sum
    AFTER INSERT OR UPDATE OR DELETE ON transaction_allocation
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION assert_transaction_allocation_exact_sum();

CREATE CONSTRAINT TRIGGER manual_transaction_assert_exact_sum
    AFTER INSERT ON manual_transaction
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION assert_transaction_allocation_exact_sum();

-- An allocation is a fact about a version that is itself immutable; there is
-- nothing about it that can legitimately change.
CREATE FUNCTION forbid_transaction_allocation_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'transaction allocations are immutable; replacing a split writes a new transaction version (CBD-201-AC04)'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER transaction_allocation_forbid_change
    BEFORE UPDATE OR DELETE ON transaction_allocation
    FOR EACH ROW
    EXECUTE FUNCTION forbid_transaction_allocation_change();

REVOKE DELETE ON transaction_allocation FROM cobudget_worker, cobudget_api;
