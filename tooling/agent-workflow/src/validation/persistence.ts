import { coreSchemaRegistry } from "../registries/index.ts";
import { storageError } from "../storage/errors.ts";

export function assertValidCoreRecord(recordType: string, value: unknown): void {
  const result = coreSchemaRegistry.validateRecord(recordType, value);
  if (!result.valid) {
    throw storageError("VALIDATION_REJECTED", `Invalid ${recordType} record`, { errors: result.errors });
  }
}
