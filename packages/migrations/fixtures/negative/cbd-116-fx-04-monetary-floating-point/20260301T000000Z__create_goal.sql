-- CBD-116-FX-04. A monetary column typed as binary floating point.
-- scope: budget-space
CREATE TABLE budget_space_goal (
    id               uuid NOT NULL,
    budget_space_id  uuid NOT NULL,
    target_amount    double precision NOT NULL,
    currency_code    text NOT NULL,
    PRIMARY KEY (id)
);
