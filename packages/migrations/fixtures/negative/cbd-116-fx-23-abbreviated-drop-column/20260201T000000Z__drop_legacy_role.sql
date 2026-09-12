-- CBD-116-FX-23. The same removal as FX-01 in the spelling PostgreSQL also
-- accepts: COLUMN is optional. A rule written against the long form reports
-- this file as clean while it destroys a committed customer column.
ALTER TABLE budget_space_member DROP legacy_role;
