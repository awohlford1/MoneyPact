import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { assertContainedStatePath, assertPortableId, writeJsonAtomic, writeJsonImmutableIdempotent } from "../storage/index.ts";
import type { JsonValue } from "../storage/index.ts";
import { evaluateRawResponseDeletion, loadHolds } from "../retention/index.ts";
import { withOperationLock } from "../concurrency/index.ts";
import type { CleanupApplyResult, CleanupJournal, CleanupManifest, CleanupPlan, PlanRawResponseCleanupOptions } from "./types.ts";

async function candidates(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error(`Raw-response directory contains a link: ${filename}`);
    if (info.isDirectory()) files.push(...await candidates(filename));
    else if (info.isFile() && entry.name.endsWith(".json")) files.push(filename);
  }
  return files;
}

export async function planRawResponseCleanup(options: PlanRawResponseCleanupOptions): Promise<CleanupPlan> {
  assertPortableId(options.operationId, "cleanup operation ID");
  const now = options.now ?? new Date();
  const root = await assertContainedStatePath(options.stateRoot, "raw-responses");
  const maxEntries = options.maxEntries ?? 1_000;
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const retentionDays = options.retentionDays ?? 7;
  const holds = await loadHolds(options.stateRoot);
  const entries: CleanupPlan["entries"] = [];
  let bytes = 0;
  let bounded = false;
  for (const filename of await candidates(root)) {
    const content = await readFile(filename);
    let value: Record<string, unknown>;
    try { value = JSON.parse(content.toString("utf8")) as Record<string, unknown>; }
    catch { continue; }
    const recordId = typeof value.record_id === "string" ? value.record_id : path.basename(filename, ".json");
    const recordedAt = typeof value.recorded_at === "string" ? value.recorded_at
      : typeof value.created_at === "string" ? value.created_at : "";
    const evaluation = evaluateRawResponseDeletion({
      target: { record_type: "raw-response", record_id: recordId }, recordedAt,
      promotedToEvidence: value.promoted_to_evidence === true || value.durable_evidence === true,
    }, {
      now,
      retentionDays,
      holds,
    });
    if (!evaluation.eligible) continue;
    if (entries.length >= maxEntries || bytes + content.byteLength > maxBytes) { bounded = true; break; }
    bytes += content.byteLength;
    entries.push({
      target: path.relative(options.stateRoot, filename).split(path.sep).join("/"),
      record_id: recordId, reason: "raw_response_retention_elapsed",
      digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    });
  }
  return {
    schema_version: "1.0", operation_id: options.operationId,
    created_at: now.toISOString(), retention_days: retentionDays, mode: options.mode, bounded, entries,
  };
}

async function writeJournal(stateRoot: string, journal: CleanupJournal): Promise<void> {
  await mkdir(await assertContainedStatePath(stateRoot, path.join("cleanup", ".operations")), { recursive: true });
  await writeJsonAtomic(stateRoot, path.join("cleanup", ".operations", `${journal.operation_id}.json`), journal as unknown as JsonValue);
}

async function applyRawResponseCleanupUnlocked(stateRoot: string, plan: CleanupPlan): Promise<CleanupApplyResult> {
  if (plan.mode !== "apply") throw new Error("A dry-run cleanup plan cannot be applied");
  const manifestRelative = path.join("cleanup", "manifests", `${plan.operation_id}.json`);
  const manifestPath = await assertContainedStatePath(stateRoot, manifestRelative);
  const journal: CleanupJournal = {
    operation_id: plan.operation_id, created_at: plan.created_at,
    updated_at: new Date().toISOString(), stage: "planned", plan,
  };
  try {
    await writeJournal(stateRoot, journal);
    journal.stage = "deleting";
    journal.updated_at = new Date().toISOString();
    await writeJournal(stateRoot, journal);
    let deleted = 0;
    for (const entry of plan.entries) {
      const filename = await assertContainedStatePath(stateRoot, entry.target);
      let content: Buffer;
      try { content = await readFile(filename); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (digest !== entry.digest) throw new Error(`Cleanup target changed after planning: ${entry.target}`);
      let value: Record<string, unknown>;
      try { value = JSON.parse(content.toString("utf8")) as Record<string, unknown>; }
      catch { throw new Error(`Cleanup target is no longer valid JSON: ${entry.target}`); }
      const evaluation = evaluateRawResponseDeletion({
        target: { record_type: "raw-response", record_id: entry.record_id },
        recordedAt: typeof value.recorded_at === "string" ? value.recorded_at : typeof value.created_at === "string" ? value.created_at : "",
        promotedToEvidence: value.promoted_to_evidence === true || value.durable_evidence === true,
      }, { now: new Date(), retentionDays: plan.retention_days, holds: await loadHolds(stateRoot) });
      if (!evaluation.eligible) throw new Error(`Cleanup target is no longer eligible: ${entry.target}: ${evaluation.reasons.join(", ")}`);
      await rm(filename);
      deleted += 1;
    }
    const manifest: CleanupManifest = {
      schema_version: "1.0", record_id: `cleanup-${plan.operation_id}`,
      record_type: "cleanup-manifest", created_at: plan.created_at,
      manifest_id: `cleanup-${plan.operation_id}`, mode: "apply",
      entries: plan.entries.map(({ target, reason, digest }) => ({ target, reason, digest })),
      status: "completed",
    };
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeJsonImmutableIdempotent(stateRoot, manifestRelative, manifest as unknown as JsonValue);
    journal.stage = "completed";
    journal.updated_at = new Date().toISOString();
    await writeJournal(stateRoot, journal);
    return { status: deleted === 0 ? "no-op" : "completed", deleted, manifestPath };
  } catch (error) {
    journal.stage = "failed";
    journal.error = error instanceof Error ? error.message : String(error);
    journal.updated_at = new Date().toISOString();
    await writeJournal(stateRoot, journal).catch(() => undefined);
    throw error;
  }
}

export async function applyRawResponseCleanup(stateRoot: string, plan: CleanupPlan): Promise<CleanupApplyResult> {
  return withOperationLock({
    stateRoot, resource: "cleanup-raw-responses", ownerId: plan.operation_id,
  }, () => applyRawResponseCleanupUnlocked(stateRoot, plan));
}

export const SCHEDULER_EXIT = Object.freeze({ success: 0, invalidConfiguration: 2, blocked: 3, partialFailure: 4 });
