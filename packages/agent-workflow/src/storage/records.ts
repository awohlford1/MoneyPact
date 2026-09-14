import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic, writeJsonImmutableIdempotent } from "./atomic.ts";
import { storageError } from "./errors.ts";
import { assertContainedStatePath, assertPortableId, initializeAssignmentLayout } from "./layout.ts";
import type { JsonValue, ResolvedRecord, StoredRecord, StructuralValidator } from "./types.ts";

export interface RecordWriteOptions<T extends StoredRecord> {
  stateRoot: string;
  assignmentId: string;
  category: string;
  record: T;
  immutable?: boolean;
  validator?: StructuralValidator<T>;
  schemaId?: string;
}

function recordFilename(recordId: string, revision?: number): string {
  assertPortableId(recordId, "record ID");
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw storageError("STATE_INVALID_IDENTIFIER", "Record revision must be a positive safe integer", { revision });
  }
  return revision === undefined ? `${recordId}.json` : `${recordId}.r${revision}.json`;
}

export async function writeAssignmentRecord<T extends StoredRecord>(options: RecordWriteOptions<T>): Promise<string> {
  assertPortableId(options.assignmentId, "assignment ID");
  assertPortableId(options.category, "record category");
  if (options.record.assignment_id !== undefined && options.record.assignment_id !== options.assignmentId) {
    throw storageError("STATE_RECORD_CONFLICT", "Record assignment does not match its storage assignment", { assignmentId: options.assignmentId });
  }
  if (options.validator !== undefined) {
    if (options.schemaId === undefined) throw storageError("VALIDATION_REJECTED", "A schema ID is required when a structural validator is supplied");
    const result = await options.validator.validate(options.schemaId, options.record, options.record.schema_version);
    if (!result.valid) throw storageError("VALIDATION_REJECTED", "Record failed structural validation", { errors: result.errors });
  }
  await initializeAssignmentLayout(options.stateRoot, options.assignmentId);
  const relative = path.join("assignments", options.assignmentId, options.category, recordFilename(options.record.record_id, options.record.revision));
  const json = options.record as unknown as JsonValue;
  return options.immutable === false
    ? writeJsonAtomic(options.stateRoot, relative, json)
    : writeJsonImmutableIdempotent(options.stateRoot, relative, json);
}

async function walkJson(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const results: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) results.push(...await walkJson(target));
    else if (entry.isFile() && entry.name.endsWith(".json")) results.push(target);
  }
  return results;
}

export async function resolveRecord<T extends StoredRecord = StoredRecord>(stateRoot: string, recordId: string, revision?: number): Promise<ResolvedRecord<T>> {
  assertPortableId(recordId, "record ID");
  const roots: Array<{ location: "active" | "archive"; directory: string }> = [
    { location: "active", directory: await assertContainedStatePath(stateRoot, "assignments") },
    { location: "active", directory: await assertContainedStatePath(stateRoot, "shared") },
    { location: "archive", directory: await assertContainedStatePath(stateRoot, "archive") },
  ];
  const matches: ResolvedRecord<T>[] = [];
  for (const root of roots) {
    for (const filename of await walkJson(root.directory)) {
      let record: T;
      try { record = JSON.parse(await readFile(filename, "utf8")) as T; }
      catch { continue; }
      if (record.record_id === recordId && (revision === undefined || record.revision === revision)) {
        matches.push({ record, path: filename, location: root.location });
      }
    }
  }
  if (matches.length === 0) throw storageError("STATE_RECORD_NOT_FOUND", `Record not found: ${recordId}`, { recordId, revision });
  if (matches.length > 1) throw storageError("STATE_RECORD_CONFLICT", `Record has more than one canonical location: ${recordId}`, { paths: matches.map((item) => item.path) });
  return matches[0] as ResolvedRecord<T>;
}
