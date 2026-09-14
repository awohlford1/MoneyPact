-- CBD-153 / CBD-30 (INV-79, INV-35..37): the amount that governed one category
-- for one specific period, with the calculation provenance needed to
-- reproduce it.
--
-- origin, calculation and formula_version are budget-domain's PeriodTarget and
-- ProrationRecord persisted as they are: 'full-period' rows carry no
-- calculation and 'prorated-transition' rows always carry one, which the CHECK
-- below keeps unrepresentable the other way round, exactly as the domain's
-- discriminated union does. inputs records what the engine was given (the
-- base_target_id and amount, cadence, schedule version, period bounds), so the
-- stored result can be re-derived without re-deriving the periods.
--
-- Immutability (CBD-153-AC02): once its period is complete a row cannot be
-- updated or deleted, whatever role tries. The trigger compares the row's own
-- period_end_date with the server's current_date, and a second trigger keeps
-- period_start_date/period_end_date honest against budget_space_period on
-- every insert and update, so the immutability check cannot be talked out of
-- by writing a later end date. An open period's rows are replaced freely when
-- the base plan changes; that is INV-54's whole-set recomputation.
--
-- scope: budget-space
CREATE TABLE budget_category_period_target (
    period_target_id        uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id         uuid        NOT NULL
                                        REFERENCES budget_space (budget_space_id)
                                        DEFERRABLE INITIALLY DEFERRED,
    category_id             uuid        NOT NULL,
    period_id               uuid        NOT NULL
                                        REFERENCES budget_space_period (period_id)
                                        DEFERRABLE INITIALLY DEFERRED,
    period_start_date       date        NOT NULL,
    period_end_date         date        NOT NULL
                                        CHECK (period_end_date >= period_start_date),

    origin                  text        NOT NULL
                                        CHECK (origin IN ('full-period', 'prorated-transition')),
    currency_code           text        NOT NULL
                                        CHECK (currency_code ~ '^[A-Z]{3}$'),
    minor_unit_precision    smallint    NOT NULL
                                        CHECK (minor_unit_precision IN (0, 2, 3)),
    amount_minor_units      bigint      NOT NULL
                                        CHECK (amount_minor_units >= 0),

    formula_version         text        NOT NULL
                                        CHECK (length(formula_version) BETWEEN 1 AND 80),
    inputs                  jsonb       NOT NULL,
    calculation             jsonb       NULL,

    computed_by_subject_id  uuid        NOT NULL,
    source                  text        NOT NULL
                                        CHECK (source IN ('user', 'system')),
    computed_at             timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (period_target_id),

    FOREIGN KEY (budget_space_id, category_id)
        REFERENCES budget_category (budget_space_id, category_id)
        DEFERRABLE INITIALLY DEFERRED,

    -- One governing amount per category per period.
    UNIQUE (budget_space_id, period_id, category_id),

    -- The domain's discriminated union, as a constraint.
    CHECK (
        (origin = 'full-period' AND calculation IS NULL)
        OR (origin = 'prorated-transition' AND calculation IS NOT NULL)
    )
);

COMMENT ON TABLE budget_category_period_target IS
    'CBD-153: the period target that governed one category for one period, with origin, inputs, formula version and result (INV-79). Rows of a completed period are immutable.';

CREATE INDEX budget_category_period_target_period
    ON budget_category_period_target (budget_space_id, period_id);

-- The period the row names must belong to the same budget and carry exactly
-- the dates the row records. Raised as a foreign-key violation because that
-- is what it is: a reference that does not resolve inside this budget.
CREATE FUNCTION assert_budget_category_period_target_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM budget_space_period p
        WHERE p.period_id = NEW.period_id
          AND p.budget_space_id = NEW.budget_space_id
          AND p.period_start_date = NEW.period_start_date
          AND p.period_end_date = NEW.period_end_date
    ) THEN
        RAISE EXCEPTION 'budget_category_period_target names a period that is not this budget''s period with these dates'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_category_period_target_assert_period
    BEFORE INSERT OR UPDATE ON budget_category_period_target
    FOR EACH ROW
    EXECUTE FUNCTION assert_budget_category_period_target_period();

-- CBD-153-AC02. SQLSTATE 55000 (object_not_in_prerequisite_state) is the
-- stable code callers map to completed_period_immutable; 23514 stays reserved
-- for the identity fields that never change on any row.
CREATE FUNCTION forbid_completed_budget_category_period_target_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.period_end_date < current_date THEN
        RAISE EXCEPTION 'a completed period''s target is immutable (INV-79)'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF NEW.period_target_id IS DISTINCT FROM OLD.period_target_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.category_id IS DISTINCT FROM OLD.category_id
        OR NEW.period_id IS DISTINCT FROM OLD.period_id THEN
        RAISE EXCEPTION 'budget_category_period_target identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_category_period_target_forbid_completed_change
    BEFORE UPDATE OR DELETE ON budget_category_period_target
    FOR EACH ROW
    EXECUTE FUNCTION forbid_completed_budget_category_period_target_change();
