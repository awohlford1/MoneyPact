import type { DataAccessClient, Condition } from "@cobudget/data-access";
import { digestOf } from "../creation-proposals/canonical-json.ts";
import { IDEMPOTENCY_RETENTION_MS } from "../creation-proposals/constants.ts";
import type {
  BudgetCreationProposalStore, CreateOrReplayResult, CreateProposalRecord,
  IdempotencyRecord, InvalidatedReason, ProposalContextKey, ProposalRecord,
  ReplaceProposalRecord, ReplaceProposalResult,
} from "../creation-proposals/ports.ts";

const TABLE = "budget_creation_proposal";

/** Lossless storage encoding; the CBD-232 public identifier remains unchanged. */
export function proposalUuid(id: string): string {
  if (!/^bcp_[0-9a-f]{32}$/u.test(id)) throw new Error("invalid proposal identifier");
  const hex = id.slice(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function subjectConditions(key: Pick<ProposalContextKey, "environment" | "subjectId">): Condition[] {
  if (!key.environment || !key.subjectId) throw new Error("missing proposal subject context");
  return [{ column: "environment", value: key.environment }, { column: "account_subject_id", value: key.subjectId }];
}
function contextMatches(record: ProposalRecord, key: ProposalContextKey): boolean {
  return record.environment === key.environment && record.subjectId === key.subjectId
    && record.accountId === key.accountId && record.profileId === key.profileId
    && record.sessionGeneration === key.sessionGeneration && record.proposalId === key.proposalId;
}
function sameScope(left: IdempotencyRecord, right: IdempotencyRecord): boolean {
  return left.key === right.key && left.environment === right.environment && left.subjectId === right.subjectId
    && left.accountId === right.accountId && left.profileId === right.profileId
    && left.sessionGeneration === right.sessionGeneration && left.operation === right.operation;
}
export interface LocatedProposal {
  readonly record: ProposalRecord;
  readonly candidateBudgetSpaceId: string;
  readonly lifecycleRevision: number;
}

/** Every lookup/update composes the subject predicate before considering an ID.
 * Creation/replacement scans the subject's idempotency records under SERIALIZABLE;
 * concurrent predicate changes abort the whole transaction, never just one write.
 */
export class DurableProposalStore implements BudgetCreationProposalStore {
  readonly #client: DataAccessClient;
  readonly #candidateId: () => string;
  readonly #now: () => string;
  constructor(client: DataAccessClient, candidateId: () => string, now: () => string) {
    this.#client = client; this.#candidateId = candidateId; this.#now = now;
  }

  async locate(key: ProposalContextKey, client: DataAccessClient = this.#client): Promise<LocatedProposal | null> {
    if (!/^bcp_[0-9a-f]{32}$/u.test(key.proposalId)) return null;
    const result = await client.platformSelect({ table: TABLE, conditions: [
      ...subjectConditions(key), { column: "proposal_id", value: proposalUuid(key.proposalId) },
    ] });
    const row = result.rows[0] as { proposal_payload: ProposalRecord; candidate_budget_space_id: string; lifecycle_revision: number } | undefined;
    if (!row || !contextMatches(row.proposal_payload, key)) return null;
    return { record: row.proposal_payload, candidateBudgetSpaceId: row.candidate_budget_space_id, lifecycleRevision: row.lifecycle_revision };
  }
  async loadForContext(key: ProposalContextKey): Promise<ProposalRecord | null> {
    return (await this.locate(key))?.record ?? null;
  }
  async #existing(client: DataAccessClient, command: CreateProposalRecord): Promise<CreateOrReplayResult | null> {
    const result = await client.platformSelect({ table: TABLE, conditions: subjectConditions(command.record) });
    for (const value of result.rows) {
      const row = value as { proposal_idempotency: IdempotencyRecord; proposal_payload: ProposalRecord };
      const existing = row.proposal_idempotency;
      if (!sameScope(existing, command.idempotency) || Date.parse(command.now) - Date.parse(existing.issuedAt) >= IDEMPOTENCY_RETENTION_MS) continue;
      if (existing.normalizedCommandDigest !== command.idempotency.normalizedCommandDigest) return {
        kind: "idempotency_conflict", conflict: { error: "idempotency_key_reused", retryWithNewKey: true, regenerateRequired: false },
      };
      const record = row.proposal_payload;
      if (record.status === "confirmed") return { kind: "idempotency_conflict", conflict: {
        error: "idempotency_replay_unavailable", reason: "confirmed", retryWithNewKey: true, regenerateRequired: false,
      } };
      const reason = record.status === "invalidated" ? "invalidated"
        : record.status === "expired" || Date.parse(command.now) >= Date.parse(record.expiresAt) ? "expired"
        : existing.dependencyFingerprint !== command.idempotency.dependencyFingerprint ? "dependency_changed" : null;
      if (reason) return { kind: "idempotency_conflict", conflict: {
        error: "idempotency_replay_unavailable", reason, retryWithNewKey: true, regenerateRequired: true,
      } };
      return { kind: "replayed", response: existing.response };
    }
    return null;
  }
  async #insert(client: DataAccessClient, command: CreateProposalRecord): Promise<CreateOrReplayResult> {
    const r = command.record;
    await client.platformInsert({ table: TABLE, values: {
      proposal_id: proposalUuid(r.proposalId), account_subject_id: r.subjectId, environment: r.environment,
      proposal_version: String(r.proposalVersion), proposal_digest: r.previewDigest, proposal_state: r.status,
      candidate_budget_space_id: this.#candidateId(), binding_digest: digestOf(r.confirmationBinding),
      proposal_payload: r, proposal_idempotency: command.idempotency,
      created_at: r.issuedAt, updated_at: command.now, lifecycle_revision: 1,
    } });
    return { kind: "created", record: r };
  }
  async createOrReplay(command: CreateProposalRecord): Promise<CreateOrReplayResult> {
    return this.#client.transaction({}, async (client) => await this.#existing(client, command) ?? await this.#insert(client, command));
  }
  async replaceCurrent(command: ReplaceProposalRecord): Promise<ReplaceProposalResult> {
    return this.#client.transaction({}, async (client) => {
      const existing = await this.#existing(client, command.successor);
      if (existing) return existing;
      // Do not permit a trusted caller bug to replace another context's draft.
      if (!contextMatches(command.successor.record, { ...command.predecessorContext, proposalId: command.successor.record.proposalId })) return { kind: "predecessor_conflict" };
      const located = await this.locate(command.predecessorContext, client);
      if (!located) return { kind: "predecessor_conflict" };
      const r = located.record;
      const terminal = r.status === "expired" || (r.status === "invalidated" && ["discarded", "session_ended", "context_changed"].includes(r.statusReason ?? ""));
      const current = r.status === "previewed" && r.draftRevision === command.expectedPredecessorRevision;
      if (r.successorProposalId !== null || (!terminal && !current)) return { kind: "predecessor_conflict" };
      await this.#update(client, command.predecessorContext, located, {
        ...r, successorProposalId: command.successor.record.proposalId,
        status: r.status === "previewed" ? "invalidated" : r.status,
        statusReason: r.status === "previewed" ? "superseded" : r.statusReason,
      }, command.successor.now);
      return this.#insert(client, command.successor);
    });
  }
  async #update(client: DataAccessClient, key: ProposalContextKey, prior: LocatedProposal, record: ProposalRecord, now: string): Promise<void> {
    const result = await client.platformUpdate({ table: TABLE, conditions: [
      ...subjectConditions(key), { column: "proposal_id", value: proposalUuid(key.proposalId) },
      { column: "lifecycle_revision", value: prior.lifecycleRevision },
    ], set: { proposal_payload: record, proposal_state: record.status, lifecycle_revision: prior.lifecycleRevision + 1, updated_at: now } });
    if (result.rowCount !== 1) throw new Error("proposal lifecycle conflict");
  }
  async invalidate(key: ProposalContextKey, expectedRevision: number, reason: InvalidatedReason): Promise<void> {
    await this.#client.transaction({}, async (client) => {
      const prior = await this.locate(key, client);
      if (!prior || prior.record.draftRevision !== expectedRevision || prior.record.status !== "previewed") return;
      await this.#update(client, key, prior, { ...prior.record, status: "invalidated", statusReason: reason }, this.#now());
    });
  }
}
