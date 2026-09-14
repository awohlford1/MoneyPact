#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAssignmentArchive, planAssignmentArchive } from "../archive/index.ts";
import { applyRawResponseCleanup, planRawResponseCleanup } from "../cleanup/index.ts";
import { AssignmentSelectionError, resolveAssignmentReference, WorkflowCommandService, StateWorkflowRepository, runConsequentialOperation } from "../commands/index.ts";
import { loadEffectiveConfiguration } from "../config/index.ts";
import { MANAGED_WORKFLOW_COMMANDS, type ActorRef } from "../contracts/index.ts";
import { installConsumer, findConsumerRoot } from "../installer/index.ts";
import { appendEvent } from "../events/index.ts";
import { coreSchemaRegistry } from "../registries/index.ts";
import { initializeStateRoot, writeJsonAtomic } from "../storage/index.ts";
import type { JsonValue } from "../storage/index.ts";
import { capabilityReport, checkUpgradeCompatibility, doctor, FRAMEWORK_VERSION, SUPPORTED_SCHEMA_VERSION, validateInstallation } from "./diagnostics.ts";
import { ClaudeProviderAdapter } from "../providers/claude/index.ts";
import { CodexProviderAdapter } from "../providers/codex/index.ts";
import { persistRedactedRawResponse } from "../providers/index.ts";
import { quarantineSubmission, readQuarantineSubmission, resolveQuarantine } from "../reconciliation/index.ts";
import { acknowledgeHandover, controlStatus, handoverPackageId, interruptControlledExecution, isHandoverAcknowledged, launchControlledCli, markResponseCaptureObserved } from "../control/index.ts";
import type { NormalizedProviderSignal } from "../providers/claude/index.ts";
import { captureGitWorkspaceSnapshot } from "../evidence/index.ts";
import type { SignedExecutiveApprovalReceipt } from "../approvals/index.ts";

type Input = Record<string, unknown>;
function redactOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOutput);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key === "token" || key === "ownershipToken" ? "[REDACTED]" : redactOutput(item),
    ]));
  }
  return value;
}
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(process.argv.includes("--redact-output") ? redactOutput(value) : value, null, 2)}\n`);

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}
async function jsonInput(): Promise<Input> {
  const inline = option("json");
  if (inline) return JSON.parse(inline) as Input;
  if (process.stdin.isTTY) return {};
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.trim() === "" ? {} : JSON.parse(text) as Input;
}
function required(input: Input, key: string): string {
  const value = input[key] ?? option(key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required`);
  return value;
}
function actor(input: Input): ActorRef {
  const type = String(input.actorType ?? "manager") as ActorRef["actorType"];
  return { actorId: String(input.actorId ?? (type === "executive" ? "executive:local" : "manager:local")), actorType: type };
}
function adapter(root: string, stateDirectory: string) {
  return {
    async requestStop(input: { executionId: string; mode: "graceful" | "force"; timeoutMs?: number }) {
      const { stateRoot } = await initializeStateRoot(root, stateDirectory);
      const result = await interruptControlledExecution(stateRoot, input.executionId, input.mode, input.timeoutMs);
      return result.confirmed && result.checkpointId ? { confirmed: true, checkpointId: result.checkpointId } : { confirmed: result.confirmed };
    },
    async createTransferPackage(input: { assignment: { assignmentId: string; executions: Array<{ executionId: string; state: string }> }; receiverManagerInstanceId: string }) { const { stateRoot } = await initializeStateRoot(root, stateDirectory); const states = await Promise.all(input.assignment.executions.map(async (execution) => ({ execution, control: await controlStatus(stateRoot, execution.executionId) }))); return { packageId: handoverPackageId(input.assignment.assignmentId, input.receiverManagerInstanceId), valid: states.every(({ execution, control }) => execution.state !== "running" && execution.state !== "unknown" && (control === undefined || control.status === "stopped")) }; },
    async transferOwnership(input: { assignmentId: string; receiverManagerInstanceId: string }) { const { stateRoot } = await initializeStateRoot(root, stateDirectory); return { accepted: await isHandoverAcknowledged(stateRoot, input.assignmentId, input.receiverManagerInstanceId) }; },
  };
}
async function service(root: string) {
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  const repository = new StateWorkflowRepository({ projectRoot: root, stateDirectory: effective.config.state.directory, policySnapshot: { configuration_digest: effective.digest } });
  return { service: new WorkflowCommandService(repository, effective.config, adapter(root, effective.config.state.directory)), repository, effective };
}
function context(input: Input) {
  return { actor: actor(input), managerInstanceId: String(input.managerInstanceId ?? "mgr-local"), ...(typeof input.ownershipToken === "string" ? { ownershipToken: input.ownershipToken } : {}) };
}

function approvalReceipt(input: Input): SignedExecutiveApprovalReceipt | undefined {
  return input.approvalReceipt && typeof input.approvalReceipt === "object" ? input.approvalReceipt as SignedExecutiveApprovalReceipt : undefined;
}

/**
 * Persists a short-retention, redacted transcript entry for a framework-mediated
 * interaction. This is deliberately a managed, fenced write: raw diagnostic
 * material must be attributable to the current assignment owner, while the
 * content itself never appears in the command result or event payload.
 */
async function recordTranscript(root: string, current: Awaited<ReturnType<typeof service>>, input: Input, ctx: ReturnType<typeof context>) {
  const assignmentId = required(input, "assignmentId");
  const ownershipToken = ctx.ownershipToken;
  if (!ownershipToken) throw new Error("OWNERSHIP_REQUIRED: transcript-record requires a valid ownership token");
  await current.repository.validateOwnership?.(assignmentId, ctx.managerInstanceId, ownershipToken, new Date());

  const responseId = `raw-${randomUUID()}`;
  const kind = required(input, "kind");
  const { stateRoot } = await initializeStateRoot(root, current.effective.config.state.directory);
  const rawResponsePath = await persistRedactedRawResponse(stateRoot, {
    responseId,
    provider: "framework",
    sourceEvent: kind,
    content: input.content ?? {},
    retentionDays: current.effective.config.retention.rawResponsesDays,
    assignmentId,
    ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
    ...(typeof input.executionId === "string" ? { executionId: input.executionId } : {}),
  });
  await appendEvent({
    projectRoot: root, stateDirectory: current.effective.config.state.directory, operationId: `op-${randomUUID()}`,
    validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event",
    event: {
      schema_version: "1.0", event_id: `evt-${randomUUID()}`, event_type: "provider.signal_observed", occurred_at: new Date().toISOString(),
      actor: { actor_id: ctx.actor.actorId, actor_type: ctx.actor.actorType },
      recorded_by: { actor_id: "runtime-agent-workflow", actor_type: "runtime" },
      assignment_id: assignmentId,
      ...(typeof input.taskId === "string" ? { task_id: input.taskId } : {}),
      ...(typeof input.executionId === "string" ? { execution_id: input.executionId } : {}),
      provider_context: { provider: "framework" },
      data: { provider: "framework", signal: "transcript.recorded", details: { response_id: responseId, kind, retention_days: current.effective.config.retention.rawResponsesDays } },
    },
  });
  return { status: "succeeded", code: "TRANSCRIPT_RECORDED", responseId, rawResponsePath, retentionDays: current.effective.config.retention.rawResponsesDays };
}

async function managedQuarantine(root: string, current: Awaited<ReturnType<typeof service>>, command: "quarantine-submit" | "quarantine-show" | "quarantine-resolve", input: Input, ctx: ReturnType<typeof context>) {
  const assignmentId = required(input, "assignmentId");
  if (command !== "quarantine-show") {
    if (!ctx.ownershipToken) throw new Error("OWNERSHIP_REQUIRED: quarantine changes require an ownership token");
    await current.repository.validateOwnership?.(assignmentId, ctx.managerInstanceId, ctx.ownershipToken, new Date());
  }
  const { stateRoot } = await initializeStateRoot(root, current.effective.config.state.directory);
  const quarantineId = required(input, "quarantineId");
  if (command === "quarantine-show") return (await readQuarantineSubmission(stateRoot, quarantineId)) ?? { status: "not_found", quarantineId };
  if (command === "quarantine-submit") {
    const errors = input.validationErrors;
    if (!Array.isArray(errors) || errors.length === 0) throw new Error("VALIDATION_ERRORS_REQUIRED: quarantine requires one or more validation errors");
    const record = { schema_version: "1.0" as const, record_id: quarantineId, record_type: "quarantine" as const, created_at: new Date().toISOString(), quarantine_id: quarantineId, submission: (input.submission ?? {}) as JsonValue, validation_errors: errors, status: "unresolved" as const };
    const location = await quarantineSubmission(stateRoot, record as never);
    await appendEvent({ projectRoot: root, stateDirectory: current.effective.config.state.directory, operationId: `op-${randomUUID()}`, validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event", event: { schema_version: "1.0", event_id: `evt-${randomUUID()}`, event_type: "submission.rejected", occurred_at: new Date().toISOString(), actor: { actor_id: ctx.actor.actorId, actor_type: ctx.actor.actorType }, recorded_by: { actor_id: "runtime-agent-workflow", actor_type: "runtime" }, assignment_id: assignmentId, data: { submission_id: quarantineId } } });
    return { status: "quarantined", quarantineId, location };
  }
  const resolution = required(input, "resolution"); const disposition = required(input, "disposition");
  if (disposition !== "corrected" && disposition !== "dismissed") throw new Error("QUARANTINE_DISPOSITION_INVALID");
  const location = await resolveQuarantine(stateRoot, { schema_version: "1.0", quarantine_id: quarantineId, resolution_id: `qres-${randomUUID()}`, disposition, resolved_at: new Date().toISOString(), actor_id: ctx.actor.actorId, rationale: resolution, ...(typeof input.replacementRecordId === "string" ? { replacement_record_id: input.replacementRecordId } : {}) });
  await appendEvent({ projectRoot: root, stateDirectory: current.effective.config.state.directory, operationId: `op-${randomUUID()}`, validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event", event: { schema_version: "1.0", event_id: `evt-${randomUUID()}`, event_type: "quarantine.resolved", occurred_at: new Date().toISOString(), actor: { actor_id: ctx.actor.actorId, actor_type: ctx.actor.actorType }, recorded_by: { actor_id: "runtime-agent-workflow", actor_type: "runtime" }, assignment_id: assignmentId, data: { record_ref: { record_type: "quarantine", record_id: quarantineId } } } });
  return { status: "resolved", quarantineId, location };
}

async function executeManagerCommand(root: string, command: string, input: Input): Promise<unknown> {
  const current = await service(root); const ctx = context(input); const svc = current.service;
  if (command !== "start" && (typeof input.assignmentId !== "string" || input.assignmentId.length === 0)) {
    input = { ...input, assignmentId: await resolveAssignmentReference({ repository: current.repository, command, managerInstanceId: ctx.managerInstanceId }) };
  }
  switch (command) {
    case "start": {
      if (input.waiveApproval === true && current.effective.config.security.executiveApproval.mode === "signed_ed25519") throw new Error("SIGNED_WAIVER_REQUIRES_APPROVAL_ID: start first, then use waive-plan with a signed receipt");
      return svc.start({ objective: required(input, "objective"), approach: (input.approach ?? []) as string[], acceptanceCriteria: (input.acceptanceCriteria ?? []) as string[], waiveApproval: input.waiveApproval === true }, ctx);
    }
    case "resume": {
      if (input.waiveApproval === true && current.effective.config.security.executiveApproval.mode === "signed_ed25519") throw new Error("SIGNED_WAIVER_REQUIRES_APPROVAL_ID: resume without waiver, then use waive-plan with a signed receipt");
      return svc.resume({ assignmentId: required(input, "assignmentId"), waiveApproval: input.waiveApproval === true }, ctx);
    }
    case "status": return svc.status(required(input, "assignmentId"), ctx);
    case "ask": return svc.ask(required(input, "assignmentId"), required(input, "question"), ctx);
    case "steer": return svc.steer({ assignmentId: required(input, "assignmentId"), paths: (input.paths ?? []) as string[], rationale: required(input, "rationale"), approach: (input.approach ?? []) as string[], acceptanceCriteria: (input.acceptanceCriteria ?? []) as string[] }, ctx);
    case "pause": return svc.pause({ assignmentId: required(input, "assignmentId"), ...(input.mode ? { mode: input.mode as "graceful" | "force" } : {}), ...(input.timeoutMs === undefined ? {} : { timeoutMs: Number(input.timeoutMs) }) }, ctx);
    case "handover": return svc.handover({ assignmentId: required(input, "assignmentId"), receiverManagerInstanceId: required(input, "receiverManagerInstanceId"), ...(input.mode ? { mode: input.mode as "graceful" | "force" } : {}) }, ctx);
    case "approve-plan": return svc.approvePlan(required(input, "assignmentId"), required(input, "approvalId"), actor(input), ctx, approvalReceipt(input));
    case "reject-plan": return svc.rejectPlan(required(input, "assignmentId"), required(input, "approvalId"), actor(input), required(input, "reason"), ctx, approvalReceipt(input));
    case "waive-plan": return svc.waivePlanApproval(required(input, "assignmentId"), required(input, "approvalId"), actor(input), ctx, approvalReceipt(input));
    case "task-create": return svc.createTask(required(input, "assignmentId"), (input.affectedPaths ?? []) as string[], ctx);
    case "task-transition": return svc.transitionTask(required(input, "assignmentId"), required(input, "taskId"), required(input, "state") as never, ctx);
    case "execution-begin": {
      if (input.taskPacket === undefined || input.taskPacket === null || typeof input.taskPacket !== "object") {
        throw new Error("TASK_PACKET_REQUIRED: manager-dispatched executions require a validated taskPacket");
      }
      const packet = input.taskPacket as Record<string, unknown>;
      if (input.controlLaunch === undefined || input.controlLaunch === null || typeof input.controlLaunch !== "object") {
        throw new Error("CONTROL_LAUNCH_REQUIRED: manager-dispatched executions require a provider CLI launch specification");
      }
      const launch = input.controlLaunch as Record<string, unknown>;
      const provider = required(launch, "provider");
      if (provider !== "codex" && provider !== "claude") throw new Error("CONTROL_PROVIDER_INVALID: provider must be codex or claude");
      if (!Array.isArray(launch.args) || !launch.args.every((value) => typeof value === "string")) throw new Error("CONTROL_ARGS_INVALID: controlLaunch.args must be an array of strings");
      const execution = await svc.beginManagedExecution(
        required(input, "assignmentId"),
        required(input, "taskId"),
        required(packet, "purpose"),
        packet as never,
        ctx,
        await captureGitWorkspaceSnapshot(root),
      );
      try {
        const { stateRoot } = await initializeStateRoot(root, current.effective.config.state.directory);
        await launchControlledCli(stateRoot, { provider, assignmentId: required(input, "assignmentId"), executionId: execution.executionId, taskId: required(input, "taskId"), args: launch.args as string[], retentionDays: current.effective.config.retention.rawResponsesDays });
      } catch (error) {
        await svc.recordExecutionOutcome(required(input, "assignmentId"), execution.executionId, "failed", ctx, await captureGitWorkspaceSnapshot(root));
        throw error;
      }
      return execution;
    }
    case "execution-outcome": return svc.recordExecutionOutcome(required(input, "assignmentId"), required(input, "executionId"), required(input, "outcome") as never, ctx, await captureGitWorkspaceSnapshot(root));
    case "result-submit": return svc.submitResult(required(input, "assignmentId"), required(input, "taskId"), required(input, "resultId"), ctx, { executionId: required(input, "executionId"), deliveryStatus: required(input, "deliveryStatus") as "complete" | "partial" | "failed", summary: required(input, "summary") });
    case "result-rework": return svc.requestRework(required(input, "assignmentId"), required(input, "taskId"), ctx);
    case "result-accept": return svc.acceptResult(required(input, "assignmentId"), required(input, "taskId"), ctx);
    case "task-close": return svc.closeTask(required(input, "assignmentId"), required(input, "taskId"), ctx);
    case "action-create": return svc.createAction(required(input, "assignmentId"), required(input, "description"), ctx);
    case "action-outcome": return svc.recordActionOutcome(required(input, "assignmentId"), required(input, "actionId"), required(input, "outcome") as never, ctx);
    case "action-reconcile": return svc.reconcileAction(required(input, "assignmentId"), required(input, "actionId"), required(input, "outcome") as never, ctx);
    case "decision-record": return svc.recordDecision(required(input, "assignmentId"), required(input, "choice"), required(input, "rationale"), ctx);
    case "cancel": return svc.cancelAssignment(required(input, "assignmentId"), ctx);
    case "close": return svc.closeAssignment(required(input, "assignmentId"), ctx);
    case "reopen": return svc.reopenAssignment(required(input, "assignmentId"), ctx);
    case "ownership-acquire": return svc.acquireOwnership(required(input, "assignmentId"), ctx);
    case "transcript-record": return recordTranscript(root, current, input, ctx);
    case "quarantine-submit": return managedQuarantine(root, current, "quarantine-submit", input, ctx);
    case "quarantine-show": return managedQuarantine(root, current, "quarantine-show", input, ctx);
    case "quarantine-resolve": return managedQuarantine(root, current, "quarantine-resolve", input, ctx);
    default: throw new Error(`Unknown workflow command: ${command}`);
  }
}

async function managerCommand(root: string, command: string, input: Input): Promise<unknown> {
  if (!(MANAGED_WORKFLOW_COMMANDS as readonly string[]).includes(command)) throw new Error(`Unknown workflow command: ${command}`);
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  const commandId = `cmd-${randomUUID()}`;
  const write = async (eventType: "manager.command_received" | "manager.command_accepted" | "manager.command_completed" | "manager.command_failed", details?: Record<string, unknown>) => {
    const who = actor(input);
    await appendEvent({ projectRoot: root, stateDirectory: effective.config.state.directory, operationId: `op-${randomUUID()}`, validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event", event: {
      schema_version: "1.0", event_id: `evt-${randomUUID()}`, event_type: eventType, occurred_at: new Date().toISOString(),
      actor: { actor_id: who.actorId, actor_type: who.actorType }, recorded_by: { actor_id: "runtime-agent-workflow", actor_type: "runtime" },
      ...(typeof input.assignmentId === "string" ? { assignment_id: input.assignmentId } : {}),
      data: { command_id: commandId, command, ...(details === undefined ? {} : { details: details as unknown as JsonValue }) },
    } });
  };
  await write("manager.command_received");
  await write("manager.command_accepted");
  try {
    const execute = () => executeManagerCommand(root, command, input);
    let result: unknown;
    if (["status", "ask"].includes(command)) result = await execute();
    else {
      const { stateRoot } = await initializeStateRoot(root, effective.config.state.directory);
      const guarded = await durableMaintenance(
        stateRoot,
        `operation-${commandId}`,
        execute,
        effective.config.intentLogging.retryCount,
        effective.config.intentLogging.backoffSeconds,
      );
      if (guarded.status !== "succeeded") {
        throw guarded.error instanceof Error
          ? guarded.error
          : new Error(`Managed command ${command} ended with ${guarded.status}`);
      }
      result = guarded.value;
    }
    await write("manager.command_completed");
    return result;
  } catch (error) {
    await write("manager.command_failed", { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function durableMaintenance<T>(stateRoot: string, operationId: string, perform: () => Promise<T>, retryCount: number, backoffSeconds: number[]) {
  return runConsequentialOperation({
    operationId,
    async persistIntent(attempt) { await writeJsonAtomic(stateRoot, path.join("validations", `${operationId}.intent.json`), { operation_id: operationId, status: "intent_recorded", attempt, recorded_at: new Date().toISOString() }); },
    perform,
    async persistOutcome(outcome) { await writeJsonAtomic(stateRoot, path.join("validations", `${operationId}.outcome.json`), { operation_id: operationId, outcome, recorded_at: new Date().toISOString() }); },
    isTransient(error) { return ["EBUSY", "EAGAIN", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""); },
  }, { retryCount, backoffSeconds });
}

async function archiveCommand(root: string, input: Input, mode: "dry-run" | "apply") {
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  const { stateRoot } = await initializeStateRoot(root, effective.config.state.directory);
  const assignmentId = typeof input.assignmentId === "string" ? input.assignmentId : undefined;
  if (!assignmentId && typeof input.batchId === "string") throw new Error("batchId requires assignmentId");
  const assignmentIds = assignmentId === undefined
    ? (await readdir(path.join(stateRoot, "assignments"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [assignmentId];
  const plans = await Promise.all(assignmentIds.map((candidate) => planAssignmentArchive({
    stateRoot,
    assignmentId: candidate,
    ...(candidate === assignmentId && typeof input.batchId === "string" ? { batchId: input.batchId } : {}),
    retentionDays: effective.config.retention.closedAssignmentsDays,
  })));
  if (mode === "dry-run") return { mode, plans };
  const results = [];
  for (const plan of plans) {
    if (!plan.eligible) continue;
    results.push(await durableMaintenance(stateRoot, plan.operation_id, () => applyAssignmentArchive({ stateRoot, plan }), effective.config.intentLogging.retryCount, effective.config.intentLogging.backoffSeconds));
  }
  return { mode, plans, results };
}

async function cleanupCommand(root: string, mode: "dry-run" | "apply") {
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  const { stateRoot } = await initializeStateRoot(root, effective.config.state.directory);
  const operationId = `cleanup-${randomUUID()}`;
  const plan = await planRawResponseCleanup({ stateRoot, operationId, mode, retentionDays: effective.config.retention.rawResponsesDays });
  if (mode === "dry-run") return plan;
  return durableMaintenance(stateRoot, operationId, () => applyRawResponseCleanup(stateRoot, plan), effective.config.intentLogging.retryCount, effective.config.intentLogging.backoffSeconds);
}

async function controlCommand(root: string, subcommand: string | undefined, input: Input) {
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  const { stateRoot } = await initializeStateRoot(root, effective.config.state.directory);
  if (subcommand === "status") {
    const record = await controlStatus(stateRoot, required(input, "executionId"), effective.config.retention.rawResponsesDays);
    if (!record) return { status: "not_registered" };
    if (record.response_capture && !record.response_capture.event_id) {
      const eventId = `evt-${randomUUID()}`;
      await appendEvent({
        projectRoot: root, stateDirectory: effective.config.state.directory, operationId: `op-${randomUUID()}`,
        validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event",
        event: {
          schema_version: "1.0", event_id: eventId, event_type: "provider.signal_observed", occurred_at: record.response_capture.captured_at,
          actor: { actor_id: `provider:${record.provider}`, actor_type: "external_system" },
          recorded_by: { actor_id: "runtime-agent-workflow", actor_type: "runtime" },
          assignment_id: record.assignment_id,
          ...(record.task_id ? { task_id: record.task_id } : {}), execution_id: record.execution_id,
          provider_context: { provider: record.provider },
          data: { provider: record.provider, signal: "response.captured", details: { response_id: record.response_capture.response_id, truncated: record.response_capture.truncated } },
        },
      });
      await markResponseCaptureObserved(stateRoot, record.execution_id, eventId);
      record.response_capture.event_id = eventId;
    }
    return record;
  }
  if (subcommand === "acknowledge-handover") return acknowledgeHandover(stateRoot, required(input, "assignmentId"), required(input, "receiverManagerInstanceId"));
  if (subcommand !== "launch") throw new Error("Unknown control command. Supported: control launch, control status, control acknowledge-handover");
  const provider = required(input, "provider");
  if (provider !== "codex" && provider !== "claude") throw new Error("CONTROL_PROVIDER_INVALID: provider must be codex or claude");
  if (!Array.isArray(input.args) || !input.args.every((value) => typeof value === "string")) throw new Error("CONTROL_ARGS_INVALID: args must be an array of strings");
  return launchControlledCli(stateRoot, { provider, assignmentId: required(input, "assignmentId"), executionId: required(input, "executionId"), ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}), args: input.args as string[], retentionDays: effective.config.retention.rawResponsesDays });
}

async function appendProviderSignal(root: string, provider: string, signal: NormalizedProviderSignal, stateDirectory: string) {
  return appendEvent({
    projectRoot: root, stateDirectory, operationId: `op-${randomUUID()}`,
    validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event",
    event: {
      schema_version: "1.0", event_id: `evt-${randomUUID()}`, event_type: "provider.signal_observed", occurred_at: signal.occurredAt,
      actor: { actor_id: signal.actor.actorId, actor_type: signal.actor.actorType, ...(signal.actor.displayName ? { display_name: signal.actor.displayName } : {}) },
      recorded_by: { actor_id: signal.recordedBy.actorId, actor_type: signal.recordedBy.actorType, ...(signal.recordedBy.displayName ? { display_name: signal.recordedBy.displayName } : {}) },
      ...(signal.frameworkRefs.assignmentId ? { assignment_id: signal.frameworkRefs.assignmentId } : {}),
      ...(signal.frameworkRefs.taskId ? { task_id: signal.frameworkRefs.taskId } : {}),
      ...(signal.frameworkRefs.executionId ? { execution_id: signal.frameworkRefs.executionId } : {}),
      ...(signal.frameworkRefs.actionId ? { action_id: signal.frameworkRefs.actionId } : {}),
      provider_context: { provider, ...(signal.providerContext.providerSessionId ? { session_id: signal.providerContext.providerSessionId } : {}), ...(signal.providerContext.providerProcessId ? { process_id: signal.providerContext.providerProcessId } : {}), ...(signal.providerContext.providerTaskId ? { task_id: signal.providerContext.providerTaskId } : {}) },
      data: { provider, signal: signal.signalType, details: signal.data as unknown as JsonValue },
    },
  });
}

/**
 * Claude's PreToolUse hook is a policy boundary, not merely an audit tap. A
 * managed provider process must identify the active assignment/execution and
 * present the current manager fencing token. This deliberately denies an
 * uncorrelated interactive Claude session rather than letting it self-assert
 * that it is working for a workflow assignment.
 */
async function authorizeClaudePreTool(root: string, input: Input, signal: NormalizedProviderSignal): Promise<{ accepted: boolean; reason?: string }> {
  const assignmentId = signal.frameworkRefs.assignmentId;
  const executionId = signal.frameworkRefs.executionId;
  const managerInstanceId = signal.providerContext.managerInstanceId;
  const ownershipToken = input.ownership_token ?? input.ownershipToken;
  if (!assignmentId || !executionId || !managerInstanceId || typeof ownershipToken !== "string" || ownershipToken.length === 0) {
    return { accepted: false, reason: "WORKFLOW_AUTHORIZATION_REQUIRED: assignment, execution, manager identity, and ownership token are required." };
  }

  try {
    const current = await service(root);
    const assignment = await current.repository.get(assignmentId);
    if (!assignment) return { accepted: false, reason: "WORKFLOW_ASSIGNMENT_NOT_FOUND: managed assignment does not exist." };
    if (assignment.managerInstanceId !== managerInstanceId) return { accepted: false, reason: "WORKFLOW_OWNERSHIP_MISMATCH: manager does not own assignment." };
    if (assignment.lifecycle !== "running" || assignment.executionAuthority.state !== "authorized") {
      return { accepted: false, reason: "WORKFLOW_EXECUTION_NOT_AUTHORIZED: assignment is not authorized for provider tool use." };
    }
    const execution = assignment.executions.find((candidate) => candidate.executionId === executionId);
    if (!execution || execution.state !== "running") {
      return { accepted: false, reason: "WORKFLOW_EXECUTION_NOT_RUNNING: provider tool use is not associated with a running execution." };
    }
    await current.repository.validateOwnership?.(assignmentId, managerInstanceId, ownershipToken, new Date());
    return { accepted: true };
  } catch (error) {
    return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function observeProvider(root: string, provider: string, input: Input) {
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  const { stateRoot } = await initializeStateRoot(root, effective.config.state.directory);
  const normalizedInput = { ...input, actor: input.actor ?? { actor_id: "manager:provider", actor_type: "manager" } };
  let signal: NormalizedProviderSignal;
  let hookOutput: unknown;
  if (provider === "claude") {
    const claude = new ClaudeProviderAdapter({
      blockingPreToolHook: true,
      workflowAuthorizationConnected: true,
      captureRawResponses: effective.config.providers.claude?.captureRawResponses === true,
    });
    if (input.hook_event_name === "PreToolUse") {
      const decision = await claude.decidePreToolUse(normalizedInput, async (candidate) => {
        const authorization = await authorizeClaudePreTool(root, input, candidate);
        try {
          await appendProviderSignal(root, provider, candidate, effective.config.state.directory);
          return authorization;
        } catch (error) {
          return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
        }
      });
      signal = decision.signal;
      hookOutput = decision.output;
    } else signal = await claude.translateHook(normalizedInput);
  } else if (provider === "codex") signal = await new CodexProviderAdapter({ captureRawResponses: effective.config.providers.codex?.captureRawResponses === true }).translateEvent(normalizedInput);
  else throw new Error(`Unknown provider: ${provider}`);
  const acknowledgement = hookOutput === undefined
    ? await appendProviderSignal(root, provider, signal, effective.config.state.directory)
    : undefined;
  let rawResponsePath: string | undefined;
  if (signal.rawResponse !== undefined) {
    rawResponsePath = await persistRedactedRawResponse(stateRoot, {
      responseId: `raw-${randomUUID()}`,
      provider,
      sourceEvent: signal.sourceEvent,
      content: signal.rawResponse,
      retentionDays: effective.config.retention.rawResponsesDays,
      ...(signal.frameworkRefs.assignmentId ? { assignmentId: signal.frameworkRefs.assignmentId } : {}),
      ...(signal.frameworkRefs.taskId ? { taskId: signal.frameworkRefs.taskId } : {}),
      ...(signal.frameworkRefs.executionId ? { executionId: signal.frameworkRefs.executionId } : {}),
    });
  }
  if (hookOutput !== undefined) return hookOutput;
  return {
    accepted: true,
    classification: "observed",
    provider,
    signal: signal.signalType,
    acknowledgement,
    ...(rawResponsePath === undefined ? {} : { rawResponsePath }),
  };
}

export async function runCli(): Promise<void> {
  const root = await findConsumerRoot(option("project-root") ?? process.cwd());
  const [command, subcommand] = process.argv.slice(2).filter((value) => !value.startsWith("--") && value !== option("json") && value !== option("project-root"));
  if (!command || command === "help" || process.argv.includes("--help") || process.argv.includes("-h")) { output({ commands: [
    "init", "doctor", "validate", "capabilities", "config show", "config validate", "upgrade --check", "--redact-output",
    "cleanup --dry-run|--apply", "archive --dry-run|--apply",
    "control launch|status|acknowledge-handover",
    ...MANAGED_WORKFLOW_COMMANDS,
  ] }); return; }
  if (command === "init") { output(await installConsumer(root)); return; }
  if (command === "doctor") { output(await doctor(root)); return; }
  if (command === "validate") { output(await validateInstallation(root)); return; }
  if (command === "capabilities") { output(await capabilityReport()); return; }
  if (command === "config") {
    const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
    output(subcommand === "validate" ? { valid: true, digest: effective.digest } : effective); return;
  }
  if (command === "upgrade") {
    const input = await jsonInput();
    output(checkUpgradeCompatibility({
      currentVersion: FRAMEWORK_VERSION,
      targetVersion: typeof input.targetVersion === "string" ? input.targetVersion : FRAMEWORK_VERSION,
      configurationSchemaVersion: SUPPORTED_SCHEMA_VERSION,
      recordSchemaVersion: SUPPORTED_SCHEMA_VERSION,
      eventSchemaVersion: SUPPORTED_SCHEMA_VERSION,
    }));
    return;
  }
  if (command === "cleanup") { output(await cleanupCommand(root, process.argv.includes("--apply") ? "apply" : "dry-run")); return; }
  if (command === "archive") { output(await archiveCommand(root, await jsonInput(), process.argv.includes("--apply") ? "apply" : "dry-run")); return; }
  if (command === "provider") { output(await observeProvider(root, subcommand ?? "", await jsonInput())); return; }
  if (command === "control") { output(await controlCommand(root, subcommand, await jsonInput())); return; }
  output(await managerCommand(root, command, await jsonInput()));
}

function isCliEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isCliEntryPoint()) {
  runCli().catch((error) => { output({ status: "failed", code: (error as { code?: string }).code ?? "CLI_ERROR", message: error instanceof Error ? error.message : String(error), ...(error instanceof AssignmentSelectionError ? { candidates: error.candidates } : {}) }); process.exitCode = 1; });
}
