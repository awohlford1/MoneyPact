-- CBD-116-FX-01. Removes a column and carries no contract-step header.
-- The check must reject it: a removal with no named expand step and no
-- deployed version that dropped the last reader is a removal nobody can show
-- is safe to roll a deployment back past (TD-103-028).
ALTER TABLE budget_space_member DROP COLUMN legacy_role;
