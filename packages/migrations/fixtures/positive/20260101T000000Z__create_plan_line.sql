-- CBD-116-FX-16. The shape a compliant migration has: an annotated scope, a
-- budget-space column on a budget-space table, integer minor units with a
-- currency code, and timestamps that carry an offset.
-- scope: budget-space
CREATE TABLE budget_space_plan_line (
    id               uuid NOT NULL,
    budget_space_id  uuid NOT NULL,
    planned_amount   bigint NOT NULL,
    currency_code    text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    superseded_at    timestamptz,
    PRIMARY KEY (id)
);

-- scope: financial-profile
CREATE TABLE financial_profile_connection (
    id          uuid NOT NULL,
    profile_id  uuid NOT NULL,
    created_at  timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
