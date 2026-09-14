export type TransitionTable<TState extends string> = Readonly<Record<TState, readonly TState[]>>;

export const assignmentTransitions = {
  planning: ["awaiting_approval", "cancelling"],
  awaiting_approval: ["running", "blocked", "cancelling"],
  running: ["blocked", "pausing", "handing_over", "cancelling", "closed"],
  blocked: ["awaiting_approval", "running", "pausing", "handing_over", "cancelling"],
  pausing: ["paused", "blocked"],
  paused: ["awaiting_approval", "handing_over", "cancelling"],
  handing_over: ["handover_ready", "blocked"],
  handover_ready: ["awaiting_approval", "cancelling"],
  cancelling: ["closed"],
  closed: ["awaiting_approval"],
} as const;

export const planTransitions = {
  draft: ["proposed"], proposed: ["active", "superseded"], active: ["superseded"], superseded: [],
} as const;

export const taskTransitions = {
  draft: ["ready", "cancelled"], ready: ["dispatched", "cancelled"], dispatched: ["running", "cancelled"], running: ["result_submitted", "blocked", "cancelled"],
  blocked: ["ready", "running", "rework", "cancelled"], result_submitted: ["accepted", "rework", "cancelled"],
  rework: ["ready", "cancelled"], accepted: ["closed"], closed: [], cancelled: [],
} as const;

export const executionTransitions = {
  ready: ["running", "cancelled"], running: ["completed", "failed", "cancelled", "unknown"],
  completed: [], failed: [], cancelled: [], unknown: ["completed", "failed", "cancelled"],
} as const;

export const actionTransitions = {
  requested: ["started", "prevented", "cancelled"], started: ["succeeded", "failed", "cancelled", "unknown"],
  unknown: ["succeeded", "failed", "prevented", "cancelled"], succeeded: [], failed: [], prevented: [], cancelled: [],
} as const;

export const submissionTransitions = {
  received: ["awaiting_validation", "validated", "rejected"], awaiting_validation: ["validated", "quarantined"],
  validated: ["accepted", "rework"], rejected: ["quarantined"], quarantined: ["resolved"],
  resolved: [], accepted: [], rework: ["received"],
} as const;

export const approvalTransitions = {
  requested: ["granted", "rejected", "expired", "waived"], granted: ["revoked", "expired"],
  rejected: [], revoked: [], expired: [], waived: [],
} as const;

export const escalationTransitions = { raised: ["resolved"], resolved: [] } as const;
export const pauseTransitions = { requested: ["checkpointed", "incomplete"], checkpointed: ["paused", "incomplete"], paused: [], incomplete: [] } as const;
export const handoverTransitions = { requested: ["ready", "incomplete"], ready: ["accepted", "incomplete"], accepted: [], incomplete: [] } as const;
export const cancellationTransitions = { requested: ["cancelling"], cancelling: ["cancelled", "blocked"], cancelled: [], blocked: ["cancelling"] } as const;
export const closureTransitions = { open: ["completed", "cancelled"], completed: ["reopened"], cancelled: ["reopened"], reopened: ["open"] } as const;
export const reopenTransitions = { closed: ["checkpoint_created"], checkpoint_created: ["awaiting_approval"], awaiting_approval: ["reopened"], reopened: [] } as const;

export const transitionRegistries = {
  assignment: assignmentTransitions, plan: planTransitions, task: taskTransitions, execution: executionTransitions,
  action: actionTransitions, submission: submissionTransitions, approval: approvalTransitions, escalation: escalationTransitions,
  pause: pauseTransitions, handover: handoverTransitions, cancellation: cancellationTransitions, closure: closureTransitions,
  reopen: reopenTransitions,
} as const;

export function canTransition<T extends string>(table: TransitionTable<T>, from: T, to: T): boolean {
  return table[from]?.includes(to) ?? false;
}

export function assertTransition<T extends string>(table: TransitionTable<T>, from: T, to: T, resource: string): void {
  if (!canTransition(table, from, to)) throw new WorkflowTransitionError(resource, from, to);
}

export class WorkflowTransitionError extends Error {
  readonly code = "TRANSITION_NOT_ALLOWED";
  readonly resource: string;
  readonly from: string;
  readonly to: string;
  constructor(resource: string, from: string, to: string) {
    super(`${resource} cannot transition from ${from} to ${to}`);
    this.name = "WorkflowTransitionError";
    this.resource = resource;
    this.from = from;
    this.to = to;
  }
}
