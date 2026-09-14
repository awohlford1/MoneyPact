import { CORE_EVENT_TYPES, CORE_RECORD_TYPES, type CoreEventType, type CoreRecordType } from "./catalogue.ts";
import { coreSchemas, eventEnvelopeSchema, eventPayloadSchemas, recordSchemas, SCHEMA_VERSION } from "../validation/schema/core-schemas.ts";
import { validateJsonSchema } from "../validation/schema/validator.ts";
import type { JsonSchema, RegisteredSchema, SchemaIssue, ValidationResult } from "../validation/schema/types.ts";

export const REGISTRY_ERROR_CODES = [
  "REGISTRY_DUPLICATE_SCHEMA", "REGISTRY_DUPLICATE_CORE_TYPE", "REGISTRY_INVALID_NAMESPACE",
  "REGISTRY_CORE_REDEFINITION", "REGISTRY_EXTENSION_BASE_REQUIRED", "SCHEMA_NOT_FOUND",
  "SCHEMA_VERSION_UNSUPPORTED", "EVENT_TYPE_UNREGISTERED",
] as const;

export class SchemaRegistryError extends Error {
  readonly code: (typeof REGISTRY_ERROR_CODES)[number];
  constructor(code: (typeof REGISTRY_ERROR_CODES)[number], message: string) { super(message); this.name = "SchemaRegistryError"; this.code = code; }
}

export interface ExtensionRegistration {
  namespace: string;
  eventType?: string;
  recordType?: string;
  schema: JsonSchema;
  baseSchemaId: string;
  version: string;
}

export class SchemaRegistry {
  readonly #schemas = new Map<string, RegisteredSchema>();
  readonly #eventSchemas = new Map<string, string>();
  readonly #recordSchemas = new Map<string, string>();

  constructor(includeCore = true) {
    if (includeCore) this.registerCore();
  }

  private registerCore(): void {
    for (const schema of coreSchemas) this.add(schema, SCHEMA_VERSION, "core");
    for (const type of CORE_RECORD_TYPES) this.#recordSchemas.set(type, String(recordSchemas[type].$id));
    for (const type of CORE_EVENT_TYPES) this.#eventSchemas.set(type, String(eventPayloadSchemas[type].$id));
  }

  private add(schema: JsonSchema, version: string, kind: "core" | "extension", baseSchemaId?: string): void {
    const schemaId = schema.$id;
    if (typeof schemaId !== "string" || schemaId.length === 0) throw new SchemaRegistryError("SCHEMA_NOT_FOUND", "A registered schema requires a non-empty $id.");
    if (this.#schemas.has(schemaId)) throw new SchemaRegistryError(kind === "core" ? "REGISTRY_DUPLICATE_CORE_TYPE" : "REGISTRY_DUPLICATE_SCHEMA", `Schema ${schemaId} is already registered.`);
    this.#schemas.set(schemaId, { id: schemaId, version, schema, kind, ...(baseSchemaId ? { baseSchemaId } : {}) });
  }

  registerExtension(extension: ExtensionRegistration): void {
    const namespacePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
    if (!namespacePattern.test(extension.namespace)) throw new SchemaRegistryError("REGISTRY_INVALID_NAMESPACE", "Extension namespace must contain at least two dot-separated segments.");
    const type = extension.eventType ?? extension.recordType;
    if (!type) throw new SchemaRegistryError("REGISTRY_INVALID_NAMESPACE", "Extension registration requires an event or record type.");
    if ((CORE_EVENT_TYPES as readonly string[]).includes(type) || (CORE_RECORD_TYPES as readonly string[]).includes(type)) throw new SchemaRegistryError("REGISTRY_CORE_REDEFINITION", `Extension cannot redefine core type ${type}.`);
    if (!type.startsWith(`${extension.namespace}.`)) throw new SchemaRegistryError("REGISTRY_INVALID_NAMESPACE", "Extension type must begin with its namespace.");
    if (!this.#schemas.has(extension.baseSchemaId)) throw new SchemaRegistryError("REGISTRY_EXTENSION_BASE_REQUIRED", `Base schema ${extension.baseSchemaId} is not registered.`);
    this.add(extension.schema, extension.version, "extension", extension.baseSchemaId);
    const map = extension.eventType ? this.#eventSchemas : this.#recordSchemas;
    if (map.has(type)) throw new SchemaRegistryError("REGISTRY_DUPLICATE_SCHEMA", `Type ${type} is already registered.`);
    map.set(type, String(extension.schema.$id));
  }

  get(schemaId: string): RegisteredSchema | undefined { return this.#schemas.get(schemaId); }
  list(): readonly RegisteredSchema[] { return [...this.#schemas.values()]; }
  eventTypes(): readonly string[] { return [...this.#eventSchemas.keys()]; }
  recordTypes(): readonly string[] { return [...this.#recordSchemas.keys()]; }

  validate<T = unknown>(schemaId: string, value: unknown, version = SCHEMA_VERSION): ValidationResult<T> {
    const entry = this.#schemas.get(schemaId);
    if (!entry) return failure(schemaId, version, "SCHEMA_NOT_FOUND", `Schema ${schemaId} is not registered.`);
    if (entry.version !== version) return failure(schemaId, version, "SCHEMA_VERSION_UNSUPPORTED", `Schema ${schemaId} does not support version ${version}.`);
    const base = entry.baseSchemaId ? this.#schemas.get(entry.baseSchemaId) : undefined;
    const baseErrors = base ? this.validate(entry.baseSchemaId!, value, base.version).errors : [];
    const own = validateJsonSchema<T>(schemaId, version, entry.schema, value);
    const errors = [...baseErrors, ...own.errors];
    return errors.length ? { valid: false, schemaId, schemaVersion: version, errors } : own;
  }

  validateRecord<T = unknown>(recordType: string, value: unknown, version = SCHEMA_VERSION): ValidationResult<T> {
    const schemaId = this.#recordSchemas.get(recordType);
    return schemaId ? this.validate<T>(schemaId, value, version) : failure(recordType, version, "SCHEMA_NOT_FOUND", `Record type ${recordType} is not registered.`);
  }

  validateEvent<T = unknown>(value: unknown, version = SCHEMA_VERSION): ValidationResult<T> {
    const envelope = this.validate<T>(String(eventEnvelopeSchema.$id), value, version);
    if (!envelope.valid || value === null || typeof value !== "object") return envelope;
    const event = value as Record<string, unknown>;
    const payloadId = this.#eventSchemas.get(String(event.event_type));
    if (!payloadId) return failure(String(event.event_type), version, "EVENT_TYPE_UNREGISTERED", `Event type ${String(event.event_type)} is not registered.`);
    const payload = this.validate(payloadId, event.data, version);
    const errors = [...envelope.errors, ...payload.errors.map((error) => ({ ...error, instancePath: `/data${error.instancePath}` }))];
    const eventType = String(event.event_type);
    for (const field of conditionalEventReferences(eventType)) {
      if (!(field in event)) errors.push({ code: "SCHEMA_REQUIRED", message: `Event ${eventType} requires ${field}.`, instancePath: `/${field}`, schemaPath: "#/conditionalReferences", details: { property: field, eventType } });
    }
    return errors.length ? { valid: false, schemaId: envelope.schemaId, schemaVersion: version, errors } : envelope;
  }
}

function conditionalEventReferences(eventType: string): string[] {
  if (eventType.startsWith("task.")) return ["assignment_id", "task_id"];
  if (eventType.startsWith("execution.")) return ["assignment_id", "task_id", "execution_id"];
  if (eventType.startsWith("action.")) return ["assignment_id", "action_id"];
  if (eventType.startsWith("plan.") || eventType.startsWith("assignment.") || eventType.startsWith("result.") || eventType.startsWith("escalation.")) return ["assignment_id"];
  return [];
}

function failure<T>(schemaId: string, version: string, code: SchemaIssue["code"], message: string): ValidationResult<T> {
  return { valid: false, schemaId, schemaVersion: version, errors: [{ code, message, instancePath: "", schemaPath: "#" }] };
}

export const coreSchemaRegistry = new SchemaRegistry();
export type { CoreEventType, CoreRecordType };
