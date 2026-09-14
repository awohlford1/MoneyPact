# Event payload schemas

Every event in `CORE_EVENT_TYPES` has a versioned payload schema with ID
`https://agent-workflow.dev/schemas/1.0/events/<event-type>.schema.json`.
The runtime first validates the common event envelope and then the registered
payload schema. Namespaced extensions are validated against both their declared
core base schema and their extension schema.
