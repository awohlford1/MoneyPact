import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic, writeJsonImmutableIdempotent } from "../storage/atomic.ts";
import { storageError } from "../storage/errors.ts";
import { assertContainedStatePath, assertPortableId } from "../storage/layout.ts";
import type { JsonValue, ValidationFailure } from "../storage/types.ts";
import { quarantineSubmission } from "./quarantine.ts";
import { assertValidCoreRecord } from "../validation/persistence.ts";

export interface AwaitingValidationRecord {
  schema_version: "1.0";
  record_id: string;
  record_type: "awaiting-validation";
  created_at: string;
  submission_id: string;
  deadline_at: string;
  retry_seconds: number[];
  attempted_at: string[];
  next_retry_at: string | null;
  missing_references: string[];
  validation_errors: PersistedValidationFailure[];
  submission: JsonValue;
}

export type ReferenceValidationResult =
  | { status: "accepted" }
  | { status: "missing_reference"; missingReferences: string[]; errors: ValidationFailure[] }
  | { status: "rejected"; errors: ValidationFailure[] };

export interface QuarantineRecord {
  schema_version: "1.0";
  record_id: string;
  record_type: "quarantine";
  created_at: string;
  updated_at?: string;
  quarantine_id: string;
  submission: JsonValue;
  validation_errors: PersistedValidationFailure[];
  status: "unresolved" | "resolved";
  resolution?: string;
}

export interface PersistedValidationFailure {
  code: string;
  message: string;
  instance_path: string;
  schema_path?: string;
}

function persistedFailures(errors: ValidationFailure[]): PersistedValidationFailure[] {
  return errors.map((error) => ({
    code: error.keyword ?? "validation_error",
    message: error.message,
    instance_path: error.path,
  }));
}

const awaitingRelative = (id: string): string => path.join("awaiting-validation", `${id}.json`);

export async function createAwaitingValidation(
  stateRoot: string,
  input: {
    submissionId: string; original: JsonValue; missingReferences: string[];
    errors: ValidationFailure[]; now?: Date; retrySeconds?: number[]; timeoutSeconds?: number;
  },
): Promise<AwaitingValidationRecord> {
  assertPortableId(input.submissionId, "submission ID");
  const now = input.now ?? new Date();
  const retries = input.retrySeconds ?? [5, 15, 30];
  const record: AwaitingValidationRecord = {
    schema_version: "1.0", record_id: input.submissionId, record_type: "awaiting-validation", created_at: now.toISOString(), submission_id: input.submissionId,
    deadline_at: new Date(now.getTime() + (input.timeoutSeconds ?? 60) * 1000).toISOString(),
    retry_seconds: retries, attempted_at: [],
    next_retry_at: retries[0] === undefined ? null : new Date(now.getTime() + retries[0] * 1000).toISOString(),
    missing_references: input.missingReferences, validation_errors: persistedFailures(input.errors), submission: input.original,
  };
  assertValidCoreRecord("awaiting-validation", record);
  await writeJsonImmutableIdempotent(stateRoot, awaitingRelative(input.submissionId), record as unknown as JsonValue);
  return record;
}

export async function readAwaitingValidation(stateRoot: string, submissionId: string): Promise<AwaitingValidationRecord | undefined> {
  assertPortableId(submissionId, "submission ID");
  const filename = await assertContainedStatePath(stateRoot, awaitingRelative(submissionId));
  try { return JSON.parse(await readFile(filename, "utf8")) as AwaitingValidationRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function quarantine(stateRoot: string, record: AwaitingValidationRecord, now: Date, reason: "validation_rejected" | "validation_timeout", errors: ValidationFailure[] | PersistedValidationFailure[]): Promise<QuarantineRecord> {
  const normalizedErrors = errors.map((error) => "instance_path" in error ? error : persistedFailures([error])[0]!);
  const quarantineRecord: QuarantineRecord = {
    schema_version: "1.0", record_id: record.submission_id, record_type: "quarantine", created_at: now.toISOString(), quarantine_id: record.submission_id,
    submission: record.submission, status: "unresolved",
    validation_errors: normalizedErrors.length > 0 ? normalizedErrors : [{ code: reason, message: reason === "validation_timeout" ? "Reference validation deadline elapsed." : "Submission validation failed.", instance_path: "" }],
  };
  await quarantineSubmission(stateRoot, quarantineRecord);
  await rm(await assertContainedStatePath(stateRoot, awaitingRelative(record.submission_id)));
  return quarantineRecord;
}

export async function retryAwaitingValidation(
  stateRoot: string,
  submissionId: string,
  validate: (original: JsonValue) => Promise<ReferenceValidationResult> | ReferenceValidationResult,
  accept: (original: JsonValue) => Promise<void>,
  options: { now?: Date; triggeredByReferenceArrival?: boolean } = {},
): Promise<{ status: "accepted" | "awaiting_validation" | "quarantined"; record?: AwaitingValidationRecord | QuarantineRecord }> {
  const record = await readAwaitingValidation(stateRoot, submissionId);
  if (record === undefined) throw storageError("STATE_RECORD_NOT_FOUND", `Awaiting-validation submission not found: ${submissionId}`);
  const now = options.now ?? new Date();
  if (now.getTime() >= Date.parse(record.deadline_at)) {
    return { status: "quarantined", record: await quarantine(stateRoot, record, now, "validation_timeout", record.validation_errors) };
  }
  if (!options.triggeredByReferenceArrival && record.next_retry_at !== null && now.getTime() < Date.parse(record.next_retry_at)) {
    return { status: "awaiting_validation", record };
  }
  const result = await validate(record.submission);
  if (result.status === "accepted") {
    await accept(record.submission);
    await rm(await assertContainedStatePath(stateRoot, awaitingRelative(submissionId)));
    return { status: "accepted" };
  }
  if (result.status === "rejected") {
    return { status: "quarantined", record: await quarantine(stateRoot, record, now, "validation_rejected", result.errors) };
  }
  const attemptIndex = record.attempted_at.length;
  const nextDelay = record.retry_seconds[attemptIndex + 1];
  const updated: AwaitingValidationRecord = {
    ...record, attempted_at: [...record.attempted_at, now.toISOString()],
    next_retry_at: nextDelay === undefined ? record.deadline_at : new Date(now.getTime() + nextDelay * 1000).toISOString(),
    missing_references: result.missingReferences, validation_errors: persistedFailures(result.errors),
  };
  assertValidCoreRecord("awaiting-validation", updated);
  await writeJsonAtomic(stateRoot, awaitingRelative(submissionId), updated as unknown as JsonValue);
  return { status: "awaiting_validation", record: updated };
}

export async function processDueAwaitingValidation(
  stateRoot: string,
  submissionIds: string[],
  validate: (original: JsonValue) => Promise<ReferenceValidationResult> | ReferenceValidationResult,
  accept: (original: JsonValue) => Promise<void>,
  now = new Date(),
): Promise<Array<{ submissionId: string; status: "accepted" | "awaiting_validation" | "quarantined" }>> {
  const outcomes = [];
  for (const submissionId of submissionIds) {
    const result = await retryAwaitingValidation(stateRoot, submissionId, validate, accept, { now });
    outcomes.push({ submissionId, status: result.status });
  }
  return outcomes;
}
