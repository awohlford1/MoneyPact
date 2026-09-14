/** Commands whose invocation is recorded as part of the managed workflow. */
export const MANAGED_WORKFLOW_COMMANDS = [
  "start", "resume", "status", "ask", "steer", "pause", "handover",
  "approve-plan", "reject-plan", "waive-plan", "task-create", "task-transition",
  "execution-begin", "execution-outcome", "result-submit", "result-rework",
  "result-accept", "task-close", "action-create", "action-outcome",
  "action-reconcile", "decision-record", "cancel", "close", "reopen",
  "ownership-acquire", "transcript-record", "quarantine-submit", "quarantine-show", "quarantine-resolve",
] as const;

export type ManagedWorkflowCommand = typeof MANAGED_WORKFLOW_COMMANDS[number];
