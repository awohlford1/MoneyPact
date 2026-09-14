import type { JsonSchema, SchemaIssue, ValidationResult } from "./types.ts";

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export function validateJsonSchema<T>(schemaId: string, version: string, schema: JsonSchema, value: unknown): ValidationResult<T> {
  const errors: SchemaIssue[] = [];
  visit(schema, value, "", "#", errors);
  return { valid: errors.length === 0, ...(errors.length ? {} : { value: value as T }), errors, schemaId, schemaVersion: version };
}

function issue(errors: SchemaIssue[], code: SchemaIssue["code"], message: string, instancePath: string, schemaPath: string, details?: Record<string, unknown>): void {
  errors.push({ code, message, instancePath: instancePath || "", schemaPath, ...(details ? { details } : {}) });
}

function ptr(path: string, key: string | number): string {
  const escaped = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${escaped}`;
}

function visit(schema: JsonSchema, value: unknown, path: string, schemaPath: string, errors: SchemaIssue[]): void {
  if (Array.isArray(schema.allOf)) for (let i = 0; i < schema.allOf.length; i++) visit(schema.allOf[i] as JsonSchema, value, path, `${schemaPath}/allOf/${i}`, errors);
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => { const local: SchemaIssue[] = []; visit(candidate as JsonSchema, value, path, schemaPath, local); return local.length === 0; });
    if (matches.length !== 1) issue(errors, "SCHEMA_CONSTRAINT", "Value must match exactly one allowed shape.", path, `${schemaPath}/oneOf`);
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) issue(errors, "SCHEMA_ENUM", `Expected constant ${JSON.stringify(schema.const)}.`, path, `${schemaPath}/const`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) issue(errors, "SCHEMA_ENUM", "Value is not in the allowed set.", path, `${schemaPath}/enum`, { allowed: schema.enum });
  if (schema.type !== undefined && !matchesType(schema.type, value)) { issue(errors, "SCHEMA_TYPE", `Expected ${String(schema.type)}.`, path, `${schemaPath}/type`); return; }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issue(errors, "SCHEMA_CONSTRAINT", `String must have at least ${schema.minLength} characters.`, path, `${schemaPath}/minLength`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) issue(errors, "SCHEMA_PATTERN", "String does not match the required pattern.", path, `${schemaPath}/pattern`);
    if (schema.format === "date-time" && !UTC.test(value)) issue(errors, "SCHEMA_FORMAT", "Timestamp must be RFC 3339 UTC using a Z suffix.", path, `${schemaPath}/format`);
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) issue(errors, "SCHEMA_CONSTRAINT", `Number must be >= ${schema.minimum}.`, path, `${schemaPath}/minimum`);
  if (Array.isArray(value)) {
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) issue(errors, "SCHEMA_CONSTRAINT", "Array entries must be unique.", path, `${schemaPath}/uniqueItems`);
    if (schema.items && typeof schema.items === "object") value.forEach((entry, index) => visit(schema.items as JsonSchema, entry, ptr(path, index), `${schemaPath}/items`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const required of (schema.required ?? []) as string[]) if (!(required in object)) issue(errors, "SCHEMA_REQUIRED", `Missing required property ${required}.`, ptr(path, required), `${schemaPath}/required`, { property: required });
    for (const [key, entry] of Object.entries(object)) {
      if (properties[key]) visit(properties[key], entry, ptr(path, key), `${schemaPath}/properties/${key}`, errors);
      else if (schema.additionalProperties === false) issue(errors, "SCHEMA_ADDITIONAL_PROPERTY", `Unknown property ${key}.`, ptr(path, key), `${schemaPath}/additionalProperties`, { property: key });
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") visit(schema.additionalProperties as JsonSchema, entry, ptr(path, key), `${schemaPath}/additionalProperties`, errors);
    }
    if (schema.if && typeof schema.if === "object") {
      const local: SchemaIssue[] = []; visit(schema.if as JsonSchema, value, path, `${schemaPath}/if`, local);
      const branch = local.length === 0 ? schema.then : schema.else;
      if (branch && typeof branch === "object") visit(branch as JsonSchema, value, path, local.length === 0 ? `${schemaPath}/then` : `${schemaPath}/else`, errors);
    }
  }
}

function matchesType(type: unknown, value: unknown): boolean {
  if (Array.isArray(type)) return type.some((entry) => matchesType(entry, value));
  switch (type) {
    case "null": return value === null;
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    default: return true;
  }
}
