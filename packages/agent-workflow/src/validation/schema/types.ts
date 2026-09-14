export type JsonSchema = Readonly<Record<string, unknown>>;

export interface SchemaIssue {
  code: "SCHEMA_REQUIRED" | "SCHEMA_TYPE" | "SCHEMA_FORMAT" | "SCHEMA_ENUM" |
    "SCHEMA_PATTERN" | "SCHEMA_ADDITIONAL_PROPERTY" | "SCHEMA_CONSTRAINT" |
    "SCHEMA_NOT_FOUND" | "SCHEMA_VERSION_UNSUPPORTED" | "EVENT_TYPE_UNREGISTERED";
  message: string;
  instancePath: string;
  schemaPath: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  value?: T;
  errors: readonly SchemaIssue[];
  schemaId: string;
  schemaVersion: string;
}

export interface RegisteredSchema {
  id: string;
  version: string;
  schema: JsonSchema;
  kind: "core" | "extension";
  baseSchemaId?: string;
}
