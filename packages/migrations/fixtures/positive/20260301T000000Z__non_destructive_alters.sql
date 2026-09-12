-- CBD-116-FX-27. Everything the widened drop-column and rename-column rules
-- must NOT sweep in. Inside ALTER TABLE the words that can follow DROP are a
-- closed list, and only a bare column name among them removes anything; a
-- rule that caught these would make the contract-step header noise that
-- authors learn to add without reading.
--
-- The CASE ... END is here on purpose too: END at the start of a line closes a
-- CASE expression far more often than it commits a transaction, which is why
-- the transaction-control rule does not name it.
ALTER TABLE budget_space_plan_line DROP CONSTRAINT IF EXISTS plan_line_positive;
ALTER TABLE budget_space_plan_line ALTER COLUMN currency_code DROP DEFAULT;
ALTER TABLE budget_space_plan_line ALTER COLUMN currency_code DROP NOT NULL;
ALTER TABLE budget_space_plan_line ALTER COLUMN planned_amount DROP IDENTITY IF EXISTS;
ALTER TABLE budget_space_plan_line ALTER COLUMN planned_amount DROP EXPRESSION;
ALTER TABLE budget_space_plan_line RENAME CONSTRAINT plan_line_key TO plan_line_identity;

ALTER TABLE budget_space_plan_line ADD CONSTRAINT plan_line_positive CHECK (
    CASE
        WHEN planned_amount < 0 THEN false
        ELSE true
    END
);
