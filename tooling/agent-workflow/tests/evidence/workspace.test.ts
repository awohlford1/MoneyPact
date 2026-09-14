import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { captureGitWorkspaceSnapshot } from "../../src/evidence/index.ts";

const exec = promisify(execFile);

test("git workspace evidence is stable until tracked or untracked content changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-evidence-"));
  await exec("git", ["init"], { cwd: root });
  await exec("git", ["config", "user.email", "agent-workflow@example.invalid"], { cwd: root });
  await exec("git", ["config", "user.name", "Agent Workflow Test"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "initial\n");
  await exec("git", ["add", "tracked.txt"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });

  const first = await captureGitWorkspaceSnapshot(root, new Date("2026-09-13T12:00:00.000Z"));
  const second = await captureGitWorkspaceSnapshot(root, new Date("2026-09-13T12:01:00.000Z"));
  assert.equal(first.digest, second.digest);
  assert.notEqual(first.capturedAt, second.capturedAt);

  await writeFile(path.join(root, "untracked.txt"), "new evidence\n");
  const changed = await captureGitWorkspaceSnapshot(root);
  assert.notEqual(changed.digest, first.digest);
});
