import type { ActorRef } from "../contracts/actors.ts";
import type { PolicyDecision } from "../policy/decisions.ts";
export { verifyExecutiveApprovalReceipt, type ApprovalVerification, type ExecutiveApprovalReceiptPayload, type SignedExecutiveApprovalReceipt } from "./receipts.ts";
import type { ApprovalVerification } from "./receipts.ts";

export type ApprovalState = "requested" | "granted" | "rejected" | "revoked" | "expired" | "waived";
export interface ApprovalRecord {
  approvalId: string; subjectType: string; subjectId: string; subjectRevision: number;
  state: ApprovalState; scope: string; approver: ActorRef; createdAt: string;
  grantedAt?: string; expiresAt?: string; waiverAuthority?: ActorRef;
  verification?: ApprovalVerification;
}

export function requestApproval(input: Omit<ApprovalRecord, "state" | "createdAt">, now = new Date()): ApprovalRecord {
  return { ...input, state: "requested", createdAt: now.toISOString() };
}

export function grantApproval(record: ApprovalRecord, actor: ActorRef, now = new Date()): ApprovalRecord {
  if (record.state !== "requested") throw new Error(`Approval in ${record.state} cannot be granted`);
  if (actor.actorType !== "executive") throw new Error("Only an executive may grant plan execution approval");
  return { ...record, state: "granted", approver: actor, grantedAt: now.toISOString() };
}

export function waiveApproval(record: ApprovalRecord, actor: ActorRef): ApprovalRecord {
  if (record.state !== "requested") throw new Error(`Approval in ${record.state} cannot be waived`);
  if (actor.actorType !== "executive") throw new Error("Only an executive may waive plan approval");
  return { ...record, state: "waived", approver: actor, waiverAuthority: actor };
}

export function validateApproval(record: ApprovalRecord | undefined, subject: { type: string; id: string; revision: number; scope: string }, now = new Date()): PolicyDecision {
  if (record === undefined || !["granted", "waived"].includes(record.state)) return { allowed: false, code: "APPROVAL_REQUIRED", reason: "An active approval or waiver is required" };
  if (record.subjectType !== subject.type || record.subjectId !== subject.id || record.scope !== subject.scope) return { allowed: false, code: "APPROVAL_SCOPE_MISMATCH", reason: "Approval does not cover this subject and scope" };
  if (record.subjectRevision !== subject.revision) return { allowed: false, code: "APPROVAL_REVISION_MISMATCH", reason: "Approval does not cover this revision" };
  if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now.getTime()) return { allowed: false, code: "APPROVAL_REQUIRED", reason: "Approval has expired" };
  return { allowed: true, code: "ALLOW", reason: "Approval matches subject, revision, and scope" };
}

export interface DecisionRecord { decisionId: string; subjectId: string; choice: string; rationale: string; decidedBy: ActorRef; decidedAt: string }
export interface ExecutionAuthorityRecord { assignmentId: string; planId: string; planRevision: number; state: "unauthorized" | "authorized" | "held"; approvalId?: string; reason: string; updatedAt: string }

export function authorizeExecution(assignmentId: string, planId: string, planRevision: number, approval: ApprovalRecord, now = new Date()): ExecutionAuthorityRecord {
  const decision = validateApproval(approval, { type: "plan", id: planId, revision: planRevision, scope: "execute" }, now);
  if (!decision.allowed) throw new Error(`${decision.code}: ${decision.reason}`);
  return { assignmentId, planId, planRevision, state: "authorized", approvalId: approval.approvalId, reason: approval.state, updatedAt: now.toISOString() };
}
