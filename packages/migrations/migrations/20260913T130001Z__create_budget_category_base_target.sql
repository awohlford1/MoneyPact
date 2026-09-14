-- CBD-153 / CBD-30 (INV-78, INV-54, INV-79): the standing base target a user
-- edits, one current row per category per cadence context.
--
-- Rows are append-only history. Changing a base target inserts a new row and
-- stamps superseded_at on the previous one; nothing else on a row ever changes
-- and no row is ever deleted. That is what lets a period target's provenance
-- point at the exact base_target_id it was computed from long after the plan
-- moved on (INV-79), and what discharges the policy's preserve obligation for
-- 2a.edit_target without a separate audit table.
--
-- Monetary rules (config/migrations.json): amount_minor_units is a bigint
-- count of the currency's minor unit, currency_code sits on the same row, and
-- minor_unit_precision records how many fractional digits that minor unit
-- represents. The precision CHECK is the constraint half of CBD-153-AC04: a
-- currency whose minor unit the target engine cannot represent (four or more
-- fractional digits) is refused here, not merely in the application. The
-- amount CHECK is the other half: a negative base target never reaches a row.
--
-- scope: budget-space
CREATE TABLE budget_category_base_target (
    base_target_id        uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id       uuid        NOT NULL
                                      REFERENCES budget_space (budget_space_id)
                                      DEFERRABLE INITIALLY DEFERRED,
    category_id           uuid        NOT NULL,

    cadence               text        NOT NULL
                                      CHECK (cadence IN ('weekly', 'monthly', 'paycheck', 'custom-fixed-length')),
    currency_code         text        NOT NULL
                                      CHECK (currency_code ~ '^[A-Z]{3}$'),
    minor_unit_precision  smallint    NOT NULL
                                      CHECK (minor_unit_precision IN (0, 2, 3)),
    amount_minor_units    bigint      NOT NULL
                                      CHECK (amount_minor_units >= 0),

    set_by_subject_id     uuid        NOT NULL,
    source                text        NOT NULL
                                      CHECK (source IN ('user', 'system')),

    created_at            timestamptz NOT NULL DEFAULT now(),
    superseded_at         timestamptz NULL
                                      CHECK (superseded_at IS NULL OR superseded_at >= created_at),

    PRIMARY KEY (base_target_id),
    UNIQUE (budget_space_id, base_target_id),

    -- A target belongs to a category of the same budget (INV-84 identity, not
    -- label or position, and never across budgets).
    FOREIGN KEY (budget_space_id, category_id)
        REFERENCES budget_category (budget_space_id, category_id)
        DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE budget_category_base_target IS
    'CBD-153: append-only base (standing) category targets per cadence context (INV-78). The current row is the one with superseded_at IS NULL.';

-- One current base target per category per cadence context.
CREATE UNIQUE INDEX budget_category_base_target_one_current
    ON budget_category_base_target (budget_space_id, category_id, cadence)
    WHERE superseded_at IS NULL;

CREATE FUNCTION forbid_budget_category_base_target_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'a superseded base target is history and cannot change'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.base_target_id IS DISTINCT FROM OLD.base_target_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.category_id IS DISTINCT FROM OLD.category_id
        OR NEW.cadence IS DISTINCT FROM OLD.cadence
        OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
        OR NEW.minor_unit_precision IS DISTINCT FROM OLD.minor_unit_precision
        OR NEW.amount_minor_units IS DISTINCT FROM OLD.amount_minor_units
        OR NEW.set_by_subject_id IS DISTINCT FROM OLD.set_by_subject_id
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'only superseded_at may change on a base target; a change is a new row'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_category_base_target_forbid_mutation
    BEFORE UPDATE ON budget_category_base_target
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_category_base_target_mutation();

REVOKE DELETE ON budget_category_base_target FROM cobudget_worker, cobudget_api;
