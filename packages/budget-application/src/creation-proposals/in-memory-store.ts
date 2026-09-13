import { IDEMPOTENCY_RETENTION_MS } from "./constants.ts";
import type {
  BudgetCreationProposalResponse, BudgetCreationProposalStore,
  CreateOrReplayResult, CreateProposalRecord, IdempotencyConflictResponse, IdempotencyRecord,
  InvalidatedReason, ProposalContextKey, ProposalRecord, ReplaceProposalRecord, ReplaceProposalResult,
} from "./ports.ts";

const SEP = String.fromCharCode(0);
function idempotencyKey(scope: IdempotencyRecord): string {
  return [scope.key, scope.environment, scope.subjectId, scope.accountId, scope.profileId,
    scope.sessionGeneration, scope.operation].join(SEP);
}
function proposalKey(key: Pick<ProposalContextKey, "accountId" | "profileId" | "sessionGeneration" | "proposalId">): string {
  return [key.accountId, key.profileId, key.sessionGeneration, key.proposalId].join(SEP);
}
function retentionExpired(value: IdempotencyRecord, now: string): boolean {
  return Date.parse(now) - Date.parse(value.issuedAt) >= IDEMPOTENCY_RETENTION_MS;
}
function lazyExpired(record: ProposalRecord, now: string): boolean {
  return record.status === "previewed" && Date.parse(now) >= Date.parse(record.expiresAt);
}
function terminalHeadReason(reason: InvalidatedReason | null): boolean {
  return reason === "discarded" || reason === "session_ended" || reason === "context_changed";
}
type ExistingOutcome =
  | { readonly kind: "not_applicable" }
  | { readonly kind: "idempotency_conflict"; readonly conflict: IdempotencyConflictResponse }
  | { readonly kind: "replayed"; readonly response: BudgetCreationProposalResponse };

/** Proposal test adapter. Legacy claim/confirm helpers model fixtures only;
 * they deliberately do not implement the transaction-bound CBD-233 port. */
export class InMemoryProposalStore implements BudgetCreationProposalStore {
  // Environment and subject are traversed before a proposal identifier can be considered.
  readonly #recordsByEnvironment = new Map<string, Map<string, Map<string, ProposalRecord>>>();
  readonly #idempotencyByScope = new Map<string, IdempotencyRecord>();

  #subjectRecords(environment: string, subjectId: string, create: boolean): Map<string, ProposalRecord> | undefined {
    let subjects = this.#recordsByEnvironment.get(environment);
    if (subjects === undefined && create) {
      subjects = new Map();
      this.#recordsByEnvironment.set(environment, subjects);
    }
    let records = subjects?.get(subjectId);
    if (records === undefined && create) {
      records = new Map();
      subjects?.set(subjectId, records);
    }
    return records;
  }
  #recordFor(key: ProposalContextKey): ProposalRecord | undefined {
    return this.#subjectRecords(key.environment, key.subjectId, false)?.get(proposalKey(key));
  }
  #setRecord(record: ProposalRecord): void {
    this.#subjectRecords(record.environment, record.subjectId, true)?.set(proposalKey(record), record);
  }

  async createOrReplay(command: CreateProposalRecord): Promise<CreateOrReplayResult> {
    const key = idempotencyKey(command.idempotency);
    const evaluated = this.#evaluateExisting(this.#idempotencyByScope.get(key), command.idempotency, command.now);
    if (evaluated.kind !== "not_applicable") return evaluated;
    this.#setRecord(command.record);
    this.#idempotencyByScope.set(key, command.idempotency);
    return { kind: "created", record: command.record };
  }

  async replaceCurrent(command: ReplaceProposalRecord): Promise<ReplaceProposalResult> {
    const key = idempotencyKey(command.successor.idempotency);
    const evaluated = this.#evaluateExisting(
      this.#idempotencyByScope.get(key), command.successor.idempotency, command.successor.now,
    );
    if (evaluated.kind !== "not_applicable") return evaluated;
    const predecessor = this.#recordFor(command.predecessorContext);
    if (predecessor === undefined) return { kind: "predecessor_conflict" };
    const current = predecessor.draftRevision === command.expectedPredecessorRevision &&
      predecessor.status === "previewed" && predecessor.successorProposalId === null;
    const terminal = predecessor.successorProposalId === null &&
      (predecessor.status === "expired" ||
        (predecessor.status === "invalidated" && terminalHeadReason(predecessor.statusReason as InvalidatedReason | null)));
    if (!current && !terminal) return { kind: "predecessor_conflict" };
    this.#setRecord({
      ...predecessor,
      successorProposalId: command.successor.record.proposalId,
      status: predecessor.status === "previewed" ? "invalidated" : predecessor.status,
      statusReason: predecessor.status === "previewed" ? "superseded" : predecessor.statusReason,
    });
    this.#setRecord(command.successor.record);
    this.#idempotencyByScope.set(key, command.successor.idempotency);
    return { kind: "created", record: command.successor.record };
  }

  async loadForContext(key: ProposalContextKey): Promise<ProposalRecord | null> {
    return this.#recordFor(key) ?? null;
  }
  async invalidate(key: ProposalContextKey, expectedRevision: number, reason: InvalidatedReason): Promise<void> {
    const record = this.#recordFor(key);
    if (record === undefined || record.draftRevision !== expectedRevision || record.status !== "previewed") return;
    this.#setRecord({ ...record, status: "invalidated", statusReason: reason });
  }
  async claimCurrentProposal(key: ProposalContextKey, binding: string): Promise<ProposalRecord> {
    const record = this.#recordFor(key);
    if (record === undefined) throw new Error("proposal not found for claim");
    if (record.status !== "previewed") throw new Error(`cannot claim a ${record.status} proposal`);
    if (record.confirmationBinding !== binding) throw new Error("confirmation binding mismatch");
    return record;
  }
  async recordConfirmed(proposalId: string, authoritativeBudgetSpaceId: string): Promise<void> {
    // The proposed seam supplies only the ID. Do not add an identifier-only secondary index.
    for (const subjects of this.#recordsByEnvironment.values()) for (const records of subjects.values()) {
      for (const record of records.values()) if (record.proposalId === proposalId && record.status === "previewed") {
        this.#setRecord({ ...record, status: "confirmed", statusReason: "confirmed",
          confirmedBudgetSpaceId: authoritativeBudgetSpaceId });
        return;
      }
    }
  }

  #evaluateExisting(existing: IdempotencyRecord | undefined, attempted: IdempotencyRecord, now: string): ExistingOutcome {
    if (existing === undefined || retentionExpired(existing, now)) return { kind: "not_applicable" };
    if (existing.normalizedCommandDigest !== attempted.normalizedCommandDigest) return {
      kind: "idempotency_conflict",
      conflict: { error: "idempotency_key_reused", retryWithNewKey: true, regenerateRequired: false },
    };
    const record = this.#recordFor({ environment: existing.environment, subjectId: existing.subjectId,
      accountId: existing.accountId, profileId: existing.profileId, sessionGeneration: existing.sessionGeneration,
      proposalId: existing.proposalId });
    if (record === undefined || record.status === "invalidated") return {
      kind: "idempotency_conflict",
      conflict: { error: "idempotency_replay_unavailable", reason: "invalidated",
        retryWithNewKey: true, regenerateRequired: true },
    };
    if (record.status === "confirmed") return {
      kind: "idempotency_conflict",
      conflict: { error: "idempotency_replay_unavailable", reason: "confirmed",
        retryWithNewKey: true, regenerateRequired: false },
    };
    if (record.status === "expired" || lazyExpired(record, now)) return {
      kind: "idempotency_conflict",
      conflict: { error: "idempotency_replay_unavailable", reason: "expired",
        retryWithNewKey: true, regenerateRequired: true },
    };
    if (existing.dependencyFingerprint !== attempted.dependencyFingerprint) return {
      kind: "idempotency_conflict",
      conflict: { error: "idempotency_replay_unavailable", reason: "dependency_changed",
        retryWithNewKey: true, regenerateRequired: true },
    };
    return { kind: "replayed", response: existing.response };
  }
}
