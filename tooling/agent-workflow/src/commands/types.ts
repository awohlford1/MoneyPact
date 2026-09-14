import type { ActorRef } from "../contracts/actors.ts";
import type { InterruptionMode } from "../contracts/configuration.ts";
import type { ApprovalRecord, ExecutionAuthorityRecord } from "../approvals/index.ts";
import type { MaterialityAssessment } from "../policy/materiality.ts";
import type { DecisionRecord } from "../approvals/index.ts";
import type { TaskPacket, TaskPacketInput } from "../workflows/task-packets.ts";

export type AssignmentState = "planning" | "awaiting_approval" | "running" | "blocked" | "pausing" | "paused" | "handing_over" | "handover_ready" | "cancelling" | "closed";
export interface PlanState { planId: string; revision: number; purpose: "initial" | "continuation" | "steer"; lifecycle: "draft" | "proposed" | "active" | "superseded"; approach: string[]; acceptanceCriteria: string[]; priorPlanId?: string }
export interface TaskState { taskId: string; state: "draft" | "ready" | "dispatched" | "running" | "blocked" | "result_submitted" | "rework" | "accepted" | "closed" | "cancelled"; affectedPaths: string[]; executionIds: string[]; resultIds: string[] }
export interface ExecutionState { executionId: string; taskId: string; attempt: number; state: "ready" | "running" | "completed" | "failed" | "cancelled" | "unknown" }
export interface ActionState { actionId: string; taskId?: string; executionId?: string; description: string; state: "requested" | "started" | "succeeded" | "failed" | "prevented" | "cancelled" | "unknown" }
export interface ResultState { resultId: string; taskId: string; executionId: string; deliveryStatus: "complete" | "partial" | "failed"; summary: string; evidenceIds?: string[] }
export interface EvidenceState { evidenceId: string; subjectType: "execution" | "result" | "task" | "assignment"; subjectId: string; kind: string; location: string; digest: string; createdAt: string }
export interface AssessmentState extends MaterialityAssessment { assessmentId: string; createdAt: string; planId: string; planRevision: number }
export interface AssignmentAggregate {
  assignmentId: string; objective: string; lifecycle: AssignmentState; executionAuthority: ExecutionAuthorityRecord;
  currentPlan: PlanState; plans: PlanState[]; approvals: ApprovalRecord[]; tasks: TaskState[]; executions: ExecutionState[]; results: ResultState[];
  actions: ActionState[]; assessments: AssessmentState[]; decisions: DecisionRecord[]; evidence?: EvidenceState[]; pendingActionIds: string[];
  closureHistory: Array<{ disposition: "completed" | "cancelled"; closedAt: string }>;
  managerInstanceId: string; ownershipLease?: OwnershipLeaseState; nonmaterialChangeCount: number; holds: string[];
  checkpoints?: CheckpointState[]; taskPackets?: TaskPacket[]; handover?: HandoverState;
}
export interface AssignmentSummary { assignmentId: string; objective: string; lifecycle: AssignmentState; managerInstanceId: string; updatedAt: string }
export interface OwnershipLeaseState { token: string; managerInstanceId: string; acquiredAt: string; renewedAt: string; expiresAt: string }
export interface CheckpointState { checkpointId: string; kind: "resume" | "pause" | "handover" | "progress"; summary: string; createdAt: string; unresolvedActionIds: string[] }
export interface HandoverState { packageId: string; receiverManagerInstanceId: string; status: "ready" | "accepted" | "incomplete"; createdAt: string }
export interface WorkflowEvent { type: string; assignmentId: string; actor: ActorRef; data: Record<string, unknown>; at: string }
export interface WorkflowTransaction { get(): Promise<AssignmentAggregate | undefined>; save(aggregate: AssignmentAggregate): Promise<void>; append(event: WorkflowEvent): Promise<void> }
export interface WorkflowRepository {
  get(assignmentId: string): Promise<AssignmentAggregate | undefined>;
  save(aggregate: AssignmentAggregate): Promise<void>;
  append(event: WorkflowEvent): Promise<void>;
  transaction<T>(assignmentId: string, operation: (transaction: WorkflowTransaction) => Promise<T>): Promise<T>;
  listAssignments?(): Promise<AssignmentSummary[]>;
  acquireOwnership?(assignmentId: string, managerInstanceId: string, now?: Date): Promise<OwnershipLeaseState>;
  renewOwnership?(assignmentId: string, managerInstanceId: string, token: string, now?: Date): Promise<OwnershipLeaseState>;
  validateOwnership?(assignmentId: string, managerInstanceId: string, token: string | undefined, now?: Date): Promise<OwnershipLeaseState>;
  transferOwnership?(assignmentId: string, fromManagerInstanceId: string, receiverManagerInstanceId: string, token: string, now?: Date): Promise<OwnershipLeaseState>;
}
export interface AdapterOperations {
  requestStop(input: { assignmentId: string; executionId: string; mode: InterruptionMode; timeoutMs?: number }): Promise<{ confirmed: boolean; checkpointId?: string }>;
  createTransferPackage(input: { assignment: AssignmentAggregate; receiverManagerInstanceId: string }): Promise<{ packageId: string; valid: boolean }>;
  transferOwnership(input: { assignmentId: string; fromManagerInstanceId: string; receiverManagerInstanceId: string; packageId: string }): Promise<{ accepted: boolean }>;
  dispatchTask?(input: { assignmentId: string; taskId: string; executionId: string }): Promise<{ accepted: boolean }>;
}
export interface CommandContext { actor: ActorRef; managerInstanceId: string; ownershipToken?: string; now?: () => Date }
export interface CommandResponse<T = undefined> { status: "succeeded" | "blocked" | "failed"; code: string; assignment: AssignmentAggregate; data?: T }
export interface PauseRequest { assignmentId: string; mode?: InterruptionMode; timeoutMs?: number }
export interface HandoverRequest extends PauseRequest { receiverManagerInstanceId: string }
export interface SteerRequest { assignmentId: string; paths: string[]; rationale: string; approach: string[]; acceptanceCriteria: string[] }
export interface TaskCreationInput { affectedPaths: string[]; role?: string }
export interface ExecutionPacketInput extends Omit<TaskPacketInput, "task_id" | "execution_id" | "assignment_id"> {}
