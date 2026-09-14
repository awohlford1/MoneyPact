import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import defaults from "../../defaults/config.json" with { type: "json" };
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";
import { StateWorkflowRepository, WorkflowCommandService } from "../../src/commands/index.ts";
import { coreSchemaRegistry } from "../../src/registries/index.ts";
import { resolveRecord } from "../../src/storage/index.ts";

test("restart reconstructs accepted state from validated canonical records without the ledger", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-canonical-"));
  const repository = new StateWorkflowRepository({ projectRoot: root, policySnapshot: { configuration_digest: "sha256:test" } });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; },
    async createTransferPackage() { return { packageId: "pkg-test", valid: true }; },
    async transferOwnership() { return { accepted: true }; },
  });
  const context = { actor: { actorId: "executive-1", actorType: "executive" as const }, managerInstanceId: "mgr-1" };
  const started = await service.start({ objective: "Canonical restart", approach: ["implement"], acceptanceCriteria: ["state survives"], waiveApproval: true }, context);
  const owned = { ...context, ownershipToken: started.assignment.ownershipLease!.token };
  const task = await service.createTask(started.assignment.assignmentId, ["implementation.details"], owned);
  await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", owned);
  const execution = await service.beginExecution(started.assignment.assignmentId, task.taskId, owned);
  await service.recordExecutionOutcome(started.assignment.assignmentId, execution.executionId, "completed", owned);
  await service.submitResult(started.assignment.assignmentId, task.taskId, "result-1", owned, { executionId: execution.executionId, deliveryStatus: "complete", summary: "Verified result" });
  const assignmentRecord = (await resolveRecord(path.join(root, ".agent-state"), started.assignment.assignmentId)).record;
  assert.equal(coreSchemaRegistry.validateRecord("assignment", assignmentRecord).valid, true);
  await rm(path.join(root, ".agent-state", "ledger"), { recursive: true, force: true });
  const restarted = new StateWorkflowRepository({ projectRoot: root });
  const restored = await restarted.get(started.assignment.assignmentId);
  assert.equal(restored?.objective, "Canonical restart");
  assert.equal(restored?.tasks[0]?.state, "result_submitted");
  assert.equal(restored?.executions[0]?.state, "completed");
  assert.equal(restored?.results[0]?.summary, "Verified result");
});

test("unknown action persistence creates pending and concrete reconciliation removes it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-pending-integration-"));
  const repository = new StateWorkflowRepository({ projectRoot: root });
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, {
    async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-test", valid: true }; }, async transferOwnership() { return { accepted: true }; },
  });
  const context = { actor: { actorId: "executive-1", actorType: "executive" as const }, managerInstanceId: "mgr-1" };
  const started = await service.start({ objective: "Pending", approach: ["act"], acceptanceCriteria: ["reconciled"], waiveApproval: true }, context);
  const owned = { ...context, ownershipToken: started.assignment.ownershipLease!.token };
  const action = await service.createAction(started.assignment.assignmentId, "external effect", owned);
  await service.recordActionOutcome(started.assignment.assignmentId, action.actionId, "started", owned);
  await service.recordActionOutcome(started.assignment.assignmentId, action.actionId, "unknown", owned);
  const pending = path.join(root, ".agent-state", "pending", `${action.actionId}.json`);
  await access(pending);
  await service.reconcileAction(started.assignment.assignmentId, action.actionId, "failed", owned);
  await assert.rejects(access(pending));
});
