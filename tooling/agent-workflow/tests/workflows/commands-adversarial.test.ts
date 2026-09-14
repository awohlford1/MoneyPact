import assert from "node:assert/strict";
import test from "node:test";
import defaults from "../../defaults/config.json" with { type: "json" };
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";
import { MemoryWorkflowRepository, WorkflowCommandService } from "../../src/commands/index.ts";

const executive = { actorId: "executive-1", actorType: "executive" as const };
const context = { actor: executive, managerInstanceId: "mgr-1", now: () => new Date("2026-01-01T00:00:00Z") };
const adapter = { async requestStop() { return { confirmed: true, checkpointId: "chk-stop" }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; } };
const setup = (config = defaults as FrameworkConfiguration) => { const repository = new MemoryWorkflowRepository(); return { repository, service: new WorkflowCommandService(repository, config, adapter) }; };
const owned = (started: { assignment: { ownershipLease?: { token: string } } }) => ({ ...context, ownershipToken: started.assignment.ownershipLease!.token });

test("assignment transaction serializes concurrent mutations without lost updates", async () => {
  const { repository, service } = setup();
  const started = await service.start({ objective: "concurrency", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, context);
  const ctx = owned(started);
  await Promise.all(Array.from({ length: 20 }, (_, index) => service.createTask(started.assignment.assignmentId, [`src/${index}.ts`], ctx)));
  assert.equal((await repository.get(started.assignment.assignmentId))?.tasks.length, 20);
});

test("a crash inside an assignment transaction publishes neither staged state nor events", async () => {
  const repository = new MemoryWorkflowRepository();
  await assert.rejects(repository.transaction("asn-crash", async tx => {
    await tx.save({ assignmentId: "asn-crash" } as never);
    await tx.append({ type: "assignment.created", assignmentId: "asn-crash", actor: executive, data: {}, at: "2026-01-01T00:00:00Z" });
    throw new Error("simulated crash");
  }), /simulated crash/);
  assert.equal(await repository.get("asn-crash"), undefined); assert.equal(repository.events.length, 0);
});

test("expired renewable ownership lease rejects even when manager string matches", async () => {
  const { service } = setup();
  const started = await service.start({ objective: "lease", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, context);
  await assert.rejects(service.createTask(started.assignment.assignmentId, [], { ...owned(started), now: () => new Date("2026-01-01T00:06:00Z") }), /current ownership fencing token/);
});

test("state changes reject missing and stale fencing tokens", async () => {
  const { service } = setup();
  const started = await service.start({ objective: "fence", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, context);
  await assert.rejects(service.createTask(started.assignment.assignmentId, [], context), /current ownership fencing token/);
  await assert.rejects(service.createTask(started.assignment.assignmentId, [], { ...context, ownershipToken: "stale-token" }), /current ownership fencing token/);
  assert.ok(await service.createTask(started.assignment.assignmentId, [], owned(started)));
});

test("execution outcomes require the current owner", async () => {
  const { service } = setup();
  const started = await service.start({ objective: "owner", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, context);
  const ctx = owned(started);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx);
  const execution = await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx);
  await assert.rejects(service.recordExecutionOutcome(started.assignment.assignmentId, execution.executionId, "completed", { ...ctx, managerInstanceId: "mgr-attacker" }), /OWNERSHIP_REQUIRED/);
});

test("cancellation cannot close while an execution is still running", async () => {
  const { service } = setup();
  const started = await service.start({ objective: "cancel", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, context);
  const ctx = owned(started);
  const task = await service.createTask(started.assignment.assignmentId, [], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx); await service.beginExecution(started.assignment.assignmentId, task.taskId, ctx);
  const result = await service.cancelAssignment(started.assignment.assignmentId, ctx);
  assert.equal(result.status, "blocked"); assert.notEqual(result.assignment.lifecycle, "closed");
});

test("dispatch builds a durable compact task packet and enforces role/model policy", async () => {
  const config = structuredClone(defaults) as FrameworkConfiguration;
  config.providers.codex = { enabled: true }; config.models.roles.implementation = { allowed: ["codex:model-a"] };
  const { repository, service } = setup(config);
  const started = await service.start({ objective: "packet", approach: ["work"], acceptanceCriteria: ["done"], waiveApproval: true }, context);
  const ctx = owned(started);
  const task = await service.createTask(started.assignment.assignmentId, ["src/a.ts"], ctx); await service.transitionTask(started.assignment.assignmentId, task.taskId, "ready", ctx);
  await service.beginManagedExecution(started.assignment.assignmentId, task.taskId, "implementation", { objective: "Implement", scope: ["src/a.ts"], exclusions: [], acceptance_criteria: [{ id: "AC-1", text: "passes" }], permissions: ["edit src/a.ts"], constraints: [], expected_outputs: ["code"], requested_model: { provider: "codex", model: "model-a" } }, ctx);
  assert.equal((await repository.get(started.assignment.assignmentId))?.taskPackets?.length, 1);
  assert.deepEqual(repository.events.slice(-3).map(event => event.type), ["task.dispatch_requested", "task.dispatched", "execution.started"]);
});
