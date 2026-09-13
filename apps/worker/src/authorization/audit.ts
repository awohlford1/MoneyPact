import { randomUUID } from "node:crypto";
import { ACTION_DEFINITIONS, policyAuditEvent, sha256 } from "@cobudget/contracts/authorization";
import type { PolicyAuditEvent, PolicyDecision, PolicyInput } from "@cobudget/contracts/authorization";

export interface AuditGovernance {
  retentionClass: string;
  deletionPolicyVersion: string;
  retentionApprovalRef: string;
  reasonVocabularyApprovalRef: string;
}
export interface AuditStore {
  /** Lock the restricted stream, verify its prior digest, append the built event,
   * and commit its new head atomically. A supplied transaction MUST be used.
   * Denial calls without a transaction are separate restricted audit writes.
   */
  append(build: (sequence: number, previousEventDigest: string) => Partial<PolicyAuditEvent>, transaction?: unknown): Promise<void>;
}

export class RestrictedAudit {
  readonly #store: AuditStore;
  readonly #governance: AuditGovernance;
  constructor(store: AuditStore, governance: AuditGovernance) {
    if (![governance.retentionClass, governance.deletionPolicyVersion, governance.retentionApprovalRef, governance.reasonVocabularyApprovalRef].every((value) => typeof value === "string" && value.trim().length > 0)) throw new Error("audit_governance_unavailable");
    this.#store = store; this.#governance = Object.freeze({ ...governance });
  }
  async emit(decision: PolicyDecision, input: PolicyInput | undefined, correlationId: string, transaction?: unknown): Promise<void> {
    const variant = input?.authority.mode === "service" ? "service" : input?.bootstrap ? "bootstrap" : "ordinary";
    await this.#store.append((sequence, previousEventDigest) => {
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^[a-f0-9]{64}$/.test(previousEventDigest)) throw new Error("audit_integrity_unavailable");
      const knownAction = ACTION_DEFINITIONS.some((row) => row.action === input?.request.action);
      const event = policyAuditEvent({
        eventId: randomUUID(), occurredAt: new Date().toISOString(), decisionId: decision.decisionId,
        outcome: decision.outcome, reasonClass: decision.reasonClass, policyVersion: decision.policyVersion,
        policyDigest: decision.policyDigest, inputSchemaVersion: 1,
        actionCode: knownAction ? input?.request.action : "unregistered", effectClass: decision.effectClass,
        authorityMode: input?.authority.mode === "service" ? "service" : "user_delegated",
        ...(decision.outcome === "allow" ? { capturedVersions: decision.capturedVersions, cellRef: JSON.stringify(decision.cellRef) } : {}),
        correlationId, sequence, previousEventDigest,
        audienceClass: "restricted_security_evidence", sensitivityClass: "authorization_metadata",
        retentionClass: this.#governance.retentionClass, deletionPolicyVersion: this.#governance.deletionPolicyVersion,
        obligations: decision.obligations.map((item) => item.kind),
      }, variant);
      return policyAuditEvent({ ...event, eventDigest: sha256(event) }, variant);
    }, transaction);
  }
}
