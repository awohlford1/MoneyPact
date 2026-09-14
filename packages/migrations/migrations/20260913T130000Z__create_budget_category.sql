-- CBD-153 / CBD-30 (INV-84): the stable, budget-scoped category identity.
--
-- category_id is the only thing a target, a tie-break, or any later reference
-- may hold on to. label and position are presentation attributes a user edits;
-- a relabel or reorder never creates a new identity, and an identity is never
-- reused (archived categories stay in the table with archived_at set, they are
-- never deleted). The composite UNIQUE (budget_space_id, category_id) is the
-- target the two target tables' composite foreign keys reference, so a target
-- cannot be attached to a category of another budget space.
--
-- scope: budget-space
CREATE TABLE budget_category (
    category_id       uuid        NOT NULL DEFAULT gen_random_uuid(),
    budget_space_id   uuid        NOT NULL
                                  REFERENCES budget_space (budget_space_id)
                                  DEFERRABLE INITIALLY DEFERRED,

    label             text        NOT NULL
                                  CHECK (length(label) BETWEEN 1 AND 120),
    position          integer     NOT NULL
                                  CHECK (position >= 0),
    archived_at       timestamptz NULL,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
                                  CHECK (updated_at >= created_at),

    PRIMARY KEY (category_id),
    UNIQUE (budget_space_id, category_id)
);

COMMENT ON TABLE budget_category IS
    'CBD-153: budget-scoped spending category. category_id is the stable identity (INV-84); label and position are mutable presentation. Archived, never deleted.';

-- Two live categories in one budget cannot share a label. Archived ones may,
-- so a label can be reused after its category is retired.
CREATE UNIQUE INDEX budget_category_live_label
    ON budget_category (budget_space_id, lower(label))
    WHERE archived_at IS NULL;

CREATE INDEX budget_category_space_position
    ON budget_category (budget_space_id, position);

CREATE FUNCTION forbid_budget_category_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
        RAISE EXCEPTION 'category_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.budget_space_id IS DISTINCT FROM OLD.budget_space_id THEN
        RAISE EXCEPTION 'budget_category.budget_space_id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'budget_category.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_category_forbid_identity_mutation
    BEFORE UPDATE ON budget_category
    FOR EACH ROW
    EXECUTE FUNCTION forbid_budget_category_identity_mutation();

-- Categories are archived, never deleted: an identity that disappeared could
-- be reused, and INV-84 forbids reuse.
REVOKE DELETE ON budget_category FROM cobudget_worker, cobudget_api;
