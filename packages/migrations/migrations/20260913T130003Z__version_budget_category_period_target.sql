-- CBD-153 correction round (PROTO-TARGETS-REVIEW-001 F-REVIEW-TARGETS-001,
-- F-TARGETS-002): period targets are retained versions, never replacements,
-- and "completed" is decided on the owning budget's date.
--
-- 1. superseded_at turns budget_category_period_target into the same
--    append-only history budget_category_base_target already is. Recomputing
--    an open period stamps superseded_at on the current rows and inserts new
--    ones; the prior row keeps its identifier, timestamps, actor and
--    provenance (CBD-236 contract: an active or historical correction
--    creates a retained version, and history and provenance are retained in
--    the same transaction). The one-per-period-per-category rule moves from
--    the table constraint to a partial unique index over current rows.
-- 2. The immutability trigger compared period_end_date with the server's
--    current_date, which is UTC in the container. The budget-space date is
--    the budget's own time zone (CBD-67 INV-24/INV-75), so a September
--    recompute at 01:00Z on 1 October was refused in New York and an update
--    at 16:00Z on 30 September was admitted in Tokyo. The replaced function
--    reads budget_space.time_zone, the trusted setting the application also
--    uses, and both directions are proved live at local midnight.
-- 3. No row is ever deleted: DELETE is revoked from the application roles
--    and the trigger refuses it for every row, completed or open.

ALTER TABLE budget_category_period_target
    ADD COLUMN superseded_at timestamptz NULL
        CHECK (superseded_at IS NULL OR superseded_at >= computed_at);

COMMENT ON COLUMN budget_category_period_target.superseded_at IS
    'NULL on the current version of a category''s target for the period; set when a recomputation of an open period replaced it with a newer row. Superseded rows are retained history.';

-- The composite UNIQUE was created unnamed; drop it by its columns so the
-- statement does not depend on the generated name.
DO $cbd153_versioning$
DECLARE
    v_constraint text;
BEGIN
    SELECT c.conname INTO v_constraint
    FROM pg_constraint c
    WHERE c.conrelid = 'budget_category_period_target'::regclass
      AND c.contype = 'u'
      AND (
          SELECT array_agg(a.attname::text ORDER BY k.ordinality)
          FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['budget_space_id', 'period_id', 'category_id'];
    IF v_constraint IS NULL THEN
        RAISE EXCEPTION 'budget_category_period_target has no unique constraint on (budget_space_id, period_id, category_id)';
    END IF;
    EXECUTE format('ALTER TABLE budget_category_period_target DROP CONSTRAINT %I', v_constraint);
END;
$cbd153_versioning$;

CREATE UNIQUE INDEX budget_category_period_target_one_current
    ON budget_category_period_target (budget_space_id, period_id, category_id)
    WHERE superseded_at IS NULL;

CREATE INDEX budget_category_period_target_history
    ON budget_category_period_target (budget_space_id, period_id, category_id, computed_at);

-- Replaces the CBD-153 function of the same name; the trigger that calls it
-- is unchanged. SQLSTATE 55000 stays the stable code for "this row is
-- history and cannot change"; 23514 stays the code for a field that never
-- changes on any row.
CREATE OR REPLACE FUNCTION forbid_completed_budget_category_period_target_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_time_zone text;
    v_budget_date date;
BEGIN
    SELECT b.time_zone INTO v_time_zone
    FROM budget_space b
    WHERE b.budget_space_id = OLD.budget_space_id;
    IF v_time_zone IS NULL THEN
        RAISE EXCEPTION 'budget_category_period_target names a budget space with no time zone'
            USING ERRCODE = '23503';
    END IF;
    -- The budget-space date: the instant now, read as a calendar date in the
    -- budget's own zone (CBD-67 INV-24). The server's current_date is not it.
    v_budget_date := (now() AT TIME ZONE v_time_zone)::date;
    IF OLD.period_end_date < v_budget_date THEN
        RAISE EXCEPTION 'a completed period''s target is immutable (INV-79)'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'period target versions are retained, never deleted'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'a superseded period target is history and cannot change'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.period_target_id IS DISTINCT FROM OLD.period_target_id
        OR NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id
        OR NEW.category_id IS DISTINCT FROM OLD.category_id
        OR NEW.period_id IS DISTINCT FROM OLD.period_id
        OR NEW.period_start_date IS DISTINCT FROM OLD.period_start_date
        OR NEW.period_end_date IS DISTINCT FROM OLD.period_end_date
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
        OR NEW.minor_unit_precision IS DISTINCT FROM OLD.minor_unit_precision
        OR NEW.amount_minor_units IS DISTINCT FROM OLD.amount_minor_units
        OR NEW.formula_version IS DISTINCT FROM OLD.formula_version
        OR NEW.inputs IS DISTINCT FROM OLD.inputs
        OR NEW.calculation IS DISTINCT FROM OLD.calculation
        OR NEW.computed_by_subject_id IS DISTINCT FROM OLD.computed_by_subject_id
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.computed_at IS DISTINCT FROM OLD.computed_at THEN
        RAISE EXCEPTION 'only superseded_at may change on a period target; a recomputation is a new row'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE DELETE ON budget_category_period_target FROM cobudget_worker, cobudget_api;
