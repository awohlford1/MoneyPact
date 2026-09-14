import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentWorkflowError } from "../../src/contracts/errors.ts";
import {
  acceptOwnershipTransfer,
  acquireOperationLock,
  acquireOwnershipLease,
  releaseOperationLock,
  requestOwnershipTransfer,
  withAssignmentWriteLock,
} from "../../src/concurrency/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";

async function createStateRoot(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-locks-"));
  return (await initializeStateRoot(projectRoot)).stateRoot;
}

test("operation locks serialize conflicting resources", async () => {
  const stateRoot = await createStateRoot();
  const first = await acquireOperationLock({ stateRoot, resource: "record-1", ownerId: "owner-1" });
  await assert.rejects(
    acquireOperationLock({ stateRoot, resource: "record-1", ownerId: "owner-2", timeoutMs: 20, retryMs: 2 }),
    (error) => error instanceof AgentWorkflowError && error.code === "LOCK_TIMEOUT",
  );
  await releaseOperationLock(first);
  const second = await acquireOperationLock({ stateRoot, resource: "record-1", ownerId: "owner-2" });
  await releaseOperationLock(second);
});

test("long assignment operations renew their lock and exclude contenders", async () => {
  const stateRoot = await createStateRoot();
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(stateRoot, "assignments", "asn-long"), { recursive: true }));
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const first = withAssignmentWriteLock({
    stateRoot, assignmentId: "asn-long", ownerId: "owner-long", leaseMs: 300, timeoutMs: 2_000,
  }, async () => { entered(); await new Promise((resolve) => setTimeout(resolve, 900)); });
  await started;
  await new Promise((resolve) => setTimeout(resolve, 500));
  await assert.rejects(
    withAssignmentWriteLock({ stateRoot, assignmentId: "asn-long", ownerId: "owner-contender", leaseMs: 300, timeoutMs: 100, retryMs: 5 }, async () => undefined),
    (error) => error instanceof AgentWorkflowError && error.code === "LOCK_TIMEOUT",
  );
  await first;
});

test("only one contender can take over an expired lock", async () => {
  const stateRoot = await createStateRoot();
  const expired = await acquireOperationLock({ stateRoot, resource: "stale-race", ownerId: "expired-owner", leaseMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const attempts = await Promise.allSettled([
    acquireOperationLock({ stateRoot, resource: "stale-race", ownerId: "contender-a", timeoutMs: 40, retryMs: 2 }),
    acquireOperationLock({ stateRoot, resource: "stale-race", ownerId: "contender-b", timeoutMs: 40, retryMs: 2 }),
  ]);
  const winners = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireOperationLock>>> => result.status === "fulfilled");
  assert.equal(winners.length, 1);
  await releaseOperationLock(winners[0]!.value);
  await assert.rejects(releaseOperationLock(expired), (error) => error instanceof AgentWorkflowError && error.code === "LOCK_NOT_OWNED");
});

test("ownership transfer requires explicit receiver acceptance", async () => {
  const stateRoot = await createStateRoot();
  const first = await acquireOwnershipLease({ stateRoot, assignmentId: "asn-1", managerInstanceId: "manager-a" });
  await assert.rejects(
    acceptOwnershipTransfer({ stateRoot, assignmentId: "asn-1", managerInstanceId: "manager-b", previousToken: first.token }),
    (error) => error instanceof AgentWorkflowError && error.code === "LEASE_TRANSFER_INVALID",
  );
  await requestOwnershipTransfer({
    stateRoot, assignmentId: "asn-1", managerInstanceId: "manager-a", token: first.token,
    receiverManagerInstanceId: "manager-b",
  });
  const accepted = await acceptOwnershipTransfer({ stateRoot, assignmentId: "asn-1", managerInstanceId: "manager-b", previousToken: first.token });
  assert.equal(accepted.managerInstanceId, "manager-b");
  assert.notEqual(accepted.token, first.token);
});
