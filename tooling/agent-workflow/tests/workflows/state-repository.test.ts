import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import defaults from "../../defaults/config.json" with { type: "json" };
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";
import { StateWorkflowRepository, WorkflowCommandService } from "../../src/commands/index.ts";

test("command service persists through AW-03 storage and event interfaces", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-command-state-"));
  const repository = new StateWorkflowRepository({ projectRoot });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; },
  });
  const context = { actor: { actorId: "executive-1", actorType: "executive" as const }, managerInstanceId: "mgr-1" };
  const started = await service.start({ objective: "Persist", approach: ["write"], acceptanceCriteria: ["readable"], waiveApproval: true }, context);
  const restored = await repository.get(started.assignment.assignmentId);
  assert.equal(restored?.objective, "Persist"); assert.equal(restored?.executionAuthority.state, "authorized");
});

test("persisted plan approval completes with schema-valid lifecycle events", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-command-approval-"));
  const repository = new StateWorkflowRepository({ projectRoot });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; },
  });
  const manager = { actor: { actorId: "manager-1", actorType: "manager" as const }, managerInstanceId: "mgr-1" };
  const executive = { actorId: "executive-1", actorType: "executive" as const };
  const started = await service.start({ objective: "Approve", approach: ["inspect"], acceptanceCriteria: ["reported"] }, manager);
  const approved = await service.approvePlan(started.assignment.assignmentId, started.assignment.approvals[0]!.approvalId, executive, { ...manager, ownershipToken: started.assignment.ownershipLease!.token });
  assert.equal(approved.assignment.lifecycle, "running");
  assert.equal(approved.assignment.executionAuthority.state, "authorized");
  assert.equal((await repository.get(started.assignment.assignmentId))?.approvals[0]?.state, "granted");
});

test("the recorded manager can reacquire an expired lease after a human approval delay", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-command-reacquire-"));
  const repository = new StateWorkflowRepository({ projectRoot });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; },
  });
  const manager = { actor: { actorId: "manager-1", actorType: "manager" as const }, managerInstanceId: "mgr-1", now: () => new Date("2026-09-13T12:00:00Z") };
  const started = await service.start({ objective: "Approve later", approach: ["inspect"], acceptanceCriteria: ["reported"] }, manager);
  const later = { ...manager, now: () => new Date("2026-09-13T12:06:00Z") };
  await assert.rejects(service.approvePlan(started.assignment.assignmentId, started.assignment.approvals[0]!.approvalId, { actorId: "executive-1", actorType: "executive" }, later), /OWNERSHIP_REQUIRED/);
  const reacquired = await service.acquireOwnership(started.assignment.assignmentId, later);
  assert.equal(reacquired.code, "OWNERSHIP_ACQUIRED");
  const approved = await service.approvePlan(started.assignment.assignmentId, started.assignment.approvals[0]!.approvalId, { actorId: "executive-1", actorType: "executive" }, { ...later, ownershipToken: reacquired.assignment.ownershipLease!.token });
  assert.equal(approved.assignment.executionAuthority.state, "authorized");
});

test("normal workflow commands cannot mutate or recreate an archived assignment", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-command-archived-"));
  const repository = new StateWorkflowRepository({ projectRoot });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; },
  });
  const context = { actor: { actorId: "executive-1", actorType: "executive" as const }, managerInstanceId: "mgr-1" };
  const started = await service.start({ objective: "Persist", approach: ["write"], acceptanceCriteria: ["readable"], waiveApproval: true }, context);
  const stateRoot = path.join(projectRoot, ".agent-state");
  const active = path.join(stateRoot, "assignments", started.assignment.assignmentId);
  const archived = path.join(stateRoot, "archive", "batch-test", "assignments", started.assignment.assignmentId);
  await mkdir(path.dirname(archived), { recursive: true });
  await cp(active, archived, { recursive: true });
  await rm(active, { recursive: true });

  await assert.rejects(repository.get(started.assignment.assignmentId), /ASSIGNMENT_ARCHIVED/);
  await assert.rejects(repository.save(started.assignment), /ASSIGNMENT_ARCHIVED/);
});

test("canonical records preserve their own creation times and persist evidence references", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-command-record-times-"));
  let repositoryNow = new Date("2026-09-13T12:00:00.000Z");
  const repository = new StateWorkflowRepository({ projectRoot, now: () => repositoryNow });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; },
  });
  const context = { actor: { actorId: "executive-1", actorType: "executive" as const }, managerInstanceId: "mgr-1" };
  const started = await service.start({ objective: "Timestamp records", approach: ["inspect"], acceptanceCriteria: ["evidenced"], waiveApproval: true }, context);
  const owned = { ...context, ownershipToken: started.assignment.ownershipLease!.token };
  repositoryNow = new Date("2026-09-13T12:01:00.000Z");
  const task = await service.createTask(started.assignment.assignmentId, [], owned);
  await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", owned);
  repositoryNow = new Date("2026-09-13T12:02:00.000Z");
  const snapshot = { digest: `sha256:${"b".repeat(64)}`, location: "git-working-tree:." as const, capturedAt: repositoryNow.toISOString() };
  const execution = await service.beginExecution(started.assignment.assignmentId, task.taskId, owned, undefined, snapshot);
  repositoryNow = new Date("2026-09-13T12:03:00.000Z");
  await service.recordExecutionOutcome(started.assignment.assignmentId, execution.executionId, "completed", owned, { ...snapshot, capturedAt: repositoryNow.toISOString() });
  await service.submitResult(started.assignment.assignmentId, task.taskId, "res-timestamped", owned, { executionId: execution.executionId, deliveryStatus: "complete", summary: "Verified" });

  const assignmentRoot = path.join(projectRoot, ".agent-state", "assignments", started.assignment.assignmentId);
  const readRecord = async (category: string, id: string) => JSON.parse(await readFile(path.join(assignmentRoot, category, `${id}.json`), "utf8")) as Record<string, unknown>;
  const assignment = await readRecord("assignment", started.assignment.assignmentId);
  const persistedTask = await readRecord("tasks", task.taskId);
  const persistedExecution = await readRecord("executions", execution.executionId);
  const persistedResult = await readRecord("results", "res-timestamped");
  assert.equal(assignment.created_at, "2026-09-13T12:00:00.000Z");
  assert.equal(persistedTask.created_at, "2026-09-13T12:01:00.000Z");
  assert.equal(persistedExecution.created_at, "2026-09-13T12:02:00.000Z");
  assert.equal(persistedResult.created_at, "2026-09-13T12:03:00.000Z");
  assert.deepEqual((persistedResult.evidence_refs as string[]).length, 2);
  assert.equal((await repository.get(started.assignment.assignmentId))?.evidence?.length, 2);
});
