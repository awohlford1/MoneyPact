# Agent Workflow schemas

Schemas are independently versioned under `schemas/<schema-version>/`. Use
`1.0/config.schema.json` and `1.0/event.schema.json` as editor targets. Record
and event payload schemas are exposed by `SchemaRegistry`, retaining stable
canonical `$id` values independent of the package version.
