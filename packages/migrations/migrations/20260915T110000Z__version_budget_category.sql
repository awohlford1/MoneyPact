-- PROTO-HARDENING-001 (F-INCB-03): budget_category gains a real version
-- column.
--
-- docs/cbd-236-authorization-policy-contract.md section 8.6.1 justifies the
-- CBD-211 drill-down's category target partly on the claim that the category
-- row "carries a version", and adds "until budget_category gains a version
-- column". It did not carry one. apps/api/src/sessions/budget-facts.ts
-- projected the row's own updated_at to whole seconds instead: monotonic and
-- derived from the row's own stored state, but a timestamp read as a version,
-- with one-second resolution and a dependence on the clock the writer
-- happened to stamp. Two edits inside the same second were the same version.
--
-- The column follows 20260914T180000Z's discipline for financial_account
-- exactly, because a category is the same kind of thing: a mutable record
-- rather than a retained calculation. Every edit bumps a monotonically
-- increasing integer and the identity trigger refuses an update that does not
-- advance it, so resource.version at precheck and at commit compares the row's
-- own version and nothing else.
--
-- Expand only. The column is NOT NULL DEFAULT 1, so every existing row is
-- version 1 at apply time and no reader that does not know about it is
-- affected; nothing is dropped or renamed, so this is not a contract step.
--
-- No -- scope: annotation here: this migration creates no table. budget_category
-- is already declared budget-space scoped by 20260913T130000Z.

ALTER TABLE budget_category
    ADD COLUMN version integer NOT NULL DEFAULT 1
        CHECK (version >= 1);

COMMENT ON COLUMN budget_category.version IS
    'CBD-236 section 8.6.1 resource.version for the CBD-211 category target. '
    'Starts at 1 and advances on every edit; the identity trigger refuses an '
    'update that does not advance it. Never a policy version, never a '
    'disclosure version, never authorization_version.';

-- Replaces the CBD-153 function of the same name; the trigger that calls it is
-- unchanged. The three immutability clauses are carried over verbatim and the
-- monotonic clause is added, worded as financial_account's is.
CREATE OR REPLACE FUNCTION forbid_budget_category_identity_mutation() RETURNS trigger
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
    IF NEW.version <= OLD.version THEN
        RAISE EXCEPTION 'every budget_category update must advance version (CBD-236 section 8.6.1)'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
