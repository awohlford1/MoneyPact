-- CBD-116-FX-08. Declares budget-space scope and carries no budget_space_id,
-- so server-side authorization would have nothing to filter on.
-- scope: budget-space
CREATE TABLE budget_space_category (
    id    uuid NOT NULL,
    name  text NOT NULL,
    PRIMARY KEY (id)
);
