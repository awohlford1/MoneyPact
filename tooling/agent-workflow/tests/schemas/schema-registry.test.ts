import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CORE_EVENT_TYPES, CORE_RECORD_TYPES, SchemaRegistry, SchemaRegistryError, coreSchemaRegistry } from "../../src/registries/index.ts";
import { eventEnvelopeSchema, extensionRecordBaseSchema } from "../../src/validation/schema/index.ts";
import { MANAGED_WORKFLOW_COMMANDS } from "../../src/contracts/index.ts";

const examples = new URL("../../examples/records/", import.meta.url);
const json = async (name: string) => JSON.parse(await readFile(new URL(name, examples), "utf8"));

test("AW-01 default configuration satisfies the published configuration schema", async () => {
  const config = JSON.parse(await readFile(new URL("../../defaults/config.json", import.meta.url), "utf8"));
  assert.equal(coreSchemaRegistry.validateRecord("configuration", config).valid, true);
});

test("catalogue contains a schema for every core type", () => {
  assert.deepEqual(new Set(coreSchemaRegistry.eventTypes()), new Set(CORE_EVENT_TYPES));
  assert.deepEqual(new Set(coreSchemaRegistry.recordTypes()), new Set(CORE_RECORD_TYPES));
});

test("manager event schemas accept every managed CLI command", () => {
  for (const command of MANAGED_WORKFLOW_COMMANDS) {
    const result = coreSchemaRegistry.validateEvent({
      schema_version: "1.0",
      event_id: `evt-${command}`,
      event_type: "manager.command_received",
      occurred_at: "2026-09-13T12:00:00Z",
      sequence: 1,
      recorded_at: "2026-09-13T12:00:01Z",
      actor: { actor_id: "manager-test", actor_type: "manager" },
      recorded_by: { actor_id: "runtime-test", actor_type: "runtime" },
      data: { command_id: `cmd-${command}`, command },
    });
    assert.equal(result.valid, true, `${command}: ${JSON.stringify(result.errors)}`);
  }
});

test("valid assignment and event examples pass", async () => {
  assert.equal(coreSchemaRegistry.validateRecord("assignment", await json("valid-assignment.json")).valid, true);
  assert.equal(coreSchemaRegistry.validateEvent(await json("valid-event.json")).valid, true);
});

test("invalid fixture fails at the intended JSON pointer", async () => {
  const result = coreSchemaRegistry.validateRecord("pending", await json("invalid-pending-unknown-reconciliation.json"));
  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "SCHEMA_ENUM");
  assert.equal(result.errors[0]?.instancePath, "/reconciled_outcome");
});

test("event sequence and UTC timestamps are constrained", async () => {
  const event = await json("valid-event.json");
  event.sequence = 0;
  event.recorded_at = "2026-09-13T08:00:00-04:00";
  const result = coreSchemaRegistry.validateEvent(event);
  assert.ok(result.errors.some((error) => error.instancePath === "/sequence"));
  assert.ok(result.errors.some((error) => error.instancePath === "/recorded_at"));
});

test("unregistered namespaced event types return a stable error", async () => {
  const event = await json("valid-event.json");
  event.event_type = "example.workflow.unregistered";
  const result = coreSchemaRegistry.validateEvent(event);
  assert.equal(result.errors[0]?.code, "EVENT_TYPE_UNREGISTERED");
});

test("unknown core properties are rejected", async () => {
  const assignment = await json("valid-assignment.json");
  assignment.surprise = true;
  const result = coreSchemaRegistry.validateRecord("assignment", assignment);
  assert.equal(result.errors[0]?.code, "SCHEMA_ADDITIONAL_PROPERTY");
  assert.equal(result.errors[0]?.instancePath, "/surprise");
});

test("version mismatch is stable and explicit", async () => {
  const result = coreSchemaRegistry.validateRecord("assignment", await json("valid-assignment.json"), "2.0");
  assert.equal(result.errors[0]?.code, "SCHEMA_VERSION_UNSUPPORTED");
});

test("conditional requirements are enforced", () => {
  const approval = { schema_version: "1.0", record_id: "apr-example", record_type: "approval", created_at: "2026-09-13T12:00:00Z", approval_id: "apr-example", subject: { record_type: "plan", record_id: "pln-example", revision: 1 }, subject_revision: 1, state: "granted", approver: { actor_id: "executive-example", actor_type: "executive" }, scope: "plan revision 1" };
  const result = coreSchemaRegistry.validateRecord("approval", approval);
  assert.ok(result.errors.some((error) => error.instancePath === "/granted_at"));
});

test("duplicate core schema registration fails", () => {
  const registry = new SchemaRegistry();
  const schema = { $id: "https://example.test/duplicate", type: "object" };
  assert.throws(() => registry.registerExtension({ namespace: "example.workflow", eventType: "manager.command_received", schema, baseSchemaId: String(eventEnvelopeSchema.$id), version: "1.0" }), (error: unknown) => error instanceof SchemaRegistryError && error.code === "REGISTRY_CORE_REDEFINITION");
});

test("extensions are namespaced and cannot loosen their base", async () => {
  const registry = new SchemaRegistry();
  const extensionSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.test/schemas/strict-assignment.schema.json",
    type: "object",
    required: ["project_tag"],
    properties: { project_tag: { type: "string", minLength: 1 } }
  };
  registry.registerExtension({ namespace: "example.workflow", recordType: "example.workflow.assignment", schema: extensionSchema, baseSchemaId: String(extensionRecordBaseSchema.$id), version: "1.0" });
  const custom = { schema_version: "1.0", record_id: "example-1", record_type: "example.workflow.assignment", created_at: "2026-09-13T12:00:00Z", project_tag: "demo" };
  assert.equal(registry.validateRecord("example.workflow.assignment", custom).valid, true);
  assert.equal(registry.validateRecord("example.workflow.assignment", { ...custom, schema_version: "2.0" }).valid, false, "extension cannot loosen its mandatory base");
  assert.throws(() => registry.registerExtension({ namespace: "assignment", recordType: "assignment", schema: { ...extensionSchema, $id: "x" }, baseSchemaId: String(eventEnvelopeSchema.$id), version: "1.0" }), SchemaRegistryError);
});

test("duplicate extension IDs fail", () => {
  const registry = new SchemaRegistry();
  const schema = { $id: "https://example.test/schemas/event.schema.json", type: "object" };
  registry.registerExtension({ namespace: "example.workflow", eventType: "example.workflow.started", schema, baseSchemaId: String(eventEnvelopeSchema.$id), version: "1.0" });
  assert.throws(() => registry.registerExtension({ namespace: "example.workflow", eventType: "example.workflow.finished", schema, baseSchemaId: String(eventEnvelopeSchema.$id), version: "1.0" }), (error: unknown) => error instanceof SchemaRegistryError && error.code === "REGISTRY_DUPLICATE_SCHEMA");
});
