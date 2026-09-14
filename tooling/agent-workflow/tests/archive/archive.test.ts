import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyAssignmentArchive, createArchiveBatchId, planAssignmentArchive, resolveAssignmentHistory,
  type ArchiveStage,
} from "../../src/archive/index.ts";
import { recoverInterruptedArchives } from "../../src/recovery/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";
import type { AssignmentArchiveFacts } from "../../src/retention/index.ts";
import { saveHold } from "../../src/retention/index.ts";
import { withAssignmentWriteLock } from "../../src/concurrency/index.ts";

async function fixture(suffix = "1") {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-archive-"));
  const { stateRoot } = await initializeStateRoot(projectRoot);
  const assignmentId = `asn-${suffix}`;
  const recordRoot = path.join(stateRoot, "assignments", assignmentId, "assignment");
  await mkdir(recordRoot, { recursive: true });
  await writeFile(path.join(recordRoot, `${assignmentId}.json`), JSON.stringify({
    schema_version: "1.0", record_type: "assignment", record_id: assignmentId,
    created_at: "2026-07-01T00:00:00.000Z", assignment_id: assignmentId,
    objective: "archive fixture", lifecycle_state: "closed", closure_disposition: "completed",
    execution_authority: "unauthorized", ownership: { manager_instance_id: "mgr-fixture" },
    policy_snapshot: {}, closure_history: [{ disposition: "completed", closed_at: "2026-08-01T00:00:00.000Z" }],
  }));
  const facts: AssignmentArchiveFacts = {
    target: { record_type: "assignment", record_id: assignmentId },
    lifecycleState: "closed", closureDisposition: "completed",
    closedAt: "2026-08-01T00:00:00.000Z", relatedRecordsDiscoverable: true,
    referencesResolve: true, unresolvedExecutions: 0, unresolvedActions: 0,
    identitiesValid: true, hashesValid: true,
  };
  return { stateRoot, assignmentId, facts };
}

test("dry-run planning has no filesystem side effects", async () => {
  const value = await fixture("dry");
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-dry", now: new Date("2026-09-13T00:00:00Z") });
  assert.equal(plan.eligible, true);
  await assert.rejects(access(path.join(value.stateRoot, "archive", "assignments", value.assignmentId)));
});

test("caller assertions cannot manufacture archive eligibility", async () => {
  const value = await fixture("malicious");
  const assignmentFile = path.join(value.stateRoot, "assignments", value.assignmentId, "assignment", `${value.assignmentId}.json`);
  const record = JSON.parse(await readFile(assignmentFile, "utf8")) as Record<string, unknown>;
  await writeFile(assignmentFile, JSON.stringify({ ...record, lifecycle_state: "running" }));
  const plan = await planAssignmentArchive({
    ...value, batchId: "batch-malicious", now: new Date("2026-09-13T00:00:00Z"),
    facts: { ...value.facts, lifecycleState: "closed", identitiesValid: true },
  });
  assert.equal(plan.eligible, false);
  assert.ok(plan.reasons.includes("assignment_not_closed"));
});

test("persisted holds are loaded and block planning", async () => {
  const value = await fixture("held");
  await saveHold(value.stateRoot, {
    schema_version: "1.0", record_id: "hold-archive", record_type: "hold", hold_id: "hold-archive",
    created_at: "2026-09-01T00:00:00.000Z", targets: [{ record_type: "assignment", record_id: value.assignmentId }],
    placed_by: { actor_id: "exec-1", actor_type: "executive" }, reason: "audit", scope: "archive", status: "active",
  });
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-held", now: new Date("2026-09-13T00:00:00Z"), holds: [] });
  assert.equal(plan.eligible, false);
  assert.ok(plan.reasons.includes("archive_hold"));
});

test("a hold placed after planning prevents apply", async () => {
  const value = await fixture("late-hold");
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-late-hold", now: new Date("2026-09-13T00:00:00Z") });
  await saveHold(value.stateRoot, {
    schema_version: "1.0", record_id: "hold-late", record_type: "hold", hold_id: "hold-late",
    created_at: "2026-09-13T00:00:00.000Z", targets: [{ record_type: "assignment", record_id: value.assignmentId }],
    placed_by: { actor_id: "exec-1", actor_type: "executive" }, reason: "late audit", scope: "archive", status: "active",
  });
  await assert.rejects(applyAssignmentArchive({ stateRoot: value.stateRoot, plan }), /archive_hold/);
  await access(path.join(value.stateRoot, "assignments", value.assignmentId));
});

test("canonical unresolved work, references, identities, hashes, and reopen state block archive", async () => {
  const value = await fixture("guards");
  const root = path.join(value.stateRoot, "assignments", value.assignmentId);
  await Promise.all(["executions", "actions", "evidence"].map((category) => mkdir(path.join(root, category), { recursive: true })));
  const assignmentFile = path.join(root, "assignment", `${value.assignmentId}.json`);
  const assignment = JSON.parse(await readFile(assignmentFile, "utf8")) as Record<string, unknown>;
  await writeFile(assignmentFile, JSON.stringify({
    ...assignment, lifecycle_state: "running", updated_at: "2026-08-02T00:00:00.000Z",
  }));
  await writeFile(path.join(root, "executions", "exe-open.json"), JSON.stringify({
    schema_version: "1.0", record_type: "execution", record_id: "exe-open", created_at: "2026-07-01T00:00:00.000Z",
    execution_id: "exe-open", task_id: "tsk-missing", assignment_id: value.assignmentId, attempt: 1, state: "running",
  }));
  await writeFile(path.join(root, "actions", "act-open.json"), JSON.stringify({
    schema_version: "1.0", record_type: "action", record_id: "act-open", created_at: "2026-07-01T00:00:00.000Z",
    action_id: "act-open", assignment_id: value.assignmentId, description: "unknown side effect", outcome: "unknown",
  }));
  await writeFile(path.join(root, "evidence", "wrong-name.json"), JSON.stringify({
    schema_version: "1.0", record_type: "evidence", record_id: "evd-corrupt", created_at: "2026-07-01T00:00:00.000Z",
    evidence_id: "evd-corrupt", assignment_id: value.assignmentId,
    subject: { record_type: "task", record_id: "tsk-missing" }, kind: "test", location: "missing", digest: "not-a-digest",
  }));
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-guards", now: new Date("2026-09-13T00:00:00Z") });
  assert.equal(plan.eligible, false);
  for (const reason of ["assignment_not_closed", "assignment_reopened", "unresolved_executions", "unresolved_actions", "unresolved_references", "invalid_identities", "invalid_hashes"]) {
    assert.ok(plan.reasons.includes(reason), `missing reason ${reason}: ${plan.reasons.join(", ")}`);
  }
});

test("generated archive batch IDs are collision resistant", () => {
  const now = new Date("2026-09-13T00:00:00Z");
  const ids = new Set(Array.from({ length: 1_000 }, () => createArchiveBatchId(now)));
  assert.equal(ids.size, 1_000);
});

test("apply copies, verifies, publishes, removes, and is idempotent", async () => {
  const value = await fixture("apply");
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-apply", now: new Date("2026-09-13T00:00:00Z") });
  const result = await applyAssignmentArchive({ stateRoot: value.stateRoot, plan });
  assert.equal(result.status, "completed");
  await assert.rejects(access(path.join(value.stateRoot, "assignments", value.assignmentId)));
  await access(path.join(value.stateRoot, "archive", "locations", value.assignmentId, "batch-apply.json"));
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as { status: string };
  assert.equal(manifest.status, "published");
  assert.equal((await applyAssignmentArchive({ stateRoot: value.stateRoot, plan })).status, "no-op");
});

for (const stage of ["planned", "copying", "verified", "published", "source_removed", "completed"] as const satisfies readonly ArchiveStage[]) {
  test(`interruption at ${stage} recovers without loss`, async () => {
    const value = await fixture(stage);
    const plan = await planAssignmentArchive({ ...value, batchId: `batch-${stage}`, now: new Date("2026-09-13T00:00:00Z") });
    await assert.rejects(applyAssignmentArchive({
      stateRoot: value.stateRoot, plan,
      injectFailure: (candidate) => { if (candidate === stage) throw new Error("injected"); },
    }));
    const recovery = await recoverInterruptedArchives(value.stateRoot);
    assert.equal(recovery.length, 1);
    await access(path.join(value.stateRoot, "archive", "assignments", value.assignmentId, `batch-${stage}`, "records", "assignment", `${value.assignmentId}.json`));
    await assert.rejects(access(path.join(value.stateRoot, "assignments", value.assignmentId)));
  });
}

test("history exposes prior batches and a reopened active copy", async () => {
  const value = await fixture("history");
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-one", now: new Date("2026-09-13T00:00:00Z") });
  await applyAssignmentArchive({ stateRoot: value.stateRoot, plan });
  await mkdir(path.join(value.stateRoot, "assignments", value.assignmentId, "assignment"), { recursive: true });
  const history = await resolveAssignmentHistory(value.stateRoot, value.assignmentId);
  assert.ok(history.activePath);
  assert.deepEqual(history.batches.map((item) => item.batchId), ["batch-one"]);
});

test("an assignment writer cannot race archive removal and recreate stale state", async () => {
  const value = await fixture("race");
  const plan = await planAssignmentArchive({ ...value, batchId: "batch-race", now: new Date("2026-09-13T00:00:00Z") });
  let releaseCopy!: () => void;
  const copying = new Promise<void>((resolve) => { releaseCopy = resolve; });
  let reachedCopy!: () => void;
  const atCopy = new Promise<void>((resolve) => { reachedCopy = resolve; });
  const archive = applyAssignmentArchive({
    stateRoot: value.stateRoot, plan,
    injectFailure: async (stage) => { if (stage === "copying") { reachedCopy(); await copying; } },
  });
  await atCopy;
  let writerRan = false;
  const writer = withAssignmentWriteLock({
    stateRoot: value.stateRoot, assignmentId: value.assignmentId, ownerId: "writer-race", timeoutMs: 2_000,
  }, async () => { writerRan = true; });
  releaseCopy();
  await archive;
  await assert.rejects(writer, (error: { code?: string }) => error.code === "STATE_RECORD_NOT_FOUND");
  assert.equal(writerRan, false);
});
