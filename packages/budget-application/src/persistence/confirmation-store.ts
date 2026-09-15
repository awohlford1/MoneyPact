import type { DataAccessClient } from "@cobudget/data-access";
import { DurableProposalStore, proposalUuid, proposalConfirmationPort } from "./proposal-store.ts";
import { ConfirmationError, equalDigest, requestDigest } from "../creation-confirmation/index.ts";
import type { ClaimedProposal, ConfirmationTransaction, ConfirmationUnitOfWork, ConfirmBudgetCreationRequest, ConfirmBudgetCreationResponse, ConsentWriter, CreationPlan } from "../creation-confirmation/index.ts";
import type { AuthenticatedSubjectContext, Ports, ProposalRecord } from "../creation-proposals/ports.ts";
import { digestOf } from "../creation-proposals/canonical-json.ts";

/** The two-phase consent dependency: compare the claim (before the first insert), then write the row it admitted. */
export type ConsentDependency = (request: ConfirmBudgetCreationRequest) => (client: DataAccessClient, plan: CreationPlan) => Promise<void>;
export interface ConfirmationDependencies {
  readonly attempts: number;
  readonly reload: (client: DataAccessClient, context: AuthenticatedSubjectContext, record: ProposalRecord) => Promise<{ context: AuthenticatedSubjectContext; ports: Ports }>;
  /** Must use this client and retain authority locks/conditional predicates through commit. */
  readonly authorize: (client: DataAccessClient, proposal: ClaimedProposal) => Promise<ConfirmBudgetCreationResponse["authorization"]>;
  readonly allowAudit: (client: DataAccessClient, plan: CreationPlan) => Promise<void>;
  readonly boundary?: (point: string) => Promise<void>;
  /** The HTTP authorization store has already discharged this exact membership. */
  readonly membershipDischarged?: boolean;
  /**
   * CBD-236 consent landing (CBD236-CONSENT-SEMANTICS-001 item 4) in two
   * phases (`CBD233-STALE-CHECK-ORDER-001`). Calling it with the request is
   * phase 1: it reads the approved registry once and denies `stale_disclosure`
   * when the request's acknowledged disclosure is not that registry's current
   * one -- before this transaction has inserted anything. The function it
   * returns is phase 2, which writes the creator's `budget_space_consent` row
   * on this same client, immediately after the creator membership, carrying
   * the disclosure phase 1 compared. A required dependency and not an optional
   * hook: a confirmation that cannot record consent must not commit a
   * membership, which the migration's deferred activation-atomicity trigger
   * independently enforces at COMMIT.
   */
  readonly consent: ConsentDependency;
}
const scope = (c: AuthenticatedSubjectContext) => [{ column: "environment", value: c.environment }, { column: "account_subject_id", value: c.subjectId }];
export async function lookupConfirmation(client: DataAccessClient, context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ConfirmBudgetCreationResponse | null> {
  // Scan only the authenticated subject's proposal locators. This also detects key
  // reuse for a DIFFERENT proposal; querying only the requested tenant cannot.
  const proposals = await client.platformSelect({ table: "budget_creation_proposal", conditions: scope(context) });
  for (const value of proposals.rows) {
    const row = value as { candidate_budget_space_id: string };
    const found = await client.tenantSelect({ table: "budget_creation_idempotency", budgetSpaceId: row.candidate_budget_space_id,
      conditions: [...scope(context), { column: "confirmation_idempotency_key", value: request.confirmationIdempotencyKey }] });
    const stored = found.rows[0] as { request_digest: string; committed_response: ConfirmBudgetCreationResponse } | undefined;
    if (!stored) continue;
    if (!equalDigest(stored.request_digest, requestDigest(request))) throw new ConfirmationError("idempotency_key_reused");
    return stored.committed_response;
  }
  return null;
}
export class DurableConfirmationTransaction implements ConfirmationTransaction {
  readonly client: DataAccessClient; readonly proposals: DurableProposalStore; readonly dependencies: ConfirmationDependencies;
  readonly #proposalPort: ReturnType<typeof proposalConfirmationPort>;
  constructor(client: DataAccessClient, proposals: DurableProposalStore, dependencies: ConfirmationDependencies) {
    this.client = client; this.proposals = proposals; this.dependencies = dependencies;
    this.#proposalPort = proposalConfirmationPort(proposals, client);
  }
  async point(name: string): Promise<void> { await this.dependencies.boundary?.(name); }
  async step<T>(name: string, operation: () => Promise<T>): Promise<T> {
    await this.point("before:" + name); const result = await operation(); await this.point("after:" + name); return result;
  }
  replay(context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ConfirmBudgetCreationResponse | null> { return lookupConfirmation(this.client, context, request); }
  /**
   * Phase 1 of the consent dependency, on this transaction's own client and
   * before its first insert: the registry read and the claim comparison, which
   * throws `stale_disclosure` having inserted nothing. The returned writer is
   * the observed `budget_space_consent` step of `persist`.
   */
  async prepareConsent(request: ConfirmBudgetCreationRequest): Promise<ConsentWriter> {
    const write = await this.step("disclosure_check", async () => this.dependencies.consent(request));
    return plan => this.step("budget_space_consent", () => write(this.client, plan));
  }
  async claimCurrentProposal(context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ClaimedProposal> {
    return this.step("proposal_claim", async () => {
      const key = { ...context, proposalId: request.proposalId };
      const located = await this.proposals.locate(key, this.client);
      if (!located) throw new ConfirmationError("proposal_not_found");
      if (located.record.status !== "previewed" || located.record.successorProposalId !== null) throw new ConfirmationError("proposal_not_current");
      // A conditional no-op UPDATE obtains the row lock without a separately
      // committed claim. The SERIALIZABLE loser retries from a fresh snapshot.
      try { await this.#proposalPort.claimCurrentProposal(key, request.confirmationBinding, located.lifecycleRevision); }
      catch (error) { if ((error as { sqlState?: string }).sqlState) throw error; throw new ConfirmationError("proposal_not_current"); }
      return located;
    });
  }
  reload(context: AuthenticatedSubjectContext, record: ProposalRecord): Promise<{ context: AuthenticatedSubjectContext; ports: Ports }> {
    return this.step("dependency_reload", () => this.dependencies.reload(this.client, context, record));
  }
  authorize(proposal: ClaimedProposal): Promise<ConfirmBudgetCreationResponse["authorization"]> {
    return this.step("authorization", () => this.dependencies.authorize(this.client, proposal));
  }
  async persist(plan: CreationPlan): Promise<void> {
    const { response: r, proposal: p, context: c } = plan; const record = p.record;
    const insert = async (table: string, values: Readonly<Record<string, unknown>>, label = table): Promise<void> => {
      await this.step(label, () => this.client.tenantInsert({ table, budgetSpaceId: r.budgetSpaceId, values }));
    };
    await insert("budget_space", { name: record.normalizedInputs.name, name_version: 1, time_zone: record.normalizedInputs.timeZone,
      time_zone_data_version: record.governingVersions.timeZoneDataVersion, currency_code: record.normalizedInputs.currencyCode,
      currency_catalog_version: record.governingVersions.currencyCatalogVersion, lifecycle: "live", lifecycle_version: 1,
      primary_owner_membership_id: r.primaryOwnerMembershipId, initial_schedule_version_id: r.initialScheduleVersionId,
      current_schedule_version_id: r.currentScheduleVersionId, current_period_id: r.currentPeriodId,
      created_by_subject_id: c.subjectId, created_at: r.committedAt, updated_at: r.committedAt });
    if (!this.dependencies.membershipDischarged) await insert("budget_space_membership", { membership_id: r.primaryOwnerMembershipId,
      profile_id: c.profileId, account_subject_id: c.subjectId, role: "primary_owner", status: "active", authorization_version: 1,
      created_by_subject_id: c.subjectId, created_at: r.committedAt });
    // CBD-236 SS7 step 6: the consent row follows the creator membership inside this same transaction.
    // The claim it rests on was compared before the `budget_space` insert above (`prepareConsent`).
    await plan.consent(plan);
    await insert("budget_space_schedule_version", { schedule_version_id: r.initialScheduleVersionId, sequence: 1, status: "authoritative",
      cadence_definition: record.normalizedInputs.schedule, proposal_preview_digest: record.previewDigest, created_at: r.committedAt });
    for (const [i, period] of record.preview.periods.entries()) await insert("budget_space_period", { period_id: plan.periodIds[i],
      schedule_version_id: r.initialScheduleVersionId, status: plan.periodIds[i] === r.currentPeriodId ? "active" : "planned",
      period_start_date: period.start, period_end_date: period.end, created_at: r.committedAt }, "period:" + i);
    await insert("budget_creation_operation", { operation_id: plan.operationId, proposal_id: proposalUuid(record.proposalId),
      environment: c.environment, account_subject_id: c.subjectId, profile_id: c.profileId, proposal_version: String(record.proposalVersion),
      proposal_digest: record.previewDigest, binding_version: record.bindingVersion, status: "succeeded", created_at: r.committedAt });
    await this.step("allow_audit", () => this.dependencies.allowAudit(this.client, plan));
    await insert("budget_creation_audit", { audit_id: plan.operationId, operation_id: plan.operationId, event_type: "budget.created",
      payload: { proposalId: record.proposalId, outcomeId: r.confirmationOutcomeId, budgetSpaceId: r.budgetSpaceId,
        scheduleVersionId: r.initialScheduleVersionId, periodId: r.currentPeriodId, governingVersions: record.governingVersions,
        authorization: r.authorization, committedAt: r.committedAt }, occurred_at: r.committedAt });
    await insert("budget_creation_success", { success_id: r.confirmationOutcomeId, operation_id: plan.operationId, response_payload: r, created_at: r.committedAt });
    await insert("budget_creation_idempotency", { idempotency_id: r.confirmationOutcomeId, operation_id: plan.operationId,
      environment: c.environment, account_subject_id: c.subjectId, confirmation_idempotency_key: plan.request.confirmationIdempotencyKey,
      request_digest: requestDigest(plan.request), committed_response: r, created_at: r.committedAt });
    await this.step("proposal_confirmed", async () => {
      await this.#proposalPort.recordConfirmed({ context: { ...c, proposalId: record.proposalId }, authoritativeBudgetSpaceId: r.budgetSpaceId,
        confirmationOutcomeId: r.confirmationOutcomeId, expectedLifecycleRevision: p.lifecycleRevision, bindingDigest: digestOf(plan.request.confirmationBinding) });
    });
  }
}
export class DurableConfirmationStore implements ConfirmationUnitOfWork {
  readonly client: DataAccessClient; readonly proposals: DurableProposalStore; readonly dependencies: ConfirmationDependencies;
  constructor(client: DataAccessClient, proposals: DurableProposalStore, dependencies: ConfirmationDependencies) {
    this.client = client; this.proposals = proposals; this.dependencies = dependencies;
    if (!Number.isSafeInteger(dependencies.attempts) || dependencies.attempts < 1 || dependencies.attempts > 10) throw new RangeError("invalid confirmation attempt budget");
  }
  loadCommitted(context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ConfirmBudgetCreationResponse | null> {
    return lookupConfirmation(this.client, context, request);
  }
  async confirm<T>(work: (transaction: ConfirmationTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.client.transaction({ isolation: "serializable" }, async client => {
          const tx = new DurableConfirmationTransaction(client, this.proposals, this.dependencies);
          const result = await work(tx);
          // DataAccessClient forces deferred constraints at COMMIT before resolving.
          await tx.point("before:commit"); return result;
        });
      } catch (error) {
        const state = (error as { sqlState?: string }).sqlState;
        if (!["23505", "40001", "40P01"].includes(state ?? "")) throw error;
        if (attempt >= this.dependencies.attempts) throw new ConfirmationError("retryable_conflict");
      }
    }
  }
}
