import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ClaudeProviderAdapter } from "../../src/providers/claude/index.ts";
import { persistRedactedRawResponse } from "../../src/providers/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";

test("blocking Claude adapter exposes an explicit deny decision", async () => {
  const adapter = new ClaudeProviderAdapter({ blockingPreToolHook: true });
  const decision = await adapter.decidePreToolUse({ hook_event_name: "PreToolUse", actor: { actor_id: "manager-test", actor_type: "manager" } }, () => ({ accepted: false, reason: "approval missing" }));
  assert.equal(decision.accepted, false);
  assert.deepEqual(decision.output, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "approval missing" } });
});

test("raw response persistence always redacts and adds retention metadata", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-raw-contract-"));
  const { stateRoot } = await initializeStateRoot(projectRoot);
  const target = await persistRedactedRawResponse(stateRoot, { responseId: "response-1", provider: "claude", sourceEvent: "PostToolUse", content: { token: "synthetic-secret", message: "ok" }, capturedAt: new Date("2026-09-13T00:00:00Z") });
  const text = await readFile(target, "utf8");
  assert.doesNotMatch(text, /synthetic-secret/);
  assert.match(text, /2026-09-20T00:00:00.000Z/);
});
