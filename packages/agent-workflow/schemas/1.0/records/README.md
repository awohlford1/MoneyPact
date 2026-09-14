# Record schemas

The canonical schema IDs are `https://agent-workflow.dev/schemas/1.0/records/<record-type>.schema.json`.
The runtime registry publishes schemas for configuration, assignment, plan,
checkpoint, work-item, task-packet, execution, action, result, assessment,
approval, decision, evidence, escalation, pending, awaiting-validation,
action-reconciliation, quarantine, hold, raw-response, archive-manifest, and
cleanup-manifest records. The registry is authoritative;
this directory is the stable editor-target location used when schemas are
materialized during packaging.
