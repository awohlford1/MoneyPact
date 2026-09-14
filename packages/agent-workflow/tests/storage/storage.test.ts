import assert from "node:assert/strict";
import { access, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentWorkflowError } from "../../src/contracts/errors.ts";
import {
  assertContainedStatePath,
  initializeStateRoot,
  resolveRecord,
  writeAssignmentRecord,
  writeJsonAtomic,
} from "../../src/storage/index.ts";

async function state(): Promise<{ projectRoot: string; stateRoot: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-storage-"));
  return initializeStateRoot(projectRoot);
}

test("initializes the canonical state layout", async () => {
  const { stateRoot } = await state();
  await access(path.join(stateRoot, "assignments"));
  await access(path.join(stateRoot, "shared", "evidence"));
  await access(path.join(stateRoot, "locks", "ownership"));
  await access(path.join(stateRoot, "archive"));
});

test("atomic canonical replacement never exposes partial JSON", async () => {
  const { stateRoot } = await state();
  await writeJsonAtomic(stateRoot, "ledger/current.json", { version: 1, content: "old" });
  const writes = Array.from({ length: 20 }, (_, index) =>
    writeJsonAtomic(stateRoot, "ledger/current.json", { version: index + 2, content: "x".repeat(10_000) }),
  );
  while (writes.length > 0) {
    JSON.parse(await readFile(path.join(stateRoot, "ledger", "current.json"), "utf8"));
    const settled = await Promise.race(writes.map(async (promise, index) => { await promise; return index; }));
    writes.splice(settled, 1);
  }
  JSON.parse(await readFile(path.join(stateRoot, "ledger", "current.json"), "utf8"));
});

test("immutable revisions resolve by logical ID", async () => {
  const { stateRoot } = await state();
  await writeAssignmentRecord({
    stateRoot, assignmentId: "asn-1", category: "plans", immutable: true,
    record: { record_type: "plan", record_id: "plan-1", revision: 1, assignment_id: "asn-1", schema_version: "1.0", created_at: "2026-09-13T12:00:00Z", title: "first" },
  });
  const resolved = await resolveRecord(stateRoot, "plan-1", 1);
  assert.equal(resolved.location, "active");
  assert.equal(resolved.record.title, "first");
  await assert.rejects(
    writeAssignmentRecord({
      stateRoot, assignmentId: "asn-1", category: "plans", immutable: true,
      record: { record_type: "plan", record_id: "plan-1", revision: 1, assignment_id: "asn-1", schema_version: "1.0", created_at: "2026-09-13T12:00:00Z", title: "changed" },
    }),
    (error) => error instanceof AgentWorkflowError && error.code === "STATE_RECORD_CONFLICT",
  );
});

test("rejects traversal and escaping links", async (context) => {
  const { projectRoot, stateRoot } = await state();
  await assert.rejects(assertContainedStatePath(stateRoot, "../escape.json"), (error) => error instanceof AgentWorkflowError && error.code === "STATE_PATH_ESCAPE");
  const outside = await mkdtemp(path.join(tmpdir(), "aw-outside-"));
  try { await symlink(outside, path.join(stateRoot, "escape-link"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { context.skip(`links unavailable on this platform: ${(error as Error).message}`); return; }
  await assert.rejects(assertContainedStatePath(stateRoot, "escape-link/file.json"), (error) => error instanceof AgentWorkflowError && error.code === "STATE_LINK_REJECTED");
  assert.notEqual(projectRoot, outside);
});
