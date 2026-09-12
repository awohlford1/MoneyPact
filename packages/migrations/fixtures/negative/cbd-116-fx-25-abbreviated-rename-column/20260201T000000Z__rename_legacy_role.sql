-- CBD-116-FX-25. A column rename with COLUMN omitted. To a deployed version
-- still reading the old name this is a drop and an add at the same instant.
ALTER TABLE budget_space_member RENAME legacy_role TO role;
