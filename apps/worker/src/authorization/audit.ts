import type { EnforcementEvidence, EnforcementOutcome } from "../../../../packages/rate-limit/src/index.ts";
import { randomUUID } from "node:crypto";
import { CURRENT_POLICY_VERSION, INPUT_SCHEMA_VERSION, POLICY_VERSIONS, policyAuditEvent, sha256 } from "@cobudget/contracts/authorization";
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
  async emitEnforcement(outcome: EnforcementOutcome): Promise<void> {
    await this.#store.append((sequence, previousEventDigest) => {
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^[a-f0-9]{64}$/.test(previousEventDigest)) throw new Error("audit_integrity_unavailable");
      const event = { eventId: randomUUID(), occurredAt: outcome.timestamp, outcome: "deny" as const,
        correlationId: outcome.correlation_id, sequence, previousEventDigest,
        audienceClass: "restricted_security_evidence" as const, sensitivityClass: "authorization_metadata" as const,
        retentionClass: this.#governance.retentionClass, deletionPolicyVersion: this.#governance.deletionPolicyVersion,
        enforcement: structuredClone(outcome) };
      return { ...event, eventDigest: sha256(event) };
    });
  }
  async emit(decision: PolicyDecision, input: PolicyInput | undefined, correlationId: string, transaction?: unknown, enforcement?: EnforcementEvidence): Promise<void> {
    const variant = input?.authority.mode === "service" ? "service" : input?.bootstrap ? "bootstrap" : "ordinary";
    await this.#store.append((sequence, previousEventDigest) => {
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^[a-f0-9]{64}$/.test(previousEventDigest)) throw new Error("audit_integrity_unavailable");
      // PROTO-ACTIVATION-001: the action vocabulary is the released policy's (p2 adds the subject-scoped codes), not p1's.
      const knownAction = POLICY_VERSIONS[CURRENT_POLICY_VERSION].actionDefinitions.some((row) => row.action === input?.request.action);
      const event = policyAuditEvent({
        eventId: randomUUID(), occurredAt: new Date().toISOString(), decisionId: decision.decisionId,
        outcome: decision.outcome, reasonClass: decision.reasonClass, policyVersion: decision.policyVersion,
        policyDigest: decision.policyDigest, inputSchemaVersion: INPUT_SCHEMA_VERSION,
        actionCode: knownAction ? input?.request.action : "unregistered", effectClass: decision.effectClass,
        authorityMode: input?.authority.mode === "service" ? "service" : "user_delegated",
        ...(decision.outcome === "allow" ? { capturedVersions: decision.capturedVersions, cellRef: JSON.stringify(decision.cellRef) } : {}),
        correlationId, sequence, previousEventDigest,
        audienceClass: "restricted_security_evidence", sensitivityClass: "authorization_metadata",
        retentionClass: this.#governance.retentionClass, deletionPolicyVersion: this.#governance.deletionPolicyVersion,
        obligations: decision.obligations.map((item) => item.kind),
      }, variant);
      if (!enforcement) return policyAuditEvent({ ...event, eventDigest: sha256(event) }, variant);
      const enriched = { ...event, enforcement: { ...enforcement, earliest_decisive_gate: "authorization", authorization_evaluation: "evaluated", safe_reason_class: decision.reasonClass } };
      return { ...enriched, eventDigest: sha256(enriched) };
    }, transaction);
  }
}
