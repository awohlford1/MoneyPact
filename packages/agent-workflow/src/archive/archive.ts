import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  assertContainedStatePath, assertPortableId, canonicalJson, writeJsonAtomic,
  writeJsonImmutableIdempotent,
} from "../storage/index.ts";
import type { JsonValue } from "../storage/index.ts";
import { deriveAssignmentArchiveState, evaluateAssignmentArchive, loadHolds } from "../retention/index.ts";
import { assertOperationLockOwned, withAssignmentWriteLock, withOperationLock } from "../concurrency/index.ts";
import type {
  ApplyArchiveOptions, ArchiveApplyResult, ArchiveJournal, ArchiveManifest,
  ArchivePlan, ArchivePlanEntry, PlanAssignmentArchiveOptions,
} from "./types.ts";

async function exists(filename: string): Promise<boolean> {
  try { await stat(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function digestFile(filename: string): Promise<string> {
  const bytes = await readFile(filename);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function recordIdentity(filename: string, content: Buffer): ArchivePlanEntry["record"] {
  if (filename.endsWith(".json")) {
    try {
      const value = JSON.parse(content.toString("utf8")) as Record<string, unknown>;
      if (typeof value.record_type === "string" && typeof value.record_id === "string") {
        const revision = typeof value.revision === "number" ? value.revision : undefined;
        return revision === undefined
          ? { record_type: value.record_type, record_id: value.record_id }
          : { record_type: value.record_type, record_id: value.record_id, revision };
      }
    } catch { /* Non-record JSON is archived as an artifact. */ }
  }
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 24);
  return { record_type: "artifact", record_id: `artifact-${digest}` };
}

export async function planAssignmentArchive(options: PlanAssignmentArchiveOptions): Promise<ArchivePlan> {
  assertPortableId(options.assignmentId, "assignment ID");
  const now = options.now ?? new Date();
  const batchId = options.batchId ?? createArchiveBatchId(now);
  assertPortableId(batchId, "archive batch ID");
  const operationId = options.operationId ?? `archive-${batchId}`;
  assertPortableId(operationId, "archive operation ID");
  const retentionDays = options.retentionDays ?? 30;
  const canonical = await deriveAssignmentArchiveState(options.stateRoot, options.assignmentId);
  const evaluation = evaluateAssignmentArchive(canonical.facts, {
    now,
    retentionDays,
    holds: await loadHolds(options.stateRoot),
  });
  const sourceRoot = await assertContainedStatePath(options.stateRoot, path.join("assignments", options.assignmentId));
  const destinationRoot = await assertContainedStatePath(options.stateRoot, path.join("archive", "assignments", options.assignmentId, batchId, "records"));
  const entries: ArchivePlanEntry[] = [];
  if (evaluation.eligible) {
    const maxEntries = options.maxEntries ?? 10_000;
    if (canonical.files.length > maxEntries) evaluation.reasons.push("invocation_bound_exceeded");
    else {
      for (const file of canonical.files) {
        const relative = path.relative(sourceRoot, file.absolutePath);
        entries.push({
          record: recordIdentity(file.absolutePath, file.content),
          source: file.relativePath,
          destination: path.relative(options.stateRoot, path.join(destinationRoot, relative)).split(path.sep).join("/"),
          digest: file.digest,
          size: file.content.byteLength,
        });
      }
    }
  }
  if (evaluation.reasons.length > 0) entries.length = 0;
  return {
    schema_version: "1.0", operation_id: operationId, batch_id: batchId,
    assignment_id: options.assignmentId, created_at: now.toISOString(), retention_days: retentionDays,
    source_root: path.relative(options.stateRoot, sourceRoot).split(path.sep).join("/"),
    destination_root: path.relative(options.stateRoot, destinationRoot).split(path.sep).join("/"),
    eligible: evaluation.reasons.length === 0, reasons: evaluation.reasons, entries,
  };
}

export function createArchiveBatchId(now = new Date()): string {
  return `batch-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID()}`;
}

function manifestFor(plan: ArchivePlan): ArchiveManifest {
  return {
    schema_version: "1.0", record_id: `manifest-${plan.batch_id}`,
    record_type: "archive-manifest", created_at: plan.created_at,
    manifest_id: `manifest-${plan.batch_id}`, batch_id: plan.batch_id,
    entries: plan.entries.map(({ size: _size, ...entry }) => entry), status: "published",
  };
}

async function writeJournal(stateRoot: string, journal: ArchiveJournal): Promise<void> {
  await mkdir(await assertContainedStatePath(stateRoot, path.join("archive", ".operations")), { recursive: true });
  await writeJsonAtomic(stateRoot, path.join("archive", ".operations", `${journal.operation_id}.json`), journal as unknown as JsonValue);
}

async function applyAssignmentArchiveUnlocked(options: ApplyArchiveOptions, assertLockOwned?: () => Promise<void>): Promise<ArchiveApplyResult> {
  const { stateRoot, plan } = options;
  if (!plan.eligible) throw new Error(`Archive plan is ineligible: ${plan.reasons.join(", ")}`);
  const sourceRoot = await assertContainedStatePath(stateRoot, plan.source_root);
  const destinationRoot = await assertContainedStatePath(stateRoot, plan.destination_root);
  const manifestRelative = path.join("archive", "manifests", `${plan.batch_id}.json`);
  const manifestPath = await assertContainedStatePath(stateRoot, manifestRelative);
  if (await exists(manifestPath)) {
    const existing = JSON.parse(await readFile(manifestPath, "utf8")) as JsonValue;
    const expected = manifestFor(plan) as unknown as JsonValue;
    if (canonicalJson(existing) !== canonicalJson(expected)) {
      throw new Error(`Archive batch ID is already used by a different plan: ${plan.batch_id}`);
    }
  }
  if (await exists(manifestPath) && !(await exists(sourceRoot))) {
    await writeJournal(stateRoot, {
      operation_id: plan.operation_id, batch_id: plan.batch_id,
      assignment_id: plan.assignment_id, created_at: plan.created_at,
      updated_at: new Date().toISOString(), stage: "completed",
      last_successful_stage: "completed", plan,
    });
    return { status: "no-op", manifestPath, filesArchived: plan.entries.length };
  }
  const current = await deriveAssignmentArchiveState(stateRoot, plan.assignment_id);
  const currentEvaluation = evaluateAssignmentArchive(current.facts, {
    now: new Date(), retentionDays: plan.retention_days, holds: await loadHolds(stateRoot),
  });
  if (!currentEvaluation.eligible) throw new Error(`Assignment is no longer archive eligible: ${currentEvaluation.reasons.join(", ")}`);
  const plannedSources = new Map(plan.entries.map((entry) => [entry.source, entry.digest]));
  if (current.files.length !== plan.entries.length || current.files.some((file) => plannedSources.get(file.relativePath) !== file.digest)) {
    throw new Error("Assignment state changed after archive planning");
  }
  const journal: ArchiveJournal = {
    operation_id: plan.operation_id, batch_id: plan.batch_id, assignment_id: plan.assignment_id,
    created_at: plan.created_at, updated_at: new Date().toISOString(), stage: "planned", plan,
  };
  const advance = async (stage: ArchiveJournal["stage"]): Promise<void> => {
    journal.stage = stage;
    if (stage !== "failed") journal.last_successful_stage = stage;
    journal.updated_at = new Date().toISOString();
    await writeJournal(stateRoot, journal);
    if (stage !== "failed") await options.injectFailure?.(stage);
  };
  try {
    await advance("planned");
    await mkdir(destinationRoot, { recursive: true });
    await advance("copying");
    for (const entry of plan.entries) {
      const source = await assertContainedStatePath(stateRoot, entry.source);
      const destination = await assertContainedStatePath(stateRoot, entry.destination);
      if (await digestFile(source) !== entry.digest) throw new Error(`Archive source changed after planning: ${entry.source}`);
      await mkdir(path.dirname(destination), { recursive: true });
      try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await digestFile(destination) !== entry.digest) throw error;
      }
    }
    for (const entry of plan.entries) {
      const destination = await assertContainedStatePath(stateRoot, entry.destination);
      if (await digestFile(destination) !== entry.digest) throw new Error(`Archive verification failed: ${entry.destination}`);
    }
    await advance("verified");
    const manifest = manifestFor(plan);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(await assertContainedStatePath(stateRoot, path.join("archive", "locations", plan.assignment_id)), { recursive: true });
    const locationRelative = path.join("archive", "locations", plan.assignment_id, `${plan.batch_id}.json`);
    await writeJsonImmutableIdempotent(stateRoot, locationRelative, {
      assignment_id: plan.assignment_id, batch_id: plan.batch_id,
      archive_root: plan.destination_root,
      manifest: manifestRelative.split(path.sep).join("/"),
      plan_digest: `sha256:${createHash("sha256").update(canonicalJson(plan as unknown as JsonValue)).digest("hex")}`,
    });
    await writeJsonImmutableIdempotent(stateRoot, manifestRelative, manifest as unknown as JsonValue);
    await advance("published");
    for (const entry of plan.entries) {
      const source = await assertContainedStatePath(stateRoot, entry.source);
      if (await exists(source) && await digestFile(source) !== entry.digest) throw new Error(`Source changed before removal: ${entry.source}`);
    }
    await assertLockOwned?.();
    await rm(sourceRoot, { recursive: true, force: true });
    await advance("source_removed");
    await advance("completed");
    return { status: "completed", manifestPath, filesArchived: plan.entries.length };
  } catch (error) {
    journal.stage = "failed";
    journal.error = error instanceof Error ? error.message : String(error);
    journal.updated_at = new Date().toISOString();
    await writeJournal(stateRoot, journal).catch(() => undefined);
    throw error;
  }
}

export async function applyAssignmentArchive(options: ApplyArchiveOptions): Promise<ArchiveApplyResult> {
  return withOperationLock({
    stateRoot: options.stateRoot,
    resource: `archive-batch-${options.plan.batch_id}`,
    ownerId: options.plan.operation_id,
  }, () => withAssignmentWriteLock({
    stateRoot: options.stateRoot, assignmentId: options.plan.assignment_id,
    ownerId: options.plan.operation_id, requireActive: false,
  }, async (lock) => {
    const result = await applyAssignmentArchiveUnlocked({
      ...options,
      injectFailure: async (stage) => {
        await options.injectFailure?.(stage);
        if (stage === "published") await assertOperationLockOwned(lock);
      },
    }, () => assertOperationLockOwned(lock));
    return result;
  }));
}
