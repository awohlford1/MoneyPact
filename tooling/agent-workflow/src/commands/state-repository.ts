import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ActorRef } from "../contracts/actors.ts";
import { appendEvent } from "../events/index.ts";
import { coreSchemaRegistry } from "../registries/index.ts";
import { assertContainedStatePath, initializeStateRoot, publishLedgerProjection, readLedgerProjection, resolveRecord, writeAssignmentRecord, writeJsonImmutableIdempotent } from "../storage/index.ts";
import type { JsonValue, StoredRecord, StructuralValidator } from "../storage/types.ts";
import type { AssignmentAggregate, AssignmentSummary, WorkflowEvent, WorkflowRepository } from "./types.ts";
import type { WorkflowTransaction } from "./types.ts";
import { acceptOwnershipTransfer, acquireOwnershipLease, readOwnershipLease, renewOwnershipLease, requestOwnershipTransfer, withAssignmentWriteLock } from "../concurrency/index.ts";
import type { TaskPacket } from "../workflows/task-packets.ts";

export interface StateWorkflowRepositoryOptions {
  projectRoot: string;
  stateDirectory?: string;
  runtimeActor?: ActorRef;
  policySnapshot?: Readonly<Record<string, JsonValue>>;
  now?: () => Date;
}

const validator: StructuralValidator<StoredRecord> = {
  validate(_schemaId, value, version) {
    return coreSchemaRegistry.validateRecord(String((value as { record_type?: unknown }).record_type), value, version);
  },
};

function storedActor(actor: ActorRef) {
  return { actor_id: actor.actorId, actor_type: actor.actorType, ...(actor.displayName === undefined ? {} : { display_name: actor.displayName }) };
}

function eventPayload(event: WorkflowEvent): Record<string, JsonValue> {
  const data = event.data as Record<string, JsonValue>;
  if (event.type === "approval.requested") {
    const approvalId = String(data.approvalId ?? "");
    const approval = data.planId === undefined ? undefined : { record_type: "plan", record_id: String(data.planId), revision: Number(data.revision ?? 1) };
    return { approval_id: approvalId, subject: approval ?? { record_type: "assignment", record_id: event.assignmentId }, subject_revision: Number(data.revision ?? 1) };
  }
  if (event.type.startsWith("action.")) {
    const actionId = String(data.actionId ?? "");
    if (event.type === "action.reconciled") return { action_id: actionId, concrete_outcome: data.outcome as JsonValue };
    if (event.type === "action.outcome_unknown") return { action_id: actionId, outcome: "unknown" };
    const outcome = event.type.slice("action.".length);
    if (["succeeded", "failed", "prevented", "cancelled"].includes(outcome)) return { action_id: actionId, outcome };
    return { action_id: actionId };
  }
  if (event.type.startsWith("execution.")) return { execution_id: String(data.executionId ?? ""), details: data };
  if (event.type.startsWith("submission.")) return { submission_id: String(data.resultId ?? data.submissionId ?? "submission-unknown"), details: data };
  if (["manager.question_received", "manager.answer_provided", "manager.status_reported"].includes(event.type)) return { message: String(data.question ?? data.message ?? event.type) };
  const recordId = String(data.planId ?? data.approvalId ?? data.decisionId ?? data.evidenceId ?? data.taskId ?? event.assignmentId);
  const recordType = data.planId ? "plan" : data.approvalId ? "approval" : data.decisionId ? "decision" : data.evidenceId ? "evidence" : data.taskId ? "task" : "assignment";
  return { record_ref: { record_type: recordType, record_id: recordId }, details: data };
}

/** Canonical records are schema validated; the aggregate is only a derived ledger projection. */
export class StateWorkflowRepository implements WorkflowRepository {
  private readonly options: StateWorkflowRepositoryOptions;
  constructor(options: StateWorkflowRepositoryOptions) { this.options = options; }
  private projectionName(assignmentId: string): string { return `workflow-${assignmentId}`; }

  async listAssignments(): Promise<AssignmentSummary[]> {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    const assignmentsRoot = await assertContainedStatePath(stateRoot, "assignments");
    const names = await readdir(assignmentsRoot, { withFileTypes: true }).catch(() => []);
    const summaries: AssignmentSummary[] = [];
    for (const entry of names) {
      if (!entry.isDirectory() || !entry.name.startsWith("asn-")) continue;
      const recordPath = await assertContainedStatePath(stateRoot, path.join("assignments", entry.name, "assignment", `${entry.name}.json`));
      const record = await readFile(recordPath, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>);
      const validation = coreSchemaRegistry.validateRecord("assignment", record);
      if (!validation.valid) throw new Error(`Assignment discovery failed structural validation for ${entry.name}: ${JSON.stringify(validation.errors)}`);
      const ownership = record.ownership as Record<string, unknown>;
      summaries.push({ assignmentId: String(record.assignment_id), objective: String(record.objective), lifecycle: record.lifecycle_state as AssignmentSummary["lifecycle"], managerInstanceId: String(ownership.manager_instance_id), updatedAt: String(record.updated_at ?? record.created_at) });
    }
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(assignmentId: string): Promise<AssignmentAggregate | undefined> {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    let resolvedAssignment;
    try { resolvedAssignment = await resolveRecord(stateRoot, assignmentId); }
    catch (error) {
      if ((error as { code?: string }).code === "STATE_RECORD_NOT_FOUND") return undefined;
      throw error;
    }
    if (resolvedAssignment.location !== "active") {
      throw new Error(`ASSIGNMENT_ARCHIVED: ${assignmentId} must be restored through the explicit archive reopen workflow before it can be mutated`);
    }
    const assignment = resolvedAssignment.record;
    const records = async (category: string) => {
      const directory = path.join(stateRoot, "assignments", assignmentId, category);
      const names = await readdir(directory).catch(() => []);
      return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as Record<string, unknown>));
    };
    const [plansRaw, approvalsRaw, tasksRaw, executionsRaw, actionsRaw, resultsRaw, assessmentsRaw, decisionsRaw, evidenceRaw, checkpointsRaw, taskPacketsRaw, lease] = await Promise.all([
      records("plans"), records("approvals"), records("tasks"), records("executions"), records("actions"), records("results"), records("assessments"), records("decisions"),
      records("evidence"), records("checkpoints"), records("task-packets"), readOwnershipLease(stateRoot, assignmentId),
    ]);
    const plans = plansRaw.map((item) => ({ planId: String(item.plan_id), revision: Number(item.revision), purpose: item.purpose as "initial" | "continuation" | "steer", lifecycle: item.lifecycle as "draft" | "proposed" | "active" | "superseded", approach: item.approach as string[], acceptanceCriteria: item.acceptance_criteria as string[], ...(item.prior_plan_id ? { priorPlanId: String(item.prior_plan_id) } : {}) }));
    const currentPlan = plans.find((item) => item.planId === assignment.current_plan_id);
    if (!currentPlan) throw new Error(`Canonical current plan is missing for ${assignmentId}`);
    const actorFrom = (item: unknown): ActorRef => { const value = item as Record<string, unknown>; return { actorId: String(value.actor_id), actorType: value.actor_type as ActorRef["actorType"], ...(value.display_name ? { displayName: String(value.display_name) } : {}) }; };
    const aggregate: AssignmentAggregate = {
      assignmentId, objective: String(assignment.objective), lifecycle: assignment.lifecycle_state as AssignmentAggregate["lifecycle"],
      executionAuthority: { assignmentId, planId: currentPlan.planId, planRevision: currentPlan.revision, state: assignment.execution_authority as "unauthorized" | "authorized" | "held", reason: "restored_from_canonical_records", updatedAt: String(assignment.updated_at ?? assignment.created_at) },
      currentPlan, plans,
      approvals: approvalsRaw.map((item) => ({ approvalId: String(item.approval_id), subjectType: String((item.subject as Record<string, unknown>).record_type), subjectId: String((item.subject as Record<string, unknown>).record_id), subjectRevision: Number(item.subject_revision), state: item.state as never, scope: String(item.scope), approver: actorFrom(item.approver), createdAt: String(item.created_at), ...(item.granted_at ? { grantedAt: String(item.granted_at) } : {}), ...(item.expires_at ? { expiresAt: String(item.expires_at) } : {}), ...(item.waiver_authority ? { waiverAuthority: actorFrom(item.waiver_authority) } : {}), ...(item.verification ? { verification: { mode: String((item.verification as Record<string, unknown>).mode) as "record_only" | "signed_ed25519", ...((item.verification as Record<string, unknown>).key_id ? { keyId: String((item.verification as Record<string, unknown>).key_id) } : {}), ...((item.verification as Record<string, unknown>).receipt_digest ? { receiptDigest: String((item.verification as Record<string, unknown>).receipt_digest) } : {}) } } : {}) })),
      tasks: tasksRaw.map((item) => ({ taskId: String(item.task_id), state: item.state as never, affectedPaths: item.affected_paths as string[], executionIds: item.execution_ids as string[], resultIds: item.result_ids as string[] })),
      executions: executionsRaw.map((item) => ({ executionId: String(item.execution_id), taskId: String(item.task_id), attempt: Number(item.attempt), state: item.state as never })),
      results: resultsRaw.map((item) => ({ resultId: String(item.result_id), taskId: String(item.task_id), executionId: String(item.execution_id), deliveryStatus: item.delivery_status as never, summary: String(item.summary), ...(Array.isArray(item.evidence_refs) ? { evidenceIds: item.evidence_refs.map(String) } : {}) })),
      actions: actionsRaw.map((item) => ({ actionId: String(item.action_id), description: String(item.description), state: item.outcome as never, ...(item.task_id ? { taskId: String(item.task_id) } : {}), ...(item.execution_id ? { executionId: String(item.execution_id) } : {}) })),
      assessments: assessmentsRaw.map((item) => ({ assessmentId: String(item.assessment_id), createdAt: String(item.created_at), planId: String((item.subject as { record_id?: string } | undefined)?.record_id ?? assignment.current_plan_id), planRevision: Number((item.subject as { revision?: number } | undefined)?.revision ?? 1), allowed: item.classification === "nonmaterial", code: String(item.code ?? (item.classification === "nonmaterial" ? "NONMATERIAL_CHANGE" : item.classification === "material" ? "MATERIAL_CHANGE" : "MATERIALITY_AMBIGUOUS")) as "NONMATERIAL_CHANGE" | "MATERIAL_CHANGE" | "MATERIALITY_AMBIGUOUS", reason: String(item.rationale), classification: item.classification as "nonmaterial" | "material" | "ambiguous", affectedPaths: item.affected_paths as string[] ?? [], cumulativeCount: Number(item.cumulative_change_count ?? 0), holdAffectedWork: item.classification !== "nonmaterial" })),
      decisions: decisionsRaw.map((item) => ({ decisionId: String(item.decision_id), subjectId: String((item.subject as Record<string, unknown>).record_id), choice: String(item.choice), rationale: String(item.rationale), decidedBy: actorFrom(item.decided_by), decidedAt: String(item.created_at) })),
      evidence: evidenceRaw.map((item) => ({ evidenceId: String(item.evidence_id), subjectType: String((item.subject as Record<string, unknown>).record_type) as "execution" | "result" | "task" | "assignment", subjectId: String((item.subject as Record<string, unknown>).record_id), kind: String(item.kind), location: String(item.location), digest: String(item.digest), createdAt: String(item.created_at) })),
      pendingActionIds: assignment.pending_action_ids as string[] ?? [], closureHistory: (assignment.closure_history as Array<{ disposition: "completed" | "cancelled"; closed_at: string }> ?? []).map((item) => ({ disposition: item.disposition, closedAt: item.closed_at })),
      managerInstanceId: String((assignment.ownership as Record<string, unknown>).manager_instance_id),
      ...(lease === undefined ? {} : { ownershipLease: { token: lease.token, managerInstanceId: lease.managerInstanceId, acquiredAt: lease.acquiredAt, renewedAt: lease.renewedAt, expiresAt: lease.expiresAt } }),
      checkpoints: checkpointsRaw.map((item) => ({ checkpointId: String(item.checkpoint_id), kind: item.kind as "resume" | "pause" | "handover" | "progress", summary: String(item.summary), createdAt: String(item.created_at), unresolvedActionIds: item.unresolved_action_ids as string[] ?? [] })),
      taskPackets: taskPacketsRaw as unknown as TaskPacket[],
      nonmaterialChangeCount: Number(assignment.nonmaterial_change_count ?? 0), holds: assignment.holds as string[] ?? [],
    };
    const projection = await readLedgerProjection(stateRoot, this.projectionName(assignmentId));
    if (projection === undefined) await publishLedgerProjection(stateRoot, { projection: this.projectionName(assignmentId), generated_at: new Date().toISOString(), data: aggregate as unknown as JsonValue });
    return aggregate;
  }

  async save(aggregate: AssignmentAggregate): Promise<void> {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    const now = (this.options.now?.() ?? new Date()).toISOString();
    const createdAtFor = async (recordId: string): Promise<string> => {
      try {
        const existing = await resolveRecord(stateRoot, recordId);
        if (existing.location !== "active") throw new Error(`RECORD_ARCHIVED: ${recordId} cannot be recreated by a normal workflow save`);
        return typeof existing.record.created_at === "string" ? existing.record.created_at : now;
      } catch (error) {
        if ((error as { code?: string }).code === "STATE_RECORD_NOT_FOUND") return now;
        throw error;
      }
    };
    let createdAt = now;
    try {
      const existing = await resolveRecord(stateRoot, aggregate.assignmentId);
      if (existing.location !== "active") {
        throw new Error(`ASSIGNMENT_ARCHIVED: ${aggregate.assignmentId} cannot be recreated by a normal workflow save`);
      }
      if (typeof existing.record.created_at === "string") createdAt = existing.record.created_at;
    } catch (error) { if ((error as { code?: string }).code !== "STATE_RECORD_NOT_FOUND") throw error; }
    const closure = aggregate.closureHistory.at(-1);
    const assignment: StoredRecord = {
      schema_version: "1.0", record_id: aggregate.assignmentId, record_type: "assignment", created_at: createdAt,
      updated_at: now, assignment_id: aggregate.assignmentId, objective: aggregate.objective,
      acceptance_criteria: aggregate.currentPlan.acceptanceCriteria, lifecycle_state: aggregate.lifecycle,
      execution_authority: aggregate.executionAuthority.state, current_plan_id: aggregate.currentPlan.planId,
      ownership: { manager_instance_id: aggregate.managerInstanceId, ...(aggregate.ownershipLease === undefined ? {} : { lease_expires_at: aggregate.ownershipLease.expiresAt }) }, policy_snapshot: this.options.policySnapshot ?? {},
      task_ids: aggregate.tasks.map((task) => task.taskId),
      pending_action_ids: aggregate.pendingActionIds, holds: aggregate.holds,
      nonmaterial_change_count: aggregate.nonmaterialChangeCount,
      closure_history: aggregate.closureHistory.map((item) => ({ disposition: item.disposition, closed_at: item.closedAt })),
      ...(aggregate.lifecycle === "closed" && closure ? { closure_disposition: closure.disposition } : {}),
      ...(aggregate.checkpoints?.at(-1) === undefined ? {} : { checkpoint_id: aggregate.checkpoints.at(-1)!.checkpointId }),
    };
    await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "assignment", record: assignment, immutable: false, validator, schemaId: "assignment" });
    for (const plan of aggregate.plans) {
      const record: StoredRecord = {
        schema_version: "1.0", record_id: plan.planId, record_type: "plan", created_at: await createdAtFor(plan.planId), updated_at: now,
        plan_id: plan.planId, assignment_id: aggregate.assignmentId, revision: plan.revision, purpose: plan.purpose,
        lifecycle: plan.lifecycle, approach: plan.approach, acceptance_criteria: plan.acceptanceCriteria,
        ...(plan.priorPlanId === undefined ? {} : { prior_plan_id: plan.priorPlanId }),
      };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "plans", record, immutable: false, validator, schemaId: "plan" });
    }
    for (const task of aggregate.tasks) {
      const record: StoredRecord = { schema_version: "1.0", record_id: task.taskId, record_type: "task", created_at: await createdAtFor(task.taskId), updated_at: now, task_id: task.taskId, assignment_id: aggregate.assignmentId, state: task.state, affected_paths: task.affectedPaths, execution_ids: task.executionIds, result_ids: task.resultIds };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "tasks", record, immutable: false, validator, schemaId: "task" });
    }
    for (const execution of aggregate.executions) {
      const record: StoredRecord = { schema_version: "1.0", record_id: execution.executionId, record_type: "execution", created_at: await createdAtFor(execution.executionId), updated_at: now, execution_id: execution.executionId, task_id: execution.taskId, assignment_id: aggregate.assignmentId, attempt: execution.attempt, state: execution.state };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "executions", record, immutable: false, validator, schemaId: "execution" });
    }
    for (const action of aggregate.actions) {
      const record: StoredRecord = { schema_version: "1.0", record_id: action.actionId, record_type: "action", created_at: await createdAtFor(action.actionId), updated_at: now, action_id: action.actionId, assignment_id: aggregate.assignmentId, description: action.description, consequential: true, outcome: action.state, ...(action.taskId ? { task_id: action.taskId } : {}), ...(action.executionId ? { execution_id: action.executionId } : {}) };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "actions", record, immutable: false, validator, schemaId: "action" });
      const pendingRelative = path.join("pending", `${action.actionId}.json`);
      const pendingPath = await assertContainedStatePath(stateRoot, pendingRelative);
      if (action.state === "unknown") {
        const existingPending = await readFile(pendingPath, "utf8").then((text) => JSON.parse(text) as StoredRecord).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
        const pending: StoredRecord = existingPending ?? { schema_version: "1.0", record_id: `pending-${action.actionId}`, record_type: "pending", created_at: now, pending_id: `pending-${action.actionId}`, action_id: action.actionId, assignment_id: aggregate.assignmentId, status: "unresolved", observed_outcome: "unknown" };
        const result = coreSchemaRegistry.validateRecord("pending", pending);
        if (!result.valid) throw new Error(`Pending record failed structural validation: ${JSON.stringify(result.errors)}`);
        await writeJsonImmutableIdempotent(stateRoot, pendingRelative, pending as unknown as JsonValue);
      } else if (["succeeded", "failed", "prevented", "cancelled"].includes(action.state)) {
        try {
          await readFile(pendingPath, "utf8");
          await writeJsonImmutableIdempotent(stateRoot, path.join("validations", `reconciliation-${action.actionId}.json`), { schema_version: "1.0", action_id: action.actionId, assignment_id: aggregate.assignmentId, outcome: action.state, reconciled_at: now });
          await rm(pendingPath);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
    for (const result of aggregate.results) {
      const record: StoredRecord = { schema_version: "1.0", record_id: result.resultId, record_type: "result", created_at: await createdAtFor(result.resultId), result_id: result.resultId, assignment_id: aggregate.assignmentId, task_id: result.taskId, execution_id: result.executionId, delivery_status: result.deliveryStatus, summary: result.summary, ...(result.evidenceIds === undefined ? {} : { evidence_refs: result.evidenceIds }) };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "results", record, validator, schemaId: "result" });
    }
    for (const evidence of aggregate.evidence ?? []) {
      const record: StoredRecord = { schema_version: "1.0", record_id: evidence.evidenceId, record_type: "evidence", created_at: evidence.createdAt, evidence_id: evidence.evidenceId, assignment_id: aggregate.assignmentId, subject: { record_type: evidence.subjectType, record_id: evidence.subjectId }, kind: evidence.kind, location: evidence.location, digest: evidence.digest };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "evidence", record, validator, schemaId: "evidence" });
    }
    for (const assessment of aggregate.assessments) {
      const record: StoredRecord = { schema_version: "1.0", record_id: assessment.assessmentId, record_type: "assessment", created_at: assessment.createdAt, assessment_id: assessment.assessmentId, assignment_id: aggregate.assignmentId, subject: { record_type: "plan", record_id: assessment.planId, revision: assessment.planRevision }, classification: assessment.classification, rationale: assessment.reason, cumulative_change_count: assessment.cumulativeCount, affected_paths: assessment.affectedPaths, code: assessment.code };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "assessments", record, validator, schemaId: "assessment" });
    }
    for (const approval of aggregate.approvals) {
      const record: StoredRecord = {
        schema_version: "1.0", record_id: approval.approvalId, record_type: "approval", created_at: approval.createdAt,
        updated_at: now, approval_id: approval.approvalId, assignment_id: aggregate.assignmentId,
        subject: { record_type: approval.subjectType, record_id: approval.subjectId, revision: approval.subjectRevision },
        subject_revision: approval.subjectRevision, state: approval.state, approver: storedActor(approval.approver), scope: approval.scope,
        ...(approval.grantedAt === undefined ? {} : { granted_at: approval.grantedAt }),
        ...(approval.expiresAt === undefined ? {} : { expires_at: approval.expiresAt }),
        ...(approval.waiverAuthority === undefined ? {} : { waiver_authority: storedActor(approval.waiverAuthority) }),
        ...(approval.verification === undefined ? {} : { verification: { mode: approval.verification.mode, ...(approval.verification.keyId ? { key_id: approval.verification.keyId } : {}), ...(approval.verification.receiptDigest ? { receipt_digest: approval.verification.receiptDigest } : {}) } }),
      };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "approvals", record, immutable: false, validator, schemaId: "approval" });
    }
    for (const decision of aggregate.decisions) {
      const record: StoredRecord = {
        schema_version: "1.0", record_id: decision.decisionId, record_type: "decision", created_at: decision.decidedAt,
        decision_id: decision.decisionId, assignment_id: aggregate.assignmentId,
        subject: { record_type: "assignment", record_id: aggregate.assignmentId }, choice: decision.choice,
        rationale: decision.rationale, decided_by: storedActor(decision.decidedBy),
      };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "decisions", record, validator, schemaId: "decision" });
    }
    for (const checkpoint of aggregate.checkpoints ?? []) {
      const record: StoredRecord = { schema_version: "1.0", record_id: checkpoint.checkpointId, record_type: "checkpoint", created_at: checkpoint.createdAt, checkpoint_id: checkpoint.checkpointId, assignment_id: aggregate.assignmentId, kind: checkpoint.kind, summary: checkpoint.summary, unresolved_action_ids: checkpoint.unresolvedActionIds };
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "checkpoints", record, validator, schemaId: "checkpoint" });
    }
    for (const packet of aggregate.taskPackets ?? []) {
      await writeAssignmentRecord({ stateRoot, assignmentId: aggregate.assignmentId, category: "task-packets", record: packet as unknown as StoredRecord, validator, schemaId: "task-packet" });
    }
    await publishLedgerProjection(stateRoot, { projection: this.projectionName(aggregate.assignmentId), generated_at: now, data: aggregate as unknown as JsonValue });
  }

  async append(event: WorkflowEvent): Promise<void> {
    const data = eventPayload(event);
    const taskId = typeof event.data.taskId === "string" ? event.data.taskId : undefined;
    const executionId = typeof event.data.executionId === "string" ? event.data.executionId : undefined;
    const actionId = typeof event.data.actionId === "string" ? event.data.actionId : undefined;
    await appendEvent({
      projectRoot: this.options.projectRoot, ...(this.options.stateDirectory === undefined ? {} : { stateDirectory: this.options.stateDirectory }),
      operationId: `op-${randomUUID()}`, validator: { validate: (_id, value, version) => coreSchemaRegistry.validateEvent(value, version) }, schemaId: "event",
      event: {
        schema_version: "1.0", event_id: `evt-${randomUUID()}`, event_type: event.type, occurred_at: event.at,
        actor: storedActor(event.actor), recorded_by: storedActor(this.options.runtimeActor ?? { actorId: "runtime-agent-workflow", actorType: "runtime" }),
        assignment_id: event.assignmentId, ...(taskId === undefined ? {} : { task_id: taskId }),
        ...(executionId === undefined ? {} : { execution_id: executionId }), ...(actionId === undefined ? {} : { action_id: actionId }), data,
      },
    });
  }

  async transaction<T>(assignmentId: string, operation: (transaction: WorkflowTransaction) => Promise<T>): Promise<T> {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    return withAssignmentWriteLock({
      stateRoot,
      assignmentId,
      ownerId: `workflow-${randomUUID()}`,
      // Creation and mutation share this lock. The transaction callback must
      // explicitly reject a missing assignment for every operation except
      // start, which proves non-existence before staging the first record.
      requireActive: false,
    }, async () => {
      let staged = await this.get(assignmentId);
      const events: WorkflowEvent[] = [];
      const result = await operation({ get: async () => staged === undefined ? undefined : structuredClone(staged), save: async (value) => { staged = structuredClone(value); }, append: async (event) => { events.push(structuredClone(event)); } });
      if (staged !== undefined) await this.save(staged);
      try { for (const event of events) await this.append(event); }
      catch (error) {
        if (staged !== undefined) {
          staged.lifecycle = "blocked";
          staged.executionAuthority = { ...staged.executionAuthority, state: "held", reason: "event_persistence_incomplete", updatedAt: new Date().toISOString() };
          staged.holds = [...new Set([...staged.holds, "runtime.event_persistence_incomplete"])];
          await this.save(staged);
        }
        throw error;
      }
      return result;
    });
  }

  async acquireOwnership(assignmentId: string, managerInstanceId: string, now?: Date) {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    const lease = await acquireOwnershipLease({ stateRoot, assignmentId, managerInstanceId, ...(now === undefined ? {} : { now: () => now }) });
    return { token: lease.token, managerInstanceId: lease.managerInstanceId, acquiredAt: lease.acquiredAt, renewedAt: lease.renewedAt, expiresAt: lease.expiresAt };
  }
  async renewOwnership(assignmentId: string, managerInstanceId: string, token: string, now?: Date) {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    const lease = await renewOwnershipLease({ stateRoot, assignmentId, managerInstanceId, token, ...(now === undefined ? {} : { now: () => now }) });
    return { token: lease.token, managerInstanceId: lease.managerInstanceId, acquiredAt: lease.acquiredAt, renewedAt: lease.renewedAt, expiresAt: lease.expiresAt };
  }
  async validateOwnership(assignmentId: string, managerInstanceId: string, token: string | undefined, now = new Date()) {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    const lease = await readOwnershipLease(stateRoot, assignmentId);
    if (!lease || lease.managerInstanceId !== managerInstanceId || token === undefined || lease.token !== token || Date.parse(lease.expiresAt) <= now.getTime()) throw new Error("OWNERSHIP_REQUIRED: current ownership fencing token required");
    return { token: lease.token, managerInstanceId: lease.managerInstanceId, acquiredAt: lease.acquiredAt, renewedAt: lease.renewedAt, expiresAt: lease.expiresAt };
  }
  async transferOwnership(assignmentId: string, fromManagerInstanceId: string, receiverManagerInstanceId: string, token: string, now = new Date()) {
    const { stateRoot } = await initializeStateRoot(this.options.projectRoot, this.options.stateDirectory);
    await requestOwnershipTransfer({ stateRoot, assignmentId, managerInstanceId: fromManagerInstanceId, token, receiverManagerInstanceId, now: () => now });
    const lease = await acceptOwnershipTransfer({ stateRoot, assignmentId, managerInstanceId: receiverManagerInstanceId, previousToken: token, now: () => now });
    return { token: lease.token, managerInstanceId: lease.managerInstanceId, acquiredAt: lease.acquiredAt, renewedAt: lease.renewedAt, expiresAt: lease.expiresAt };
  }
}
