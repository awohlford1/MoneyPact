import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentWorkflowError } from "../../src/contracts/errors.ts";
import {
  createAwaitingValidation,
  createPendingAction,
  readPendingAction,
  reconcilePendingAction,
  retryAwaitingValidation,
} from "../../src/reconciliation/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";

async function createStateRoot(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-reconcile-"));
  return (await initializeStateRoot(projectRoot)).stateRoot;
}

test("pending reconciliation rejects unknown and unrelated actions", async () => {
  const stateRoot = await createStateRoot();
  await createPendingAction(stateRoot, {
    schema_version: "1.0", record_id: "pending-act-1", record_type: "pending", pending_id: "pending-act-1", action_id: "act-1", assignment_id: "asn-1",
    status: "unresolved", observed_outcome: "unknown", created_at: new Date().toISOString(),
  });
  await assert.rejects(
    reconcilePendingAction(stateRoot, "act-1", {
      schema_version: "1.0", record_id: "reconciliation-2", record_type: "action-reconciliation", created_at: new Date().toISOString(), reconciliation_id: "reconciliation-2", action_id: "act-2", assignment_id: "asn-1", operation_id: "op-2",
      outcome: "succeeded", reconciled_at: new Date().toISOString(), rationale: "wrong action",
    }),
    (error) => error instanceof AgentWorkflowError && error.code === "PENDING_ACTION_MISMATCH",
  );
  await assert.rejects(
    reconcilePendingAction(stateRoot, "act-1", {
      schema_version: "1.0", record_id: "reconciliation-3", record_type: "action-reconciliation", created_at: new Date().toISOString(), reconciliation_id: "reconciliation-3", action_id: "act-1", assignment_id: "asn-1", operation_id: "op-3",
      outcome: "unknown" as "succeeded", reconciled_at: new Date().toISOString(), rationale: "still unknown",
    }),
    (error) => error instanceof AgentWorkflowError && error.code === "PENDING_INVALID_OUTCOME",
  );
  const reconciliation = {
    schema_version: "1.0" as const, record_id: "reconciliation-4", record_type: "action-reconciliation" as const, created_at: new Date().toISOString(), reconciliation_id: "reconciliation-4", action_id: "act-1", assignment_id: "asn-1", operation_id: "op-4",
    outcome: "failed" as const, reconciled_at: new Date().toISOString(), rationale: "confirmed failure",
  };
  const first = await reconcilePendingAction(stateRoot, "act-1", reconciliation);
  const retry = await reconcilePendingAction(stateRoot, "act-1", reconciliation);
  assert.equal(retry, first);
  assert.equal(await readPendingAction(stateRoot, "act-1"), undefined);
});

test("reference arrival retries immediately and accepts", async () => {
  const stateRoot = await createStateRoot();
  const start = new Date("2026-09-13T12:00:00Z");
  await createAwaitingValidation(stateRoot, {
    submissionId: "submission-1", original: { record_id: "record-1" }, missingReferences: ["task-1"],
    errors: [{ path: "/task_id", message: "missing reference" }], now: start,
  });
  let accepted = false;
  const result = await retryAwaitingValidation(
    stateRoot, "submission-1", () => ({ status: "accepted" }), async () => { accepted = true; },
    { now: new Date(start.getTime() + 100), triggeredByReferenceArrival: true },
  );
  assert.equal(result.status, "accepted");
  assert.equal(accepted, true);
});

test("deadline survives restart and preserves original in quarantine", async () => {
  const stateRoot = await createStateRoot();
  const start = new Date("2026-09-13T12:00:00Z");
  await createAwaitingValidation(stateRoot, {
    submissionId: "submission-2", original: { exact: "original" }, missingReferences: ["task-2"],
    errors: [{ path: "/task_id", message: "missing reference" }], now: start, timeoutSeconds: 60,
  });
  const result = await retryAwaitingValidation(
    stateRoot, "submission-2", () => ({ status: "accepted" }), async () => undefined,
    { now: new Date(start.getTime() + 60_001) },
  );
  assert.equal(result.status, "quarantined");
  if (result.status === "quarantined") assert.deepEqual(result.record?.submission, { exact: "original" });
  await access(path.join(stateRoot, "quarantine", "submission-2.original.json"));
});
