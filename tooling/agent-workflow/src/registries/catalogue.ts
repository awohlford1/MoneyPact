export const CORE_EVENT_TYPES = [
  "manager.command_received", "manager.command_accepted", "manager.command_rejected",
  "manager.question_received", "manager.answer_provided", "manager.status_reported",
  "manager.command_completed", "manager.command_failed", "assignment.created",
  "provider.signal_observed",
  "assignment.resume_requested", "assignment.context_restored", "assignment.execution_authorized",
  "assignment.execution_blocked", "assignment.execution_unblocked", "assignment.closed",
  "assignment.steer_requested", "assignment.pause_requested", "assignment.paused",
  "assignment.pause_incomplete", "assignment.handover_requested", "assignment.handover_ready",
  "assignment.handover_incomplete", "plan.proposed", "plan.approved", "plan.rejected",
  "plan.approval_waived", "plan.change_assessed", "plan.superseded", "task.created",
  "task.validated", "task.dispatch_requested", "task.dispatched", "task.change_requested", "task.closed", "task.cancelled",
  "task.superseded", "execution.started", "execution.progress_reported",
  "execution.heartbeat_observed", "execution.message_sent", "execution.message_acknowledged",
  "execution.completed", "execution.failed", "execution.cancelled", "execution.outcome_unknown",
  "execution.stop_requested", "execution.checkpointed", "execution.stopped",
  "action.intent_recorded", "action.started", "action.succeeded", "action.failed",
  "action.prevented", "action.cancelled", "action.outcome_unknown", "action.reconciled",
  "submission.received", "submission.awaiting_validation", "submission.validation_passed",
  "submission.rejected", "submission.validation_timed_out", "quarantine.resolved",
  "result.accepted", "result.changes_requested", "evidence.recorded", "decision.recorded",
  "approval.requested", "approval.granted", "approval.rejected", "approval.revoked",
  "approval.expired", "escalation.raised", "escalation.resolved",
  "manager.ownership_acquired", "manager.ownership_released", "record.closed",
  "archive.completed", "archive.failed", "cleanup.completed", "runtime.operation_blocked",
  "event.corrected",
] as const;

export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

export const CORE_RECORD_TYPES = [
  "configuration", "assignment", "plan", "checkpoint", "work-item", "task", "task-packet",
  "execution", "action", "result", "assessment", "approval", "decision", "evidence",
  "escalation", "pending", "quarantine", "hold", "archive-manifest", "cleanup-manifest",
  "awaiting-validation", "action-reconciliation", "raw-response",
] as const;

export type CoreRecordType = (typeof CORE_RECORD_TYPES)[number];
