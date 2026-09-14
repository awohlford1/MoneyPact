import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyRawResponseCleanup, planRawResponseCleanup, SCHEDULER_EXIT } from "../../src/cleanup/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";
import { saveHold } from "../../src/retention/index.ts";

async function fixture() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-cleanup-"));
  const { stateRoot } = await initializeStateRoot(projectRoot);
  await mkdir(path.join(stateRoot, "raw-responses"), { recursive: true });
  await writeFile(path.join(stateRoot, "raw-responses", "old.json"), JSON.stringify({
    record_id: "raw-old", recorded_at: "2026-09-01T00:00:00.000Z", content: "discard me",
  }));
  return stateRoot;
}

test("raw-response cleanup is bounded, dry-run-safe, and writes metadata-only receipts", async () => {
  const stateRoot = await fixture();
  const dryRun = await planRawResponseCleanup({
    stateRoot, operationId: "clean-dry", mode: "dry-run",
    now: new Date("2026-09-13T00:00:00Z"), maxEntries: 1,
  });
  assert.equal(dryRun.entries.length, 1);
  await access(path.join(stateRoot, "raw-responses", "old.json"));
  const apply = await planRawResponseCleanup({
    stateRoot, operationId: "clean-apply", mode: "apply",
    now: new Date("2026-09-13T00:00:00Z"), maxEntries: 1,
  });
  const result = await applyRawResponseCleanup(stateRoot, apply);
  assert.equal(result.deleted, 1);
  await assert.rejects(access(path.join(stateRoot, "raw-responses", "old.json")));
  const receipt = await import("node:fs/promises").then(({ readFile }) => readFile(result.manifestPath, "utf8"));
  assert.doesNotMatch(receipt, /discard me/);
  assert.equal(SCHEDULER_EXIT.success, 0);
});

test("scheduled no-op succeeds and permanent archive purge has no API", async () => {
  const stateRoot = await fixture();
  const plan = await planRawResponseCleanup({
    stateRoot, operationId: "clean-noop", mode: "apply",
    now: new Date("2026-09-02T00:00:00Z"),
  });
  assert.equal(plan.entries.length, 0);
  assert.equal((await applyRawResponseCleanup(stateRoot, plan)).status, "no-op");
  const cleanup = await import("../../src/cleanup/index.ts");
  assert.equal("purgeArchive" in cleanup, false);
});

test("cleanup loads persisted holds at plan and apply time", async () => {
  const stateRoot = await fixture();
  await saveHold(stateRoot, {
    schema_version: "1.0", record_id: "hold-raw", record_type: "hold", hold_id: "hold-raw",
    created_at: "2026-09-01T00:00:00.000Z", targets: [{ record_type: "raw-response", record_id: "raw-old" }],
    placed_by: { actor_id: "exec-1", actor_type: "executive" }, reason: "diagnostics", scope: "delete", status: "active",
  });
  const held = await planRawResponseCleanup({
    stateRoot, operationId: "clean-held", mode: "apply", now: new Date("2026-09-13T00:00:00Z"), holds: [],
  });
  assert.equal(held.entries.length, 0);

  const secondRoot = await fixture();
  const plan = await planRawResponseCleanup({
    stateRoot: secondRoot, operationId: "clean-late-hold", mode: "apply", now: new Date("2026-09-13T00:00:00Z"),
  });
  await saveHold(secondRoot, {
    schema_version: "1.0", record_id: "hold-late-raw", record_type: "hold", hold_id: "hold-late-raw",
    created_at: "2026-09-13T00:00:00.000Z", targets: [{ record_type: "raw-response", record_id: "raw-old" }],
    placed_by: { actor_id: "exec-1", actor_type: "executive" }, reason: "late diagnostics", scope: "delete", status: "active",
  });
  await assert.rejects(applyRawResponseCleanup(secondRoot, plan), /delete_hold/);
  await access(path.join(secondRoot, "raw-responses", "old.json"));
});
