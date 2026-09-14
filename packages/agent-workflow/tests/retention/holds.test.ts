import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadHolds, releaseHold, saveHold, type HoldRecord } from "../../src/retention/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";

test("holds persist their actor, reason, scope, release, and idempotent release", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-hold-"));
  const { stateRoot } = await initializeStateRoot(projectRoot);
  const hold: HoldRecord = {
    schema_version: "1.0", record_id: "hold-1", record_type: "hold",
    created_at: "2026-09-13T00:00:00Z", hold_id: "hold-1",
    targets: [{ record_type: "assignment", record_id: "asn-1" }],
    placed_by: { actor_id: "exec-1", actor_type: "executive" },
    reason: "audit", scope: "archive_and_delete", status: "active",
  };
  await saveHold(stateRoot, hold);
  assert.deepEqual(await loadHolds(stateRoot), [hold]);
  const released = await releaseHold(stateRoot, "hold-1", "2026-09-14T00:00:00Z");
  assert.equal(released.status, "released");
  assert.deepEqual(await releaseHold(stateRoot, "hold-1", "2026-09-15T00:00:00Z"), released);
});
