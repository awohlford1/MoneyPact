import assert from "node:assert/strict";
import test from "node:test";
import defaults from "../../defaults/config.json" with { type: "json" };
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";
import { AssignmentSelectionError, MemoryWorkflowRepository, resolveAssignmentReference, WorkflowCommandService } from "../../src/commands/index.ts";

const adapter = {
  async requestStop() { return { confirmed: true }; },
  async createTransferPackage() { return { packageId: "pkg-1", valid: true }; },
  async transferOwnership() { return { accepted: true }; },
};
const context = { actor: { actorId: "executive-1", actorType: "executive" as const }, managerInstanceId: "mgr-stable" };

test("an omitted assignment ID resolves the sole applicable assignment owned by the manager", async () => {
  const repository = new MemoryWorkflowRepository();
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, adapter);
  const started = await service.start({ objective: "Current work", approach: ["inspect"], acceptanceCriteria: ["reported"], waiveApproval: true }, context);
  assert.equal(await resolveAssignmentReference({ repository, command: "status", managerInstanceId: context.managerInstanceId }), started.assignment.assignmentId);
});

test("status prefers one open assignment over closed history", async () => {
  const repository = new MemoryWorkflowRepository();
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, adapter);
  const historical = await service.start({ objective: "Historical work", approach: ["inspect"], acceptanceCriteria: ["reported"], waiveApproval: true }, context);
  await service.closeAssignment(historical.assignment.assignmentId, { ...context, ownershipToken: historical.assignment.ownershipLease!.token });
  const current = await service.start({ objective: "Current work", approach: ["inspect"], acceptanceCriteria: ["reported"], waiveApproval: true }, context);
  assert.equal(await resolveAssignmentReference({ repository, command: "status", managerInstanceId: context.managerInstanceId }), current.assignment.assignmentId);
});

test("ambiguous resolution returns structured human-readable candidates", async () => {
  const repository = new MemoryWorkflowRepository();
  const service = new WorkflowCommandService(repository, defaults as FrameworkConfiguration, adapter);
  await service.start({ objective: "First objective", approach: ["inspect"], acceptanceCriteria: ["reported"], waiveApproval: true }, context);
  await service.start({ objective: "Second objective", approach: ["inspect"], acceptanceCriteria: ["reported"], waiveApproval: true }, context);
  await assert.rejects(
    resolveAssignmentReference({ repository, command: "status", managerInstanceId: context.managerInstanceId }),
    (error: unknown) => error instanceof AssignmentSelectionError
      && error.code === "ASSIGNMENT_SELECTION_REQUIRED"
      && error.candidates.map((candidate) => candidate.objective).sort().join(",") === "First objective,Second objective"
      && /objective and lifecycle/.test(error.message),
  );
});

test("an explicit assignment ID remains an advanced override", async () => {
  const repository = new MemoryWorkflowRepository();
  assert.equal(await resolveAssignmentReference({ repository, command: "status", managerInstanceId: "mgr", assignmentId: "asn-explicit" }), "asn-explicit");
});
