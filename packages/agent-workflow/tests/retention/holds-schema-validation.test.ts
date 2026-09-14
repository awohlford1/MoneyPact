import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { saveHold } from "../../src/retention/holds.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";

test("hold persistence rejects records that do not satisfy the published schema", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-hold-schema-"));
  const { stateRoot } = await initializeStateRoot(projectRoot);
  await assert.rejects(saveHold(stateRoot, {
    schema_version: "1.0", record_id: "hold-invalid", record_type: "hold", created_at: "not-a-time", hold_id: "hold-invalid",
    targets: [], placed_by: { actor_id: "manager-test", actor_type: "manager" }, reason: "test", scope: "archive", status: "active",
  }), /Invalid hold record/);
});
