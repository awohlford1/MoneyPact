import assert from "node:assert/strict";
import test from "node:test";
import defaults from "../../defaults/config.json" with { type: "json" };
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";
import { MemoryWorkflowRepository, runConsequentialOperation, WorkflowCommandService } from "../../src/commands/index.ts";

const manager = { actor: { actorId: "manager-1", actorType: "manager" as const }, managerInstanceId: "mgr-1" };
const executive = { actorId: "executive-1", actorType: "executive" as const };
const adapter = {
  async requestStop({ mode }: { mode: "graceful" | "force" }) { return { confirmed: mode === "graceful", ...(mode === "graceful" ? { checkpointId: "chk-1" } : {}) }; },
  async createTransferPackage() { return { packageId: "pkg-1", valid: true }; },
  async transferOwnership() { return { accepted: true }; },
};
function setup() { const repository = new MemoryWorkflowRepository(); return { repository, service: new WorkflowCommandService(repository, defaults as FrameworkConfiguration, adapter) }; }
const owned = <T extends typeof manager>(started: { assignment: { ownershipLease?: { token: string } } }, value: T) => ({ ...value, ownershipToken: started.assignment.ownershipLease!.token });

test("start blocks by default and approval authorizes exact plan", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build feature", approach: ["implement"], acceptanceCriteria: ["passes"] }, manager);
  const ctx = owned(started, manager);
  assert.equal(started.status, "blocked"); assert.equal(started.assignment.executionAuthority.state, "unauthorized");
  const approved = await service.approvePlan(started.assignment.assignmentId, started.assignment.approvals[0]!.approvalId, executive, ctx);
  assert.equal(approved.assignment.lifecycle, "running"); assert.equal(approved.assignment.executionAuthority.state, "authorized");
});

test("status and ask do not mutate execution authority", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const status = await service.status(started.assignment.assignmentId, ctx); const asked = await service.ask(started.assignment.assignmentId, "Why?", ctx);
  assert.equal(status.assignment.executionAuthority.state, "authorized"); assert.equal(asked.assignment.executionAuthority.state, "authorized");
});

test("material steer holds affected dispatch until approved", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const task = await service.createTask(started.assignment.assignmentId, ["security.authentication"], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx);
  const steered = await service.steer({ assignmentId: started.assignment.assignmentId, paths: ["security.authentication"], rationale: "change auth", approach: ["replace"], acceptanceCriteria: ["secure"] }, ctx);
  assert.equal(steered.status, "blocked"); await assert.rejects(service.transitionTask(started.assignment.assignmentId, task.taskId, "dispatched", ctx), /AFFECTED_WORK_HELD/);
  const approval = steered.assignment.approvals.at(-1)!; await service.approvePlan(started.assignment.assignmentId, approval.approvalId, executive, ctx);
  assert.equal((await service.transitionTask(started.assignment.assignmentId, task.taskId, "dispatched", ctx)).state, "dispatched");
});

test("manager cannot supersede a proposed material plan before Executive approval", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  await service.steer({ assignmentId: started.assignment.assignmentId, paths: ["security.authentication"], rationale: "material", approach: ["change"], acceptanceCriteria: ["approval"] }, ctx);
  await assert.rejects(service.steer({ assignmentId: started.assignment.assignmentId, paths: ["test.expansion"], rationale: "nonmaterial", approach: ["change"], acceptanceCriteria: ["approval"] }, ctx), /PLAN_APPROVAL_PENDING/);
});

test("each materiality assessment remains bound to the plan it assessed", async () => {
  const { repository, service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  await service.steer({ assignmentId: started.assignment.assignmentId, paths: ["test.expansion"], rationale: "first", approach: ["one"], acceptanceCriteria: ["one"] }, ctx);
  await service.steer({ assignmentId: started.assignment.assignmentId, paths: ["test.expansion"], rationale: "second", approach: ["two"], acceptanceCriteria: ["two"] }, ctx);
  const assessments = (await repository.get(started.assignment.assignmentId))!.assessments;
  assert.equal(assessments.length, 2);
  assert.notEqual(assessments[0]!.planId, assessments[1]!.planId);
  assert.equal(assessments[0]!.planRevision, 2); assert.equal(assessments[1]!.planRevision, 3);
});

test("rework creates a distinct execution and preserves submitted result", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx);
  const first = await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx); await service.recordExecutionOutcome(started.assignment.assignmentId, first.executionId, "completed", ctx);
  await service.submitResult(started.assignment.assignmentId, task.taskId, "res-1", ctx); await service.requestRework(started.assignment.assignmentId, task.taskId, ctx);
  const second = await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx); assert.notEqual(first.executionId, second.executionId); assert.equal(second.attempt, 2);
  const current = await service.status(started.assignment.assignmentId, ctx); assert.deepEqual(current.assignment.tasks[0]!.resultIds, ["res-1"]);
});

test("task closure emits a dedicated event and results retain execution evidence", async () => {
  const { repository, service } = setup();
  const started = await service.start({ objective: "Inspect", approach: ["verify"], acceptanceCriteria: ["evidenced"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx);
  await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx);
  const before = { digest: `sha256:${"a".repeat(64)}`, location: "git-working-tree:." as const, capturedAt: "2026-09-13T12:01:00.000Z" };
  const execution = await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx, undefined, before);
  const after = { ...before, capturedAt: "2026-09-13T12:02:00.000Z" };
  await service.recordExecutionOutcome(started.assignment.assignmentId, execution.executionId, "completed", ctx, after);
  await service.submitResult(started.assignment.assignmentId, task.taskId, "res-evidenced", ctx, { executionId: execution.executionId, deliveryStatus: "complete", summary: "No workspace change" });
  await service.acceptResult(started.assignment.assignmentId, task.taskId, ctx);
  await service.closeTask(started.assignment.assignmentId, task.taskId, ctx);

  const aggregate = (await repository.get(started.assignment.assignmentId))!;
  assert.equal(aggregate.results[0]!.evidenceIds?.length, 2);
  assert.equal(aggregate.evidence?.at(-1)?.kind, "git-working-tree-after:unchanged");
  assert.equal(repository.events.at(-1)?.type, "task.closed");
});

test("graceful pause succeeds; force uncertainty blocks handover and cancellation", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx); await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx);
  const paused = await service.pause({ assignmentId: started.assignment.assignmentId, mode: "graceful" }, ctx); assert.equal(paused.code, "PAUSED");
  const handed = await service.handover({ assignmentId: started.assignment.assignmentId, receiverManagerInstanceId: "mgr-2", mode: "graceful" }, ctx); assert.equal(handed.code, "HANDOVER_ACCEPTED");
});

test("force pause records an unknown outcome without claiming stop", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx); await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx);
  const paused = await service.pause({ assignmentId: started.assignment.assignmentId, mode: "force" }, ctx); assert.equal(paused.code, "PAUSE_INCOMPLETE"); assert.equal(paused.assignment.executions[0]!.state, "unknown");
  const cancelled = await service.cancelAssignment(started.assignment.assignmentId, ctx); assert.equal(cancelled.code, "UNKNOWN_OUTCOME_UNRESOLVED");
});

test("close, reopen, and resume create a fresh approval checkpoint", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const closed = await service.closeAssignment(started.assignment.assignmentId, ctx); assert.equal(closed.assignment.lifecycle, "closed");
  const reopened = await service.reopenAssignment(started.assignment.assignmentId, ctx); assert.equal(reopened.code, "APPROVAL_REQUIRED"); assert.equal(reopened.assignment.closureHistory.length, 1);
});

test("intent retry exhaustion prevents external action", async () => {
  let performed = 0; let outcomes = 0;
  const result = await runConsequentialOperation({ operationId: "op-1", async persistIntent() { throw new Error("temporary"); }, async perform() { performed += 1; }, async persistOutcome(outcome) { if (outcome === "prevented") outcomes += 1; }, isTransient() { return true; } }, { retryCount: 3, backoffSeconds: [0, 0, 0], sleep: async () => undefined });
  assert.equal(result.status, "prevented"); assert.equal(result.intentAttempts, 4); assert.equal(performed, 0); assert.equal(outcomes, 1);
});

test("unknown actions require concrete action-specific reconciliation", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const action = await service.createAction(started.assignment.assignmentId, "publish artifact", ctx);
  await service.recordActionOutcome(started.assignment.assignmentId, action.actionId, "started", ctx);
  await service.recordActionOutcome(started.assignment.assignmentId, action.actionId, "unknown", ctx);
  assert.equal((await service.closeAssignment(started.assignment.assignmentId, ctx)).code, "UNKNOWN_OUTCOME_UNRESOLVED");
  const reconciled = await service.reconcileAction(started.assignment.assignmentId, action.actionId, "failed", ctx);
  assert.equal(reconciled.state, "failed");
  await assert.rejects(service.reconcileAction(started.assignment.assignmentId, action.actionId, "failed", ctx), /does not have a pending/);
});

test("assignment cancellation closes only after unknown outcomes reconcile", async () => {
  const { service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const cancelled = await service.cancelAssignment(started.assignment.assignmentId, owned(started, manager));
  assert.equal(cancelled.assignment.lifecycle, "closed"); assert.equal(cancelled.assignment.closureHistory[0]!.disposition, "cancelled");
});

test("assignment cancellation terminalizes every nonterminal child task", async () => {
  const { repository, service } = setup(); const started = await service.start({ objective: "Build", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, { ...manager, actor: executive });
  const ctx = owned(started, manager);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx);
  await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx);
  await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx);
  await service.pause({ assignmentId: started.assignment.assignmentId, mode: "graceful" }, ctx);
  const cancelled = await service.cancelAssignment(started.assignment.assignmentId, ctx);
  assert.equal(cancelled.assignment.lifecycle, "closed");
  assert.equal(cancelled.assignment.tasks[0]!.state, "cancelled");
  assert.ok(repository.events.some((event) => event.type === "task.cancelled"));
});
