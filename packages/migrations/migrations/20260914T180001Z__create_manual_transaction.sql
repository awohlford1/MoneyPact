-- CBD-199 / CBD-32 (PROTO-INCREMENT-A-001): the settled manual transaction.
--
-- The table is append-only versions, the same shape 20260913T130003Z gave
-- period targets and for the same reason: an edit must be able to remove the
-- prior financial effect and apply the new one while the ordered before/after
-- record survives (CBD-201-AC04). `transaction_id` is the stable identity a
-- user and every audit path refer to; `transaction_version_id` is the row.
-- Exactly one version of an identity is current at a time (superseded_at NULL,
-- the partial unique index below); every earlier version is retained history
-- and is immutable. Removal is a tombstone version -- removed_at set, no
-- allocations -- not a DELETE, which is revoked from both application roles.
--
-- CBD-199-AC02 in the schema: origin is 'manual' and settlement_state is
-- 'settled', both by CHECK, in this migration and in this migration only.
-- There is no state and no transition that produces a pending, provisional,
-- imported or institution-derived fact, because no such value is
-- representable. CBD-9 widens these CHECKs in its own expand migration when
-- imported and pending transactions arrive.
--
-- CBD-199-AC04, period assignment: the period is resolved by the application
-- from the budget's stored budget_space_period rows and then persisted here
-- with the bounds it was resolved against, and the trigger below re-checks
-- both -- that the period is this budget's with exactly these dates, and that
-- budget_date falls inside [period_start_date, period_end_date] inclusive. A
-- transaction dated on a period start therefore belongs to that period and one
-- dated the preceding calendar day cannot be stored against it, whatever the
-- caller asked for, and neither boundary moves.
--
-- Monetary rules (config/migrations.json schema.monetary): bigint minor units,
-- ISO 4217 currency code, explicit precision. The amount is signed -- an
-- expense is negative, income positive -- so there is no sign CHECK.
--
-- scope: budget-space
CREATE TABLE manual_transaction (
    transaction_version_id   uuid        NOT NULL DEFAULT gen_random_uuid(),
    transaction_id           uuid        NOT NULL,
    budget_space_id          uuid        NOT NULL
                                         REFERENCES budget_space (budget_space_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    account_id               uuid        NOT NULL,

    revision                 integer     NOT NULL
                                         CHECK (revision >= 1),

    origin                   text        NOT NULL DEFAULT 'manual'
                                         CHECK (origin = 'manual'),
    settlement_state         text        NOT NULL DEFAULT 'settled'
                                         CHECK (settlement_state = 'settled'),

    currency_code            text        NOT NULL
                                         CHECK (currency_code ~ '^[A-Z]{3}$'),
    minor_unit_precision     smallint    NOT NULL
                                         CHECK (minor_unit_precision IN (0, 2, 3)),
    amount_minor_units       bigint      NOT NULL,

    budget_date              date        NOT NULL,
    period_id                uuid        NOT NULL
                                         REFERENCES budget_space_period (period_id)
                                         DEFERRABLE INITIALLY DEFERRED,
    period_start_date        date        NOT NULL,
    period_end_date          date        NOT NULL
                                         CHECK (period_end_date >= period_start_date),

    description              text        NULL
                                         CHECK (description IS NULL OR length(description) BETWEEN 1 AND 200),

    recorded_by_subject_id   uuid        NOT NULL,
    source                   text        NOT NULL DEFAULT 'user'
                                         CHECK (source IN ('user', 'system')),

    removed_at               timestamptz NULL,
    removed_by_subject_id    uuid        NULL,
    superseded_at            timestamptz NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (transaction_version_id),

    FOREIGN KEY (budget_space_id, account_id)
        REFERENCES financial_account (budget_space_id, account_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- The composite target transaction_allocation's foreign key references.
    UNIQUE (budget_space_id, transaction_version_id),
    -- A revision number is used once per identity.
    UNIQUE (budget_space_id, transaction_id, revision),

    CHECK (superseded_at IS NULL OR superseded_at >= created_at),
    CHECK (removed_at IS NULL OR removed_at >= created_at),
    -- A tombstone names who removed it; a live version names no remover.
    CHECK ((removed_at IS NULL) = (removed_by_subject_id IS NULL)),
    CHECK (budget_date BETWEEN period_start_date AND period_end_date)
);

COMMENT ON TABLE manual_transaction IS
    'CBD-199: settled manual transactions as retained versions. transaction_id is the stable identity, transaction_version_id the row; one version is current (superseded_at NULL) and removal is a tombstone version, never a DELETE.';

COMMENT ON COLUMN manual_transaction.settlement_state IS
    'CBD-199-AC02: settled only. No manual state or transition can produce a pending or provisional fact, because no other value is representable.';

CREATE UNIQUE INDEX manual_transaction_one_current
    ON manual_transaction (budget_space_id, transaction_id)
    WHERE superseded_at IS NULL;

CREATE INDEX manual_transaction_period
    ON manual_transaction (budget_space_id, period_id)
    WHERE superseded_at IS NULL AND removed_at IS NULL;

CREATE INDEX manual_transaction_account_date
    ON manual_transaction (budget_space_id, account_id, budget_date);

CREATE INDEX manual_transaction_history
    ON manual_transaction (budget_space_id, transaction_id, revision);

-- The period a row names must be this budget's period carrying exactly these
-- dates, and the transaction's currency must be the account's. Raised as a
-- foreign-key violation because that is what both are: a reference that does
-- not resolve inside this budget.
CREATE FUNCTION assert_manual_transaction_references() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_currency text;
    v_precision smallint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM budget_space_period p
        WHERE p.period_id = NEW.period_id
          AND p.budget_space_id = NEW.budget_space_id
          AND p.period_start_date = NEW.period_start_date
          AND p.period_end_date = NEW.period_end_date
    ) THEN
        RAISE EXCEPTION 'manual_transaction names a period that is not this budget''s period with these dates (CBD-199-AC04)'
            USING ERRCODE = '23503';
    END IF;
    SELECT a.currency_code, a.minor_unit_precision INTO v_currency, v_precision
    FROM financial_account a
    WHERE a.account_id = NEW.account_id AND a.budget_space_id = NEW.budget_space_id;
    IF v_currency IS NULL THEN
        RAISE EXCEPTION 'manual_transaction names an account that is not this budget''s'
            USING ERRCODE = '23503';
    END IF;
    IF NEW.currency_code IS DISTINCT FROM v_currency OR NEW.minor_unit_precision IS DISTINCT FROM v_precision THEN
        RAISE EXCEPTION 'manual_transaction currency must be the account''s denomination'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER manual_transaction_assert_references
    BEFORE INSERT OR UPDATE ON manual_transaction
    FOR EACH ROW
    EXECUTE FUNCTION assert_manual_transaction_references();

-- A stored version is a fact. The only change any row ever accepts is the one
-- stamp that turns the current version into history, and only once. Everything
-- else -- an edit, a removal -- is a new row. SQLSTATE 55000 is the stable
-- code callers map to transaction_version_immutable.
CREATE FUNCTION forbid_manual_transaction_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'manual transaction versions are retained, never deleted; removal is a tombstone version'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'a superseded manual transaction version is history and cannot change'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.transaction_version_id IS DISTINCT FROM OLD.transaction_version_id
        OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.revision IS DISTINCT FROM OLD.revision
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.settlement_state IS DISTINCT FROM OLD.settlement_state
        OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
        OR NEW.minor_unit_precision IS DISTINCT FROM OLD.minor_unit_precision
        OR NEW.amount_minor_units IS DISTINCT FROM OLD.amount_minor_units
        OR NEW.budget_date IS DISTINCT FROM OLD.budget_date
        OR NEW.period_id IS DISTINCT FROM OLD.period_id
        OR NEW.period_start_date IS DISTINCT FROM OLD.period_start_date
        OR NEW.period_end_date IS DISTINCT FROM OLD.period_end_date
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.recorded_by_subject_id IS DISTINCT FROM OLD.recorded_by_subject_id
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.removed_at IS DISTINCT FROM OLD.removed_at
        OR NEW.removed_by_subject_id IS DISTINCT FROM OLD.removed_by_subject_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'only superseded_at may change on a manual transaction version; an edit is a new row'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER manual_transaction_forbid_version_change
    BEFORE UPDATE OR DELETE ON manual_transaction
    FOR EACH ROW
    EXECUTE FUNCTION forbid_manual_transaction_version_change();

REVOKE DELETE ON manual_transaction FROM cobudget_worker, cobudget_api;
