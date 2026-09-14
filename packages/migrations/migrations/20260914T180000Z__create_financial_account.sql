-- CBD-196 / CBD-31 (PROTO-INCREMENT-A-001): the manual financial account.
--
-- One canonical record per account (CBD-196-AC01). `account_id` is the stable
-- identity every later reference holds -- a manual transaction, a balance
-- history, an audit line -- and it is never reused: an account is archived
-- (archived_at set) and restored (archived_at cleared), never deleted, which
-- is why DELETE is revoked from both application roles at the end of this
-- file. Archiving changes lifecycle availability and nothing else, so every
-- transaction, balance and provenance reference stays queryable through the
-- history paths that read the account by identity (CBD-196-AC04).
--
-- `origin` is 'manual' in this migration and in this migration only. CBD-9
-- (imported/institution-derived accounts) will widen the CHECK in its own
-- expand migration; until it does, an institution-derived account is not
-- representable here at all, which is the schema half of the guarantee that a
-- manual surface cannot mint an institution fact.
--
-- Versioning follows 20260913T130003Z's pattern in the one respect that
-- matters for an account, which is a mutable record rather than a retained
-- calculation: every edit bumps a monotonically increasing `version`, and the
-- trigger below refuses an update that does not advance it. The command layer
-- therefore always has a previous and a resulting version to expose for audit
-- (CBD-196-AC03) without the table having to carry a second copy of every row.
--
-- Monetary rules (config/migrations.json schema.monetary): the opening balance
-- is bigint minor units with an ISO 4217 currency code and the minor-unit
-- precision that sizes it. It is signed on purpose -- a credit card opens
-- negative -- so there is no non-negative CHECK here.
--
-- scope: budget-space
CREATE TABLE financial_account (
    account_id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id              uuid        NOT NULL
                                             REFERENCES budget_space (budget_space_id)
                                             DEFERRABLE INITIALLY DEFERRED,

    origin                       text        NOT NULL DEFAULT 'manual'
                                             CHECK (origin = 'manual'),
    account_type                 text        NOT NULL
                                             CHECK (account_type IN ('checking', 'savings', 'cash', 'credit-card', 'other')),
    label                        text        NOT NULL
                                             CHECK (length(label) BETWEEN 1 AND 120),

    currency_code                text        NOT NULL
                                             CHECK (currency_code ~ '^[A-Z]{3}$'),
    minor_unit_precision         smallint    NOT NULL
                                             CHECK (minor_unit_precision IN (0, 2, 3)),
    opening_balance_minor_units  bigint      NOT NULL,

    owner_subject_id             uuid        NOT NULL,
    created_by_subject_id        uuid        NOT NULL,

    archived_at                  timestamptz NULL,
    version                      integer     NOT NULL DEFAULT 1
                                             CHECK (version >= 1),

    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now()
                                             CHECK (updated_at >= created_at),

    PRIMARY KEY (account_id),

    -- The composite target manual_transaction's composite foreign key
    -- references, so a transaction cannot name an account of another budget.
    UNIQUE (budget_space_id, account_id)
);

COMMENT ON TABLE financial_account IS
    'CBD-196: a manual financial account in one budget space. account_id is the stable identity; label, type and opening balance are editable and every edit advances version. Archived, never deleted.';

COMMENT ON COLUMN financial_account.origin IS
    'CBD-196-AC01/CBD-199-AC02: manual only. CBD-9 widens this CHECK when imported accounts arrive; until then an institution-derived account is unrepresentable.';

COMMENT ON COLUMN financial_account.version IS
    'Advances by one on every accepted edit, archive and restore. The command layer reports the previous and resulting value for audit (CBD-196-AC03).';

-- Two live accounts in one budget cannot share a label; archived ones may, so
-- a label is reusable once its account is retired.
CREATE UNIQUE INDEX financial_account_live_label
    ON financial_account (budget_space_id, lower(label))
    WHERE archived_at IS NULL;

CREATE INDEX financial_account_space_lifecycle
    ON financial_account (budget_space_id, archived_at);

-- Identity, provenance and the currency an existing balance is denominated in
-- never change: a different currency is a different account, because every
-- transaction already written against this one is in the old denomination.
CREATE FUNCTION forbid_financial_account_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'account_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id THEN
        RAISE EXCEPTION 'financial_account.budget_space_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.origin IS DISTINCT FROM OLD.origin THEN
        RAISE EXCEPTION 'financial_account.origin is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.currency_code IS DISTINCT FROM OLD.currency_code
        OR NEW.minor_unit_precision IS DISTINCT FROM OLD.minor_unit_precision THEN
        RAISE EXCEPTION 'financial_account currency is immutable; a different denomination is a different account'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.created_by_subject_id IS DISTINCT FROM OLD.created_by_subject_id THEN
        RAISE EXCEPTION 'financial_account creation provenance is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.version <= OLD.version THEN
        RAISE EXCEPTION 'every financial_account update must advance version (CBD-196-AC03)'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER financial_account_forbid_identity_mutation
    BEFORE UPDATE ON financial_account
    FOR EACH ROW
    EXECUTE FUNCTION forbid_financial_account_identity_mutation();

-- Accounts are archived, never deleted: a deleted identity could be reused,
-- and a transaction that still references it would be orphaned.
REVOKE DELETE ON financial_account FROM cobudget_worker, cobudget_api;
