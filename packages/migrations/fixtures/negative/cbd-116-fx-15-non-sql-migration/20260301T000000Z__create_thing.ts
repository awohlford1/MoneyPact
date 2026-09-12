// CBD-116-FX-15. A migration expressed as code rather than as SQL: a model
// that generates a schema, which is the thing the architecture declined.
export const up = "CREATE TABLE platform_thing (id uuid PRIMARY KEY);";
