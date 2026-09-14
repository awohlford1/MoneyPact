import path from "node:path";
import { writeJsonImmutableIdempotent } from "../storage/atomic.ts";
import type { JsonValue } from "../storage/types.ts";
import { assertPortableId } from "../storage/layout.ts";
import { assertValidCoreRecord } from "../validation/persistence.ts";

const SECRET_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:sk|pk|ghp|github_pat|xox[baprs])-[-a-z0-9_]{8,})/gi;

export function redactRawResponse(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(redactRawResponse);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redactRawResponse(item)]));
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
  if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return String(value);
  return value as JsonValue;
}

export interface PersistRawResponseInput {
  responseId: string;
  provider: string;
  sourceEvent: string;
  content: unknown;
  capturedAt?: Date;
  retentionDays?: number;
  assignmentId?: string;
  taskId?: string;
  executionId?: string;
}

/** The only supported raw-response persistence path: opt-in callers get redaction, schema validation, and retention metadata. */
export async function persistRedactedRawResponse(stateRoot: string, input: PersistRawResponseInput): Promise<string> {
  assertPortableId(input.responseId, "response ID");
  const capturedAt = input.capturedAt ?? new Date();
  const retentionDays = input.retentionDays ?? 7;
  if (!Number.isInteger(retentionDays) || retentionDays < 0) throw new Error("retentionDays must be a non-negative integer");
  const record = {
    schema_version: "1.0", record_id: input.responseId, record_type: "raw-response", created_at: capturedAt.toISOString(),
    response_id: input.responseId, provider: input.provider, source_event: input.sourceEvent, captured_at: capturedAt.toISOString(),
    retention_until: new Date(capturedAt.getTime() + retentionDays * 86_400_000).toISOString(), content: redactRawResponse(input.content),
    ...(input.assignmentId ? { assignment_id: input.assignmentId } : {}), ...(input.taskId ? { task_id: input.taskId } : {}), ...(input.executionId ? { execution_id: input.executionId } : {}),
  };
  assertValidCoreRecord("raw-response", record);
  return writeJsonImmutableIdempotent(stateRoot, path.join("raw-responses", `${input.responseId}.json`), record as JsonValue);
}
