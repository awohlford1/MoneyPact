import type { ValidationResult } from "../validation/schema/types.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StructuralValidator<T = unknown> {
  validate(schemaId: string, value: unknown, version?: string): Promise<ValidationResult<T>> | ValidationResult<T>;
}

export interface ValidationFailure {
  path: string;
  keyword?: string;
  message: string;
}

export interface StoredRecord {
  record_type: string;
  record_id: string;
  revision?: number;
  assignment_id?: string;
  schema_version: string;
  [key: string]: JsonValue | undefined;
}

export interface ResolvedRecord<T extends StoredRecord = StoredRecord> {
  record: T;
  path: string;
  location: "active" | "archive";
}
