-- CBD-116-FX-05. A monetary column typed with the PostgreSQL money type.
-- scope: budget-space
CREATE TABLE budget_space_bill (
    id               uuid NOT NULL,
    budget_space_id  uuid NOT NULL,
    amount           money NOT NULL,
    currency_code    text NOT NULL,
    PRIMARY KEY (id)
);
