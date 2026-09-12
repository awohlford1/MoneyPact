-- CBD-116-FX-06. Integer minor units, but no currency code anywhere on the
-- table. Half of the architecture rule is not the rule.
-- scope: budget-space
CREATE TABLE budget_space_plan_line (
    id               uuid NOT NULL,
    budget_space_id  uuid NOT NULL,
    planned_amount   bigint NOT NULL,
    PRIMARY KEY (id)
);
