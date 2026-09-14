import { CORE_EVENT_TYPES, CORE_RECORD_TYPES, type CoreRecordType } from "../../registries/catalogue.ts";
import type { JsonSchema } from "./types.ts";
import { MANAGED_WORKFLOW_COMMANDS } from "../../contracts/commands.ts";

export const SCHEMA_VERSION = "1.0";
export const SCHEMA_BASE = `https://agent-workflow.dev/schemas/${SCHEMA_VERSION}`;
const id = (name: string) => `${SCHEMA_BASE}/${name}.schema.json`;
const string = (pattern?: string): JsonSchema => ({ type: "string", minLength: 1, ...(pattern ? { pattern } : {}) });
const timestamp: JsonSchema = { type: "string", format: "date-time" };
const nullableTimestamp: JsonSchema = { type: ["string", "null"], format: "date-time" };
const positiveInteger: JsonSchema = { type: "integer", minimum: 1 };
const identifier = (prefix?: string): JsonSchema => string(prefix ? `^${prefix}-[A-Za-z0-9][A-Za-z0-9._-]*$` : "^[A-Za-z][A-Za-z0-9._:-]*$");
const stringArray: JsonSchema = { type: "array", items: string(), uniqueItems: true };
const strict = (schemaId: string, required: string[], properties: Record<string, JsonSchema>): JsonSchema => ({
  ...(schemaId.startsWith("#") ? {} : { $schema: "https://json-schema.org/draft/2020-12/schema", $id: schemaId }), type: "object",
  required, properties, additionalProperties: false,
});
const version = { schema_version: { const: SCHEMA_VERSION } as JsonSchema };
const recordBase = (type: string, required: string[], properties: Record<string, JsonSchema>): JsonSchema => strict(id(`records/${type}`), ["schema_version", "record_id", "record_type", "created_at", ...required], {
  ...version, record_id: identifier(), record_type: { const: type }, created_at: timestamp, updated_at: timestamp, ...properties,
});
const ref: JsonSchema = strict("#record-ref", ["record_type", "record_id"], { record_type: string(), record_id: identifier(), revision: positiveInteger });
const actor: JsonSchema = strict("#actor", ["actor_id", "actor_type"], { actor_id: identifier(), actor_type: { enum: ["executive", "manager", "specialist", "runtime", "external_system"] }, display_name: string() });
const modelSelection: JsonSchema = strict("#model-selection", ["provider", "model"], { provider: string(), model: string(), reasoning_effort: string() });

// Extension bases deliberately allow namespaced fields; the registered extension
// schema validates those fields while this base preserves mandatory identity/time constraints.
export const extensionRecordBaseSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", $id: id("records/extension-base"), type: "object",
  required: ["schema_version", "record_id", "record_type", "created_at"],
  properties: { ...version, record_id: identifier(), record_type: string("^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$"), created_at: timestamp, updated_at: timestamp },
  additionalProperties: true,
};
export const extensionEventPayloadBaseSchema: JsonSchema = { $schema: "https://json-schema.org/draft/2020-12/schema", $id: id("events/extension-base"), type: "object" };

export const eventEnvelopeSchema: JsonSchema = strict(id("event"), ["schema_version", "event_id", "event_type", "sequence", "occurred_at", "recorded_at", "actor", "recorded_by", "data"], {
  ...version, event_id: identifier("evt"), event_type: string("^[a-z][a-z0-9_-]*(?:\\.[a-z][a-z0-9_-]*)+$"), sequence: positiveInteger,
  occurred_at: nullableTimestamp, recorded_at: timestamp, actor, recorded_by: actor,
  assignment_id: identifier("asn"), task_id: identifier("tsk"), execution_id: identifier("exe"), action_id: identifier("act"),
  subject: ref, caused_by_event_id: identifier("evt"),
  provider_context: strict("#provider-context", ["provider"], { provider: string(), session_id: string(), process_id: string(), task_id: string() }),
  data: { type: "object" }, artifact_refs: { type: "array", items: ref },
});

const concreteOutcome = { enum: ["succeeded", "failed", "prevented", "cancelled"] } as JsonSchema;

export const recordSchemas: Record<CoreRecordType, JsonSchema> = {
  configuration: strict(id("config"), ["schemaVersion", "framework", "state", "approvals", "intentLogging", "referenceValidation", "heartbeat", "retention", "execution", "roles", "materiality", "models", "providers", "security"], {
    $schema: string(), schemaVersion: { const: "1.0" },
    framework: strict("#config-framework", ["minimumVersion"], { minimumVersion: string("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$") }),
    state: strict("#config-state", ["directory"], { directory: string() }),
    approvals: strict("#config-approvals", ["initialPlan", "resumePlan", "materialPlanChange"], { initialPlan: { enum: ["required", "not_required"] }, resumePlan: { enum: ["required", "not_required"] }, materialPlanChange: { enum: ["required", "not_required"] } }),
    intentLogging: strict("#config-intent", ["retryCount", "backoffSeconds"], { retryCount: { type: "integer", minimum: 0 }, backoffSeconds: { type: "array", items: { type: "number", minimum: 0 } } }),
    referenceValidation: strict("#config-reference", ["retrySeconds", "timeoutSeconds"], { retrySeconds: { type: "array", items: { type: "number", minimum: 0 } }, timeoutSeconds: positiveInteger }),
    heartbeat: strict("#config-heartbeat", ["enabled", "intervalSeconds"], { enabled: { type: "boolean" }, intervalSeconds: positiveInteger }),
    retention: strict("#config-retention", ["rawResponsesDays", "closedAssignmentsDays", "permanentArchiveDeletion"], { rawResponsesDays: { type: "integer", minimum: 0 }, closedAssignmentsDays: { type: "integer", minimum: 0 }, permanentArchiveDeletion: { const: false } }),
    execution: strict("#config-execution", ["defaultInterruptionMode", "automaticForceEscalation"], { defaultInterruptionMode: { enum: ["graceful", "force"] }, automaticForceEscalation: { const: false } }),
    roles: strict("#config-roles", ["enabled"], { enabled: stringArray }),
    materiality: strict("#config-materiality", ["alwaysMaterial", "delegatedChanges", "cumulativeChangeThreshold", "ambiguityBehavior"], { alwaysMaterial: stringArray, delegatedChanges: stringArray, cumulativeChangeThreshold: positiveInteger, ambiguityBehavior: { const: "hold_affected_work" } }),
    models: strict("#config-models", ["selectionAuthority", "fallback", "roles"], { selectionAuthority: { type: "array", items: { enum: ["executive", "manager_policy"] }, uniqueItems: true }, fallback: { enum: ["require_authorization", "reject"] }, roles: { type: "object", additionalProperties: strict("#config-model-policy", ["allowed"], { allowed: stringArray }) } }),
    providers: { type: "object", additionalProperties: strict("#config-provider", ["enabled"], { enabled: { type: "boolean" }, captureRawResponses: { type: "boolean", default: false } }) },
    security: strict("#config-security", ["stateRootContainment", "secretRedaction", "executeRecordContent", "executiveApproval"], { stateRootContainment: { const: true }, secretRedaction: { const: true }, executeRecordContent: { const: false }, executiveApproval: strict("#config-executive-approval", ["mode", "trustedPublicKeys", "receiptMaxAgeSeconds"], { mode: { enum: ["record_only", "signed_ed25519"] }, trustedPublicKeys: { type: "object", additionalProperties: string() }, receiptMaxAgeSeconds: positiveInteger }) }),
  }),
  assignment: { ...recordBase("assignment", ["assignment_id", "objective", "lifecycle_state", "execution_authority", "ownership", "policy_snapshot"], {
    assignment_id: identifier("asn"), objective: string(), scope: stringArray, constraints: stringArray, acceptance_criteria: stringArray,
    lifecycle_state: { enum: ["planning", "awaiting_approval", "running", "blocked", "pausing", "paused", "handing_over", "handover_ready", "cancelling", "closed"] },
    closure_disposition: { enum: ["completed", "cancelled"] }, execution_authority: { enum: ["unauthorized", "authorized", "held"] },
    current_plan_id: identifier("pln"), ownership: strict("#ownership", ["manager_instance_id"], { manager_instance_id: identifier("mgr"), lease_expires_at: timestamp }),
    policy_snapshot: { type: "object" }, task_ids: { type: "array", items: identifier("tsk"), uniqueItems: true }, checkpoint_id: identifier(),
    pending_action_ids: { type: "array", items: identifier("act"), uniqueItems: true }, holds: stringArray,
    nonmaterial_change_count: { type: "integer", minimum: 0 },
    closure_history: { type: "array", items: strict("#closure-history", ["disposition", "closed_at"], { disposition: { enum: ["completed", "cancelled"] }, closed_at: timestamp }) },
  }), allOf: [{ if: { type: "object", properties: { lifecycle_state: { const: "closed" } }, required: ["lifecycle_state"] }, then: { required: ["closure_disposition"] } }] },
  plan: recordBase("plan", ["plan_id", "assignment_id", "revision", "purpose", "lifecycle", "approach", "acceptance_criteria"], {
    plan_id: identifier("pln"), assignment_id: identifier("asn"), revision: positiveInteger, purpose: { enum: ["initial", "continuation", "steer"] }, lifecycle: { enum: ["draft", "proposed", "active", "superseded"] }, approach: stringArray, acceptance_criteria: stringArray, dependencies: stringArray, gates: stringArray, risks: stringArray, assumptions: stringArray, unresolved: stringArray, prior_plan_id: identifier("pln"),
  }),
  checkpoint: recordBase("checkpoint", ["checkpoint_id", "assignment_id", "kind", "summary"], { checkpoint_id: identifier(), assignment_id: identifier("asn"), kind: { enum: ["resume", "pause", "handover", "progress"] }, summary: string(), unresolved_action_ids: { type: "array", items: identifier("act") } }),
  "work-item": recordBase("work-item", ["work_item_id", "assignment_id", "title"], { work_item_id: identifier(), assignment_id: identifier("asn"), title: string(), external_ref: string(), task_ids: { type: "array", items: identifier("tsk") } }),
  task: recordBase("task", ["task_id", "assignment_id", "state", "affected_paths", "execution_ids", "result_ids"], {
    task_id: identifier("tsk"), assignment_id: identifier("asn"), state: { enum: ["draft", "ready", "dispatched", "running", "blocked", "result_submitted", "rework", "accepted", "closed", "cancelled"] },
    affected_paths: stringArray, execution_ids: { type: "array", items: identifier("exe"), uniqueItems: true }, result_ids: { type: "array", items: identifier(), uniqueItems: true },
  }),
  "task-packet": recordBase("task-packet", ["task_id", "execution_id", "assignment_id", "objective", "scope", "exclusions", "acceptance_criteria", "permissions", "constraints", "expected_outputs", "requested_model"], {
    task_id: identifier("tsk"), execution_id: identifier("exe"), assignment_id: identifier("asn"), parent_task_id: identifier("tsk"), objective: string(), purpose: string(), scope: stringArray, exclusions: stringArray,
    acceptance_criteria: { type: "array", items: strict("#criterion", ["id", "text"], { id: identifier(), text: string() }) }, authoritative_inputs: { type: "array", items: ref }, starting_point: string(), permissions: stringArray, constraints: stringArray, dependencies: { type: "array", items: ref }, expected_outputs: stringArray, evidence_requirements: stringArray, escalation_conditions: stringArray, stopping_conditions: stringArray, requested_model: modelSelection, actual_model: modelSelection,
  }),
  execution: recordBase("execution", ["execution_id", "task_id", "assignment_id", "attempt", "state"], { execution_id: identifier("exe"), task_id: identifier("tsk"), assignment_id: identifier("asn"), attempt: positiveInteger, state: { enum: ["ready", "running", "completed", "failed", "cancelled", "unknown"] }, requested_model: modelSelection, actual_model: modelSelection, provider_execution_id: string(), result_id: identifier() }),
  action: recordBase("action", ["action_id", "assignment_id", "description", "outcome"], { action_id: identifier("act"), assignment_id: identifier("asn"), task_id: identifier("tsk"), execution_id: identifier("exe"), description: string(), consequential: { type: "boolean" }, outcome: { enum: ["requested", "started", "succeeded", "failed", "prevented", "cancelled", "unknown"] }, intent_event_id: identifier("evt"), outcome_event_id: identifier("evt") }),
  result: recordBase("result", ["result_id", "assignment_id", "task_id", "execution_id", "delivery_status", "summary"], { result_id: identifier(), assignment_id: identifier("asn"), task_id: identifier("tsk"), execution_id: identifier("exe"), delivery_status: { enum: ["complete", "partial", "failed"] }, summary: string(), artifact_refs: { type: "array", items: ref }, evidence_refs: { type: "array", items: identifier() } }),
  assessment: recordBase("assessment", ["assessment_id", "assignment_id", "subject", "classification", "rationale"], { assessment_id: identifier(), assignment_id: identifier("asn"), subject: ref, classification: { enum: ["nonmaterial", "material", "ambiguous"] }, rationale: string(), cumulative_change_count: { type: "integer", minimum: 0 }, affected_paths: stringArray, code: string() }),
  approval: { ...recordBase("approval", ["approval_id", "assignment_id", "subject", "subject_revision", "state", "approver", "scope"], { approval_id: identifier("apr"), assignment_id: identifier("asn"), subject: ref, subject_revision: positiveInteger, state: { enum: ["requested", "granted", "rejected", "revoked", "expired", "waived"] }, approver: actor, scope: string(), granted_at: timestamp, expires_at: timestamp, waiver_authority: actor, verification: strict("#approval-verification", ["mode"], { mode: { enum: ["record_only", "signed_ed25519"] }, key_id: string(), receipt_digest: string("^sha256:[A-Fa-f0-9]{64}$") }) }), allOf: [
    { if: { type: "object", properties: { state: { const: "granted" } }, required: ["state"] }, then: { required: ["granted_at"] } },
    { if: { type: "object", properties: { state: { const: "waived" } }, required: ["state"] }, then: { required: ["waiver_authority"] } },
  ] },
  decision: recordBase("decision", ["decision_id", "assignment_id", "subject", "choice", "rationale", "decided_by"], { decision_id: identifier("dec"), assignment_id: identifier("asn"), subject: ref, choice: string(), rationale: string(), decided_by: actor }),
  evidence: recordBase("evidence", ["evidence_id", "assignment_id", "subject", "kind", "location", "digest"], { evidence_id: identifier("evd"), assignment_id: identifier("asn"), subject: ref, kind: string(), location: string(), digest: string("^[A-Za-z0-9]+:[A-Fa-f0-9]+$") }),
  escalation: recordBase("escalation", ["escalation_id", "assignment_id", "subject", "status", "reason"], { escalation_id: identifier(), assignment_id: identifier("asn"), subject: ref, status: { enum: ["open", "resolved"] }, reason: string(), resolution: string() }),
  pending: recordBase("pending", ["pending_id", "action_id", "assignment_id", "status"], { pending_id: identifier(), action_id: identifier("act"), assignment_id: identifier("asn"), status: { const: "unresolved" }, observed_outcome: { const: "unknown" }, reconciled_outcome: concreteOutcome }),
  quarantine: { ...recordBase("quarantine", ["quarantine_id", "submission", "validation_errors", "status"], { quarantine_id: identifier(), submission: {}, validation_errors: { type: "array", items: strict("#quarantine-error", ["code", "message", "instance_path"], { code: string(), message: string(), instance_path: { type: "string" }, schema_path: { type: "string" } }) }, status: { enum: ["unresolved", "resolved"] }, resolution: string() }), allOf: [{ if: { type: "object", properties: { status: { const: "resolved" } }, required: ["status"] }, then: { required: ["resolution"] } }] },
  hold: recordBase("hold", ["hold_id", "targets", "placed_by", "reason", "scope", "status"], { hold_id: identifier(), targets: { type: "array", items: ref }, placed_by: actor, reason: string(), scope: { enum: ["archive", "delete", "archive_and_delete"] }, status: { enum: ["active", "released", "expired"] }, expires_at: timestamp, released_at: timestamp }),
  "archive-manifest": recordBase("archive-manifest", ["manifest_id", "batch_id", "entries", "status"], { manifest_id: identifier(), batch_id: identifier(), entries: { type: "array", items: strict("#archive-entry", ["record", "source", "destination", "digest"], { record: ref, source: string(), destination: string(), digest: string() }) }, status: { enum: ["prepared", "verified", "published", "failed"] } }),
  "cleanup-manifest": recordBase("cleanup-manifest", ["manifest_id", "mode", "entries", "status"], { manifest_id: identifier(), mode: { enum: ["dry-run", "apply"] }, entries: { type: "array", items: strict("#cleanup-entry", ["target", "reason"], { target: string(), reason: string(), digest: string() }) }, status: { enum: ["planned", "completed", "failed"] } }),
  "awaiting-validation": recordBase("awaiting-validation", ["submission_id", "deadline_at", "retry_seconds", "attempted_at", "next_retry_at", "missing_references", "validation_errors", "submission"], {
    submission_id: identifier(), deadline_at: timestamp, retry_seconds: { type: "array", items: { type: "number", minimum: 0 } }, attempted_at: { type: "array", items: timestamp }, next_retry_at: nullableTimestamp,
    missing_references: stringArray, validation_errors: { type: "array", items: strict("#awaiting-error", ["code", "message", "instance_path"], { code: string(), message: string(), instance_path: { type: "string" }, schema_path: { type: "string" } }) }, submission: {},
  }),
  "action-reconciliation": recordBase("action-reconciliation", ["reconciliation_id", "action_id", "assignment_id", "operation_id", "outcome", "reconciled_at", "rationale"], {
    reconciliation_id: identifier(), action_id: identifier("act"), assignment_id: identifier("asn"), operation_id: identifier(), outcome: concreteOutcome, reconciled_at: timestamp, rationale: string(), evidence_refs: stringArray,
  }),
  "raw-response": recordBase("raw-response", ["response_id", "provider", "source_event", "captured_at", "retention_until", "content"], {
    response_id: identifier(), provider: string(), source_event: string(), captured_at: timestamp, retention_until: timestamp, assignment_id: identifier("asn"), task_id: identifier("tsk"), execution_id: identifier("exe"), content: {},
  }),
};

if (Object.keys(recordSchemas).length !== CORE_RECORD_TYPES.length) throw new Error("Core record schema catalogue is incomplete.");

function payloadFor(eventType: string): JsonSchema {
  const properties: Record<string, JsonSchema> = { message: string(), reason: string(), status: string(), record_ref: ref, error: { type: "object" }, details: { type: "object" } };
  let required: string[] = [];
  if (eventType.startsWith("manager.command_")) {
    properties.command_id = identifier(); properties.command = { enum: [...MANAGED_WORKFLOW_COMMANDS] }; required = ["command_id", "command"];
  } else if (["manager.question_received", "manager.answer_provided", "manager.status_reported"].includes(eventType)) {
    required = ["message"];
  } else if (eventType === "provider.signal_observed") {
    properties.provider = string(); properties.signal = string(); required = ["provider", "signal"];
  } else if (eventType.startsWith("execution.")) {
    properties.execution_id = identifier("exe"); required = ["execution_id"];
  } else if (eventType.startsWith("action.")) {
    properties.action_id = identifier("act"); required = ["action_id"];
  } else if (eventType.startsWith("submission.")) {
    properties.submission_id = identifier(); required = ["submission_id"];
  } else if (eventType === "runtime.operation_blocked") {
    properties.operation_id = identifier(); required = ["operation_id", "reason"];
  } else {
    required = ["record_ref"];
  }
  return strict(id(`events/${eventType}`), required, properties);
}
export const eventPayloadSchemas = Object.fromEntries(CORE_EVENT_TYPES.map((eventType) => [eventType, payloadFor(eventType)])) as Record<(typeof CORE_EVENT_TYPES)[number], JsonSchema>;

// Payload constraints with semantics that are core invariants.
eventPayloadSchemas["action.reconciled"] = strict(id("events/action.reconciled"), ["action_id", "concrete_outcome"], { action_id: identifier("act"), concrete_outcome: concreteOutcome, rationale: string() });
eventPayloadSchemas["action.outcome_unknown"] = strict(id("events/action.outcome_unknown"), ["action_id", "outcome"], { action_id: identifier("act"), outcome: { const: "unknown" }, reason: string() });
for (const terminal of ["succeeded", "failed", "prevented", "cancelled"] as const) eventPayloadSchemas[`action.${terminal}`] = strict(id(`events/action.${terminal}`), ["action_id", "outcome"], { action_id: identifier("act"), outcome: { const: terminal }, reason: string() });
eventPayloadSchemas["approval.requested"] = strict(id("events/approval.requested"), ["approval_id", "subject", "subject_revision"], { approval_id: identifier("apr"), subject: ref, subject_revision: positiveInteger });
eventPayloadSchemas["event.corrected"] = strict(id("events/event.corrected"), ["corrected_event_id", "correction"], { corrected_event_id: identifier("evt"), correction: { type: "object" }, reason: string() });

export const coreSchemas = [eventEnvelopeSchema, extensionRecordBaseSchema, extensionEventPayloadBaseSchema, ...Object.values(recordSchemas), ...Object.values(eventPayloadSchemas)];
