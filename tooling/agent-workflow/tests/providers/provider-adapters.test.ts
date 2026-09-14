import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AgentWorkflowError, PROVIDER_CAPABILITIES, type OperationRequest } from "../../src/contracts/index.ts";
import {
  CLAUDE_HOOK_EVENTS,
  ClaudeProviderAdapter,
  preToolUseOutput,
  redactProviderData,
} from "../../src/providers/claude/index.ts";
import {
  CODEX_PROVIDER_EVENTS,
  CodexProviderAdapter,
} from "../../src/providers/codex/index.ts";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof AgentWorkflowError ? error.code : undefined;
}

test("equivalent provider session inputs normalize to the same signal shape", async () => {
  const claude = await new ClaudeProviderAdapter().translateHook(await fixture("claude-session-start.json"));
  const codex = await new CodexProviderAdapter({ availableOperations: ["thread"] }).translateEvent(await fixture("codex-thread-start.json"));

  assert.equal(claude.signalType, "session.started");
  assert.equal(codex.signalType, "session.started");
  assert.equal(claude.actor.actorId, codex.actor.actorId);
  assert.equal(claude.actor.actorType, codex.actor.actorType);
  assert.deepEqual(claude.frameworkRefs, codex.frameworkRefs);
  assert.equal(claude.occurredAt, codex.occurredAt);
  assert.equal(claude.providerContext.providerSessionId, "claude-session-fixture");
  assert.equal(codex.providerContext.providerThreadId, "codex-thread-fixture");
  assert.notEqual(claude.providerContext.providerSessionId, claude.actor.actorId);
});

test("all exposed provider events have explicit non-core mappings", async () => {
  const claude = new ClaudeProviderAdapter();
  for (const hook_event_name of CLAUDE_HOOK_EVENTS) {
    const signal = await claude.translateHook({
      hook_event_name,
      actor: { actor_id: "specialist-fixture", actor_type: "specialist" },
    });
    assert.ok(signal.signalType.length > 0);
    assert.equal(signal.sourceEvent, hook_event_name);
  }

  const codex = new CodexProviderAdapter();
  for (const event_type of CODEX_PROVIDER_EVENTS) {
    const signal = await codex.translateEvent({
      event_type,
      actor: { actor_id: "specialist-fixture", actor_type: "specialist" },
    });
    assert.ok(signal.signalType.length > 0);
    assert.equal(signal.sourceEvent, event_type);
  }
});

test("unknown provider events and malformed framework identity fail safely", async () => {
  await assert.rejects(
    new ClaudeProviderAdapter().translateHook({
      hook_event_name: "FutureHook",
      actor: { actor_id: "manager-fixture", actor_type: "manager" },
    }),
    (error) => errorCode(error) === "PROVIDER_CONTEXT_INVALID",
  );
  await assert.rejects(
    new CodexProviderAdapter().translateEvent({ event_type: "thread.started", thread_id: "provider-only" }),
    (error) => errorCode(error) === "PROVIDER_CONTEXT_INVALID",
  );
});

test("capabilities are deterministic, complete, and conservative", async () => {
  const claude = new ClaudeProviderAdapter({ blockingPreToolHook: true });
  const first = await claude.capabilities();
  const second = await claude.capabilities();
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.capabilities).sort(), [...PROVIDER_CAPABILITIES].sort());
  assert.equal(first.capabilities.live_process_handover?.level, "unsupported");
  assert.equal(first.capabilities.force_interrupt?.level, "unsupported");
  assert.equal(first.capabilities.durable_handover?.level, "unsupported");
  assert.equal(claude.hookCapabilities().PreToolUse.level, "observed");
  assert.match(claude.hookCapabilities().PreToolUse.reason, /authorization is not connected/);
  assert.equal(new ClaudeProviderAdapter({ blockingPreToolHook: true, workflowAuthorizationConnected: true }).hookCapabilities().PreToolUse.level, "enforced");
  assert.equal(claude.hookCapabilities().PostToolUse.level, "observed");
  assert.equal(claude.hookCapabilities().StopFailure.level, "observed");

  const codex = await new CodexProviderAdapter({
    availableOperations: ["thread", "task", "wait", "interrupt", "acknowledge"],
  }).capabilities();
  assert.equal(codex.capabilities.subagent_interrupt?.level, "enforced");
  assert.equal(codex.capabilities.subagent_resume?.level, "observed");
  assert.equal(codex.capabilities.live_process_handover?.level, "unsupported");
});

test("Claude hook output blocks rejected pre-tool operations without bypassing normal permissions", () => {
  assert.deepEqual(preToolUseOutput(true), {});
  assert.deepEqual(preToolUseOutput(false, "Intent could not be persisted."), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Intent could not be persisted.",
    },
  });
});

test("raw response capture is opt-in, observable, and redacted before exposure", async () => {
  const adapter = new ClaudeProviderAdapter({ captureRawResponses: true });
  const signal = await adapter.translateHook({
    hook_event_name: "PostToolUseFailure",
    actor: { actor_id: "specialist-fixture", actor_type: "specialist" },
    raw_response: {
      authorization: "Bearer synthetic-value-12345678",
      nested: { api_key: "synthetic-key-value", note: "Bearer another-value-12345678" },
    },
    data: { password: "synthetic-password" },
  });
  const serialized = JSON.stringify(signal);
  assert.ok(serialized.includes("[REDACTED]"));
  assert.ok(!serialized.includes("synthetic-password"));
  assert.ok(!serialized.includes("synthetic-key-value"));
  assert.ok(!serialized.includes("another-value-12345678"));

  const disabled = await new ClaudeProviderAdapter().translateHook({
    hook_event_name: "PostToolUse",
    actor: { actor_id: "specialist-fixture", actor_type: "specialist" },
    raw_response: { result: "not retained" },
  });
  assert.equal("rawResponse" in disabled, false);
  assert.deepEqual(redactProviderData({ token: "value" }), { token: "[REDACTED]" });
});

test("unsupported operations never silently fall back", async () => {
  const adapter = new CodexProviderAdapter({ availableOperations: ["task"] });
  assert.equal(adapter.mapOperation("task"), "codex.task");
  assert.throws(
    () => adapter.mapOperation("interrupt"),
    (error) => errorCode(error) === "PROVIDER_CAPABILITY_UNAVAILABLE",
  );
  await assert.rejects(
    adapter.requireCapability("message_acknowledgement"),
    (error) => errorCode(error) === "PROVIDER_CAPABILITY_UNAVAILABLE",
  );
});

test("runtime command dispatch remains injectable and policy-free", async () => {
  const seen: OperationRequest[] = [];
  const adapter = new CodexProviderAdapter({
    dispatcher: {
      async dispatch(request) {
        seen.push(request);
        return { operationId: request.operationId, status: "succeeded", eventIds: [] };
      },
    },
  });
  const request: OperationRequest = {
    operationId: "operation-fixture",
    command: "status",
    actor: { actorId: "manager-fixture", actorType: "manager" },
    projectRoot: "project-fixture",
    payload: {},
  };
  const result = await adapter.dispatch(request);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(seen, [request]);

  await assert.rejects(
    new ClaudeProviderAdapter().dispatch(request),
    (error) => errorCode(error) === "PROVIDER_CAPABILITY_UNAVAILABLE",
  );
});

test("recorded provider fixtures contain no raw response or secret-like fields", async () => {
  for (const name of ["claude-session-start.json", "codex-thread-start.json"]) {
    const contents = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(contents, /authorization|password|secret|token|api[_-]?key|raw_response/i);
  }
});

test("integration templates are parseable and retain conservative installation defaults", async () => {
  const claudeTemplate = JSON.parse(await readFile(
    new URL("../../integrations/claude/hooks.template.json", import.meta.url),
    "utf8",
  )) as { hooks: Record<string, { hooks: { type: string; command: string }[] }[]> };
  assert.equal(claudeTemplate.hooks.PreToolUse?.[0]?.hooks[0]?.type, "command");
  assert.match(claudeTemplate.hooks.PreToolUse?.[0]?.hooks[0]?.command ?? "", /agentWorkflowCommand/);

  const codexTemplate = JSON.parse(await readFile(
    new URL("../../integrations/codex/capabilities.template.json", import.meta.url),
    "utf8",
  )) as { operations: Record<string, boolean> };
  assert.ok(Object.values(codexTemplate.operations).every((available) => available === false));
});
