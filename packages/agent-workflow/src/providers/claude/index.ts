import {
  AgentWorkflowError,
  type ActorRef,
  type CapabilityReport,
  type EnforcementLevel,
  type OperationRequest,
  type OperationResult,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderContext,
} from "../../contracts/index.ts";

export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

export const NORMALIZED_PROVIDER_SIGNALS = [
  "session.started",
  "session.ended",
  "tool.intent_observed",
  "tool.succeeded",
  "tool.failed",
  "subagent.started",
  "subagent.stopped",
  "manager.stop_observed",
  "manager.stop_failed",
  "task.started",
  "task.completed",
  "task.failed",
  "delegation.started",
  "delegation.completed",
  "wait.started",
  "wait.completed",
  "interruption.requested",
  "interruption.completed",
  "handover.requested",
  "handover.completed",
  "message.acknowledged",
  "response.observed",
] as const;

export type NormalizedProviderSignalType = (typeof NORMALIZED_PROVIDER_SIGNALS)[number];

export interface FrameworkReferences {
  assignmentId?: string;
  taskId?: string;
  executionId?: string;
  actionId?: string;
}

export interface NormalizedProviderSignal {
  schemaVersion: "1.0";
  provider: "claude" | "codex";
  signalType: NormalizedProviderSignalType;
  sourceEvent: string;
  occurredAt: string | null;
  actor: ActorRef;
  recordedBy: ActorRef;
  providerContext: ProviderContext;
  frameworkRefs: FrameworkReferences;
  data: Readonly<Record<string, unknown>>;
  rawResponse?: unknown;
}

export interface ProviderCommandDispatcher {
  dispatch<TPayload, TResult>(request: OperationRequest<TPayload>): Promise<OperationResult<TResult>>;
}

export interface ClaudeAdapterOptions {
  adapterVersion?: string;
  dispatcher?: ProviderCommandDispatcher;
  captureRawResponses?: boolean;
  blockingPreToolHook?: boolean;
  workflowAuthorizationConnected?: boolean;
}

const SECRET_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:sk|pk|ghp|github_pat|xox[baprs])-[-a-z0-9_]{8,})/gi;

function invalid(message: string, path?: string): never {
  throw new AgentWorkflowError({
    code: "PROVIDER_CONTEXT_INVALID",
    message,
    ...(path === undefined ? {} : { path }),
  });
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${path} must be an object.`, path);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0) return invalid(`${path} must be a non-empty string.`, path);
  return value;
}

function requiredString(value: unknown, path: string): string {
  return optionalString(value, path) ?? invalid(`${path} is required.`, path);
}

function actor(value: unknown, path: string): ActorRef {
  const input = object(value, path);
  const actorType = requiredString(input.actorType ?? input.actor_type, `${path}.actorType`);
  if (!["executive", "manager", "specialist", "runtime", "external_system"].includes(actorType)) {
    return invalid(`${path}.actorType is not a supported actor type.`, `${path}.actorType`);
  }
  const displayName = optionalString(input.displayName ?? input.display_name, `${path}.displayName`);
  const provider = optionalString(input.provider, `${path}.provider`);
  return {
    actorId: requiredString(input.actorId ?? input.actor_id, `${path}.actorId`),
    actorType: actorType as ActorRef["actorType"],
    ...(displayName === undefined ? {} : { displayName }),
    ...(provider === undefined ? {} : { provider }),
  };
}

/** Redacts secret-bearing keys and common credential-shaped string values. */
export function redactProviderData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProviderData);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : redactProviderData(item),
      ]),
    );
  }
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
  return value;
}

const CLAUDE_SIGNAL_MAP: Readonly<Record<ClaudeHookEvent, NormalizedProviderSignalType>> = {
  SessionStart: "session.started",
  PreToolUse: "tool.intent_observed",
  PostToolUse: "tool.succeeded",
  PostToolUseFailure: "tool.failed",
  SubagentStart: "subagent.started",
  SubagentStop: "subagent.stopped",
  Stop: "manager.stop_observed",
  StopFailure: "manager.stop_failed",
  SessionEnd: "session.ended",
};

export interface ClaudePreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
}

/**
 * Produces a blocking response only for a rejected operation. An accepted
 * operation returns no decision so Claude's normal permission flow still runs.
 */
export function preToolUseOutput(accepted: boolean, reason?: string): ClaudePreToolUseOutput | Record<string, never> {
  if (accepted) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason ?? "The Agent Workflow runtime rejected this managed operation.",
    },
  };
}

export interface ClaudePreToolUseDecision {
  signal: NormalizedProviderSignal;
  accepted: boolean;
  output: ClaudePreToolUseOutput | Record<string, never>;
}

function capability(level: EnforcementLevel, reason: string) {
  return { level, reason } as const;
}

export class ClaudeProviderAdapter implements ProviderAdapter {
  readonly provider = "claude";
  readonly #adapterVersion: string;
  readonly #dispatcher: ProviderCommandDispatcher | undefined;
  readonly #captureRawResponses: boolean;
  readonly #blockingPreToolHook: boolean;
  readonly #workflowAuthorizationConnected: boolean;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.#adapterVersion = options.adapterVersion ?? "0.1.0";
    this.#dispatcher = options.dispatcher;
    this.#captureRawResponses = options.captureRawResponses ?? false;
    this.#blockingPreToolHook = options.blockingPreToolHook ?? false;
    this.#workflowAuthorizationConnected = options.workflowAuthorizationConnected ?? false;
  }

  async capabilities(): Promise<CapabilityReport> {
    return {
      provider: this.provider,
      adapterVersion: this.#adapterVersion,
      capabilities: {
        graceful_pause: capability("instructed", "The manager can request a checkpoint, but provider process suspension is not guaranteed by hooks."),
        force_interrupt: capability("unsupported", "No portable Claude hook proves immediate process interruption."),
        subagent_interrupt: capability("unsupported", "Hook observation does not provide a portable sub-agent interruption control."),
        subagent_resume: capability("unsupported", "Provider sub-agent identifiers are provenance and are not durable resume handles."),
        message_acknowledgement: capability("unsupported", "Claude hooks do not provide a portable delivery acknowledgement."),
        raw_response_capture: capability(this.#captureRawResponses ? "observed" : "unsupported", this.#captureRawResponses
          ? "Observable hook response fields are captured after redaction."
          : "Raw-response capture is disabled or unavailable."),
        session_recovery: capability("observed", "Session identifiers may be recorded, but resumability is provider-controlled."),
        durable_handover: capability(this.#dispatcher === undefined ? "unsupported" : "enforced", this.#dispatcher === undefined
          ? "Durable handover requires a connected shared-runtime dispatcher."
          : "The connected shared runtime validates durable handover records; this does not transfer a live process."),
        live_process_handover: capability("unsupported", "A live Claude sub-agent cannot be transferred to another provider."),
      },
    };
  }

  hookCapabilities(): Readonly<Record<ClaudeHookEvent, { level: EnforcementLevel; reason: string }>> {
    return {
      SessionStart: capability("observed", "The hook observes session startup."),
      PreToolUse: capability(this.#blockingPreToolHook && this.#workflowAuthorizationConnected ? "enforced" : "observed", this.#blockingPreToolHook && this.#workflowAuthorizationConnected
        ? "The installed pre-tool hook is connected to workflow authorization and blocks rejected operations."
        : this.#blockingPreToolHook
          ? "The hook can deny persistence failures, but workflow authorization is not connected."
          : "The installed pre-tool hook is observational."),
      PostToolUse: capability("observed", "The hook observes a reported tool result."),
      PostToolUseFailure: capability("observed", "The hook observes a reported tool failure."),
      SubagentStart: capability("observed", "The hook observes sub-agent startup."),
      SubagentStop: capability("observed", "The hook observes sub-agent stop."),
      Stop: capability("observed", "The hook observes a manager stop request."),
      StopFailure: capability("observed", "The hook observes a provider-reported stop failure."),
      SessionEnd: capability("observed", "The hook observes session end."),
    };
  }

  async normalizeContext(input: unknown): Promise<ProviderContext> {
    const root = object(input, "providerContext");
    const contextActor = actor(root.actor ?? root.framework_actor, "providerContext.actor");
    const metadataValue = root.metadata === undefined ? {} : object(root.metadata, "providerContext.metadata");
    const metadata = redactProviderData(metadataValue) as Record<string, string | number | boolean | null>;
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        return invalid(`providerContext.metadata.${key} must be a scalar value.`, `providerContext.metadata.${key}`);
      }
    }
    const providerSessionId = optionalString(root.session_id ?? root.providerSessionId, "providerContext.session_id");
    const providerThreadId = optionalString(root.thread_id ?? root.providerThreadId, "providerContext.thread_id");
    const providerTaskId = optionalString(root.task_id ?? root.providerTaskId, "providerContext.task_id");
    const providerProcessId = optionalString(root.process_id ?? root.providerProcessId, "providerContext.process_id");
    const managerInstanceId = optionalString(root.manager_instance_id ?? root.managerInstanceId, "providerContext.manager_instance_id");
    return {
      provider: this.provider,
      actor: { ...contextActor, provider: this.provider },
      ...(providerSessionId === undefined ? {} : { providerSessionId }),
      ...(providerThreadId === undefined ? {} : { providerThreadId }),
      ...(providerTaskId === undefined ? {} : { providerTaskId }),
      ...(providerProcessId === undefined ? {} : { providerProcessId }),
      ...(managerInstanceId === undefined ? {} : { managerInstanceId }),
      metadata,
    };
  }

  async translateHook(input: unknown): Promise<NormalizedProviderSignal> {
    const root = object(input, "hook");
    const hookEventName = requiredString(root.hook_event_name ?? root.hookEventName, "hook.hook_event_name");
    if (!CLAUDE_HOOK_EVENTS.includes(hookEventName as ClaudeHookEvent)) {
      return invalid(`Unknown Claude hook event: ${hookEventName}.`, "hook.hook_event_name");
    }
    const providerContext = await this.normalizeContext({
      actor: root.actor ?? root.framework_actor,
      session_id: root.session_id,
      thread_id: root.thread_id,
      task_id: root.provider_task_id,
      process_id: root.process_id,
      manager_instance_id: root.manager_instance_id,
      metadata: root.provider_metadata ?? {},
    });
    const recordedBy = root.recorded_by === undefined
      ? { actorId: "runtime:provider-claude", actorType: "runtime" as const, provider: "claude" }
      : actor(root.recorded_by, "hook.recorded_by");
    const raw = root.raw_response ?? root.tool_response ?? root.error;
    return {
      schemaVersion: "1.0",
      provider: "claude",
      signalType: CLAUDE_SIGNAL_MAP[hookEventName as ClaudeHookEvent],
      sourceEvent: hookEventName,
      occurredAt: optionalString(root.occurred_at, "hook.occurred_at") ?? null,
      actor: providerContext.actor,
      recordedBy,
      providerContext,
      frameworkRefs: references(root),
      data: redactProviderData(object(root.data ?? {}, "hook.data")) as Record<string, unknown>,
      ...(this.#captureRawResponses && raw !== undefined ? { rawResponse: redactProviderData(raw) } : {}),
    };
  }

  async decidePreToolUse(input: unknown, authorize: (signal: NormalizedProviderSignal) => Promise<{ accepted: boolean; reason?: string }> | { accepted: boolean; reason?: string }): Promise<ClaudePreToolUseDecision> {
    const signal = await this.translateHook(input);
    if (signal.sourceEvent !== "PreToolUse") invalid("Blocking decisions are only valid for PreToolUse.", "hook.hook_event_name");
    if (!this.#blockingPreToolHook) invalid("The Claude adapter is not configured for blocking PreToolUse decisions.");
    const decision = await authorize(signal);
    return { signal, accepted: decision.accepted, output: preToolUseOutput(decision.accepted, decision.reason) };
  }

  async dispatch<TPayload, TResult>(request: OperationRequest<TPayload>): Promise<OperationResult<TResult>> {
    if (this.#dispatcher === undefined) {
      throw new AgentWorkflowError({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        message: "Claude command dispatch is not connected to the shared runtime.",
        details: { provider: this.provider, operationId: request.operationId },
      });
    }
    return this.#dispatcher.dispatch<TPayload, TResult>(request);
  }

  async requireCapability(name: ProviderCapability): Promise<void> {
    const evidence = (await this.capabilities()).capabilities[name];
    if (evidence === undefined || evidence.level === "unsupported" || evidence.level === "instructed") {
      throw new AgentWorkflowError({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        message: `Claude capability ${name} is not enforceably available.`,
        details: { provider: this.provider, capability: name, level: evidence?.level ?? "unsupported" },
      });
    }
  }
}

function references(root: Record<string, unknown>): FrameworkReferences {
  const assignmentId = optionalString(root.assignment_id, "assignment_id");
  const taskId = optionalString(root.framework_task_id, "framework_task_id");
  const executionId = optionalString(root.execution_id, "execution_id");
  const actionId = optionalString(root.action_id, "action_id");
  return {
    ...(assignmentId === undefined ? {} : { assignmentId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(executionId === undefined ? {} : { executionId }),
    ...(actionId === undefined ? {} : { actionId }),
  };
}
