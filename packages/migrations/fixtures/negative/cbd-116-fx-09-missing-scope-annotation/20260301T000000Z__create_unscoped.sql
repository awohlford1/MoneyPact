-- CBD-116-FX-09. A table with no scope annotation at all. Scope cannot be
-- inferred from the name, so an unannotated table is an unanswered question.
CREATE TABLE platform_unscoped_thing (
    id  uuid PRIMARY KEY
);
