import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CORE_RECORD_TYPES, coreSchemaRegistry } from "../registries/index.ts";
import { assertContainedStatePath, assertPortableId, resolveRecord } from "../storage/index.ts";
import type { StoredRecord } from "../storage/index.ts";
import type { AssignmentArchiveFacts, HoldTarget } from "./types.ts";

export interface CanonicalAssignmentFile {
  absolutePath: string;
  relativePath: string;
  content: Buffer;
  digest: string;
  record?: StoredRecord;
}

export interface CanonicalAssignmentArchiveState {
  facts: AssignmentArchiveFacts;
  files: CanonicalAssignmentFile[];
}

const CORE_TYPES = new Set<string>(CORE_RECORD_TYPES);
const CONCRETE_ACTION_OUTCOMES = new Set(["succeeded", "failed", "prevented", "cancelled"]);
const TERMINAL_EXECUTION_STATES = new Set(["completed", "failed", "cancelled"]);

async function walk(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Assignment state contains a link: ${filename}`);
    if (entry.isDirectory()) files.push(...await walk(filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

function identityKey(target: HoldTarget): string {
  return `${target.record_type}\0${target.record_id}\0${target.revision ?? ""}`;
}

function recordReference(value: unknown): HoldTarget | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.record_type !== "string" || typeof candidate.record_id !== "string") return undefined;
  return {
    record_type: candidate.record_type,
    record_id: candidate.record_id,
    ...(typeof candidate.revision === "number" ? { revision: candidate.revision } : {}),
  };
}

function collectReferences(value: unknown, output: HoldTarget[], isRoot = true): void {
  if (Array.isArray(value)) { for (const item of value) collectReferences(item, output, false); return; }
  if (value === null || typeof value !== "object") return;
  const reference = !isRoot ? recordReference(value) : undefined;
  if (reference !== undefined) { output.push(reference); return; }
  for (const child of Object.values(value as Record<string, unknown>)) collectReferences(child, output, false);
}

function collectDirectReferences(record: StoredRecord, output: HoldTarget[]): void {
  const singular: Record<string, string> = {
    current_plan_id: "plan", prior_plan_id: "plan", task_id: "task", parent_task_id: "task",
    execution_id: "execution", result_id: "result", action_id: "action", checkpoint_id: "checkpoint",
  };
  const plural: Record<string, string> = {
    task_ids: "task", execution_ids: "execution", result_ids: "result",
    pending_action_ids: "action", unresolved_action_ids: "action", evidence_refs: "evidence",
  };
  for (const [field, recordType] of Object.entries(singular)) {
    const value = record[field];
    if (typeof value === "string" && value !== record.record_id) output.push({ record_type: recordType, record_id: value });
  }
  for (const [field, recordType] of Object.entries(plural)) {
    const values = record[field];
    if (Array.isArray(values)) for (const value of values) if (typeof value === "string") output.push({ record_type: recordType, record_id: value });
  }
}

function expectedFilename(record: StoredRecord): string {
  return record.revision === undefined ? `${record.record_id}.json` : `${record.record_id}.r${record.revision}.json`;
}

function structurallyValid(record: StoredRecord): boolean {
  if (!CORE_TYPES.has(record.record_type)) {
    return record.record_type.includes(".") && typeof record.schema_version === "string";
  }
  return coreSchemaRegistry.validateRecord(record.record_type, record, record.schema_version).valid;
}

/** Derive archive facts from canonical files; callers cannot assert eligibility. */
export async function deriveAssignmentArchiveState(stateRoot: string, assignmentId: string): Promise<CanonicalAssignmentArchiveState> {
  assertPortableId(assignmentId, "assignment ID");
  const assignmentRoot = await assertContainedStatePath(stateRoot, path.join("assignments", assignmentId));
  const filenames = await walk(assignmentRoot);
  const files: CanonicalAssignmentFile[] = [];
  const identities = new Set<string>();
  const references: HoldTarget[] = [];
  let identitiesValid = filenames.length > 0;
  let hashesValid = true;
  let assignment: StoredRecord | undefined;
  let unresolvedExecutions = 0;
  let unresolvedActions = 0;

  for (const filename of filenames) {
    const content = await readFile(filename);
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    let record: StoredRecord | undefined;
    if (filename.endsWith(".json")) {
      try { record = JSON.parse(content.toString("utf8")) as StoredRecord; }
      catch { identitiesValid = false; }
    }
    if (record !== undefined) {
      const basicIdentity = typeof record.record_id === "string" && typeof record.record_type === "string"
        && typeof record.schema_version === "string" && path.basename(filename) === expectedFilename(record)
        && (record.assignment_id === undefined || record.assignment_id === assignmentId);
      if (!basicIdentity || !structurallyValid(record)) identitiesValid = false;
      else {
        const key = identityKey({ record_type: record.record_type, record_id: record.record_id, ...(record.revision === undefined ? {} : { revision: record.revision }) });
        if (identities.has(key)) identitiesValid = false;
        identities.add(key);
      }
      if (record.record_type === "assignment" && record.record_id === assignmentId) {
        if (assignment !== undefined) identitiesValid = false;
        assignment = record;
      }
      if (record.record_type === "execution" && !TERMINAL_EXECUTION_STATES.has(String(record.state))) unresolvedExecutions += 1;
      if (record.record_type === "action" && !CONCRETE_ACTION_OUTCOMES.has(String(record.outcome))) unresolvedActions += 1;
      collectReferences(record, references);
      collectDirectReferences(record, references);
      for (const [key, value] of Object.entries(record)) {
        if ((key === "digest" || key.endsWith("_digest")) && (typeof value !== "string" || !/^[A-Za-z0-9]+:[A-Fa-f0-9]+$/.test(value))) hashesValid = false;
      }
    }
    files.push({ absolutePath: filename, relativePath: path.relative(stateRoot, filename).split(path.sep).join("/"), content, digest, ...(record === undefined ? {} : { record }) });
  }

  const pendingRoot = await assertContainedStatePath(stateRoot, "pending");
  for (const filename of await walk(pendingRoot)) {
    if (!filename.endsWith(".json")) continue;
    try {
      const pending = JSON.parse(await readFile(filename, "utf8")) as Record<string, unknown>;
      if (pending.assignment_id === assignmentId && pending.status === "unresolved") unresolvedActions += 1;
    } catch { /* Invalid pending records are handled by validation/quarantine. */ }
  }

  let referencesResolve = true;
  for (const reference of references) {
    if (identities.has(identityKey(reference))) continue;
    try {
      const resolved = await resolveRecord(stateRoot, reference.record_id, reference.revision);
      if (resolved.record.record_type !== reference.record_type) referencesResolve = false;
    }
    catch { referencesResolve = false; }
  }

  const closureHistory = Array.isArray(assignment?.closure_history)
    ? assignment.closure_history as Array<Record<string, unknown>> : [];
  const latestClosure = closureHistory.at(-1);
  const closedAt = typeof latestClosure?.closed_at === "string" ? latestClosure.closed_at : undefined;
  const closureDisposition = typeof assignment?.closure_disposition === "string"
    ? assignment.closure_disposition : typeof latestClosure?.disposition === "string" ? latestClosure.disposition : undefined;

  return {
    facts: {
      target: { record_type: "assignment", record_id: assignmentId },
      lifecycleState: typeof assignment?.lifecycle_state === "string" ? assignment.lifecycle_state : "missing",
      ...(closureDisposition === undefined ? {} : { closureDisposition }),
      ...(closedAt === undefined ? {} : { closedAt }),
      ...(assignment?.lifecycle_state !== "closed" && closedAt !== undefined && typeof assignment?.updated_at === "string"
        ? { reopenedAt: assignment.updated_at } : {}),
      relatedRecordsDiscoverable: assignment !== undefined && files.length > 0,
      referencesResolve,
      unresolvedExecutions,
      unresolvedActions,
      identitiesValid: identitiesValid && assignment !== undefined,
      hashesValid,
    },
    files,
  };
}
