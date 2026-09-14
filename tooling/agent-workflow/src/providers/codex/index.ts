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

export type CodexSignalType =
  | "session.started"
  | "session.ended"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "delegation.started"
  | "delegation.completed"
  | "wait.started"
  | "wait.completed"
  | "interruption.requested"
  | "interruption.completed"
  | "handover.requested"
  | "handover.completed"
  | "message.acknowledged"
  | "response.observed";

export interface CodexFrameworkReferences {
  assignmentId?: string;
  taskId?: string;
  executionId?: string;
  actionId?: string;
}

export interface NormalizedCodexSignal {
  schemaVersion: "1.0";
  provider: "codex";
  signalType: CodexSignalType;
  sourceEvent: string;
  occurredAt: string | null;
  actor: ActorRef;
  recordedBy: ActorRef;
  providerContext: ProviderContext;
  frameworkRefs: CodexFrameworkReferences;
  data: Readonly<Record<string, unknown>>;
  rawResponse?: unknown;
}

export interface CodexCommandDispatcher {
  dispatch<TPayload, TResult>(request: OperationRequest<TPayload>): Promise<OperationResult<TResult>>;
}

export const CODEX_PROVIDER_EVENTS = [
  "thread.started",
  "thread.ended",
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

export type CodexProviderEvent = (typeof CODEX_PROVIDER_EVENTS)[number];
export type CodexOperation = "thread" | "task" | "delegation" | "wait" | "interrupt" | "handover" | "acknowledge" | "raw_response";

export interface CodexAdapterOptions {
  adapterVersion?: string;
  dispatcher?: CodexCommandDispatcher;
  availableOperations?: readonly CodexOperation[];
  captureRawResponses?: boolean;
}

const CODEX_SIGNAL_MAP: Readonly<Record<CodexProviderEvent, CodexSignalType>> = {
  "thread.started": "session.started",
  "thread.ended": "session.ended",
  "task.started": "task.started",
  "task.completed": "task.completed",
  "task.failed": "task.failed",
  "delegation.started": "delegation.started",
  "delegation.completed": "delegation.completed",
  "wait.started": "wait.started",
  "wait.completed": "wait.completed",
  "interruption.requested": "interruption.requested",
  "interruption.completed": "interruption.completed",
  "handover.requested": "handover.requested",
  "handover.completed": "handover.completed",
  "message.acknowledged": "message.acknowledged",
  "response.observed": "response.observed",
};

const SECRET_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:sk|pk|ghp|github_pat|xox[baprs])-[-a-z0-9_]{8,})/gi;

function redactProviderData(value: unknown): unknown {
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

function invalid(message: string, path?: string): never {
  throw new AgentWorkflowError({
    code: "PROVIDER_CONTEXT_INVALID",
    message,
    ...(path === undefined ? {} : { path }),
  });
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(`${path} must be an object.`, path);
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

function normalizeActor(value: unknown, path: string) {
  const input = object(value, path);
  const actorType = requiredString(input.actorType ?? input.actor_type, `${path}.actorType`);
  if (!["executive", "manager", "specialist", "runtime", "external_system"].includes(actorType)) {
    return invalid(`${path}.actorType is not supported.`, `${path}.actorType`);
  }
  const displayName = optionalString(input.displayName ?? input.display_name, `${path}.displayName`);
  return {
    actorId: requiredString(input.actorId ?? input.actor_id, `${path}.actorId`),
    actorType: actorType as ProviderContext["actor"]["actorType"],
    ...(displayName === undefined ? {} : { displayName }),
    provider: "codex",
  };
}

function capability(level: EnforcementLevel, reason: string) {
  return { level, reason } as const;
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly provider = "codex";
  readonly #adapterVersion: string;
  readonly #dispatcher: CodexCommandDispatcher | undefined;
  readonly #available: ReadonlySet<CodexOperation>;
  readonly #captureRawResponses: boolean;

  constructor(options: CodexAdapterOptions = {}) {
    this.#adapterVersion = options.adapterVersion ?? "0.1.0";
    this.#dispatcher = options.dispatcher;
    this.#available = new Set(options.availableOperations ?? []);
    this.#captureRawResponses = options.captureRawResponses ?? false;
  }

  async capabilities(): Promise<CapabilityReport> {
    const has = (operation: CodexOperation) => this.#available.has(operation);
    return {
      provider: this.provider,
      adapterVersion: this.#adapterVersion,
      capabilities: {
        graceful_pause: capability(has("wait") && has("interrupt") ? "observed" : "instructed", has("wait") && has("interrupt")
          ? "Configured wait and interruption APIs expose checkpoint coordination, but do not guarantee provider process suspension."
          : "The manager is instructed to checkpoint; no observable control pair is configured."),
        force_interrupt: capability(has("interrupt") ? "enforced" : "unsupported", has("interrupt")
          ? "A configured interruption API can reject or issue the interruption request; completion must still be observed."
          : "No interruption operation is configured."),
        subagent_interrupt: capability(has("interrupt") ? "enforced" : "unsupported", has("interrupt")
          ? "A configured interruption operation can target a known Codex task."
          : "No task interruption operation is configured."),
        subagent_resume: capability(has("task") ? "observed" : "unsupported", has("task")
          ? "Task state can be observed; provider resumability remains dependent on the current task API."
          : "No task operation is configured."),
        message_acknowledgement: capability(has("acknowledge") ? "observed" : "unsupported", has("acknowledge")
          ? "The configured provider operation exposes acknowledgement signals."
          : "No acknowledgement signal is configured."),
        raw_response_capture: capability(this.#captureRawResponses && has("raw_response") ? "observed" : "unsupported", this.#captureRawResponses && has("raw_response")
          ? "Observable response payloads are captured after redaction."
          : "Raw-response capture is disabled or unavailable."),
        session_recovery: capability(has("thread") ? "observed" : "unsupported", has("thread")
          ? "Thread identity and state can be observed, but framework IDs remain authoritative."
          : "No thread operation is configured."),
        durable_handover: capability(this.#dispatcher === undefined ? "unsupported" : "enforced", this.#dispatcher === undefined
          ? "Durable handover requires a connected shared-runtime dispatcher."
          : "The connected shared runtime validates durable handover records; this does not transfer a live process."),
        live_process_handover: capability("unsupported", "Cross-provider live process takeover is outside Phase 1."),
      },
    };
  }

  async normalizeContext(input: unknown): Promise<ProviderContext> {
    const root = object(input, "providerContext");
    const contextActor = normalizeActor(root.actor ?? root.framework_actor, "providerContext.actor");
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
      actor: contextActor,
      ...(providerSessionId === undefined ? {} : { providerSessionId }),
      ...(providerThreadId === undefined ? {} : { providerThreadId }),
      ...(providerTaskId === undefined ? {} : { providerTaskId }),
      ...(providerProcessId === undefined ? {} : { providerProcessId }),
      ...(managerInstanceId === undefined ? {} : { managerInstanceId }),
      metadata,
    };
  }

  async translateEvent(input: unknown): Promise<NormalizedCodexSignal> {
    const root = object(input, "event");
    const eventType = requiredString(root.event_type ?? root.eventType, "event.event_type");
    if (!CODEX_PROVIDER_EVENTS.includes(eventType as CodexProviderEvent)) {
      return invalid(`Unknown Codex provider event: ${eventType}.`, "event.event_type");
    }
    const signalType = CODEX_SIGNAL_MAP[eventType as CodexProviderEvent];
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
      ? { actorId: "runtime:provider-codex", actorType: "runtime" as const, provider: "codex" }
      : normalizeActor(root.recorded_by, "event.recorded_by");
    const raw = root.raw_response;
    return {
      schemaVersion: "1.0",
      provider: "codex",
      signalType,
      sourceEvent: eventType,
      occurredAt: optionalString(root.occurred_at, "event.occurred_at") ?? null,
      actor: providerContext.actor,
      recordedBy,
      providerContext,
      frameworkRefs: references(root),
      data: redactProviderData(object(root.data ?? {}, "event.data")) as Record<string, unknown>,
      ...(this.#captureRawResponses && this.#available.has("raw_response") && raw !== undefined ? { rawResponse: redactProviderData(raw) } : {}),
    };
  }

  mapOperation(operation: CodexOperation): string {
    if (!this.#available.has(operation)) {
      throw new AgentWorkflowError({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        message: `Codex operation ${operation} is unavailable; no fallback was selected.`,
        details: { provider: this.provider, operation },
      });
    }
    return `codex.${operation}`;
  }

  async dispatch<TPayload, TResult>(request: OperationRequest<TPayload>): Promise<OperationResult<TResult>> {
    if (this.#dispatcher === undefined) {
      throw new AgentWorkflowError({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        message: "Codex command dispatch is not connected to the shared runtime.",
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
        message: `Codex capability ${name} is not enforceably available.`,
        details: { provider: this.provider, capability: name, level: evidence?.level ?? "unsupported" },
      });
    }
  }
}

function references(root: Record<string, unknown>): CodexFrameworkReferences {
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
