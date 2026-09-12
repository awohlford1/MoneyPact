-- CBD-116-FX-24. DROP IF EXISTS with COLUMN omitted, which is the third
-- spelling of the same destruction.
ALTER TABLE budget_space_member DROP IF EXISTS legacy_role;
