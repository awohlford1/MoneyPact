import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import { RouteFailure } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import { ConfirmationError, type ConfirmBudgetCreationResponse, type CreationPlan } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import { proposalUuid } from "../../../../packages/budget-application/src/persistence/proposal-store.ts";
import type { ProposalRecord } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";
import { lookupConfirmation } from "../../../../packages/budget-application/src/persistence/confirmation-store.ts";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";

export function confirmationFailure(error: ConfirmationError): RouteFailure {
  const status = error.code === "invalid_request" ? 400 : error.code === "unauthenticated" ? 401
    : error.code === "proposal_not_found" ? 404 : error.code === "authorization_denied" ? 403
    // `stale_disclosure` (CBD-236 SS7 step 5) falls to the conflict default with every other stable
    // CBD-233 failure outcome; the amendment adding it to CBD-233 SS3.3 is routed to the CBD-233 owner.
    : error.code === "retryable_conflict" ? 503 : 409;
  return new RouteFailure(status, error.code);
}
class CommittedReplay {
  readonly response: ConfirmBudgetCreationResponse;
  constructor(response: ConfirmBudgetCreationResponse) { this.response = response; }
}

/** Operation-specific store; compose with the same FactSourceAdapter and audit
 * writer, both of which receive this exact transaction-scoped client. */
/** A3: per-handle fate reports for the dispatching store; see apps/api/src/sessions/dispatch.ts. */
export interface HandleOutcomes { committed(handle: object): void; rolledBack(handle: object): void }

export class CreationAuthorizationStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  readonly #attempts: number;
  #outcomes: HandleOutcomes | undefined;
  /** Binds the explicit outcome channel (A3). */
  observe(outcomes: HandleOutcomes): void { this.#outcomes = outcomes; }
  readonly #failures = new WeakMap<object, RouteFailure | undefined>();
  readonly #replays = new WeakMap<object, ConfirmBudgetCreationResponse | undefined>();
  readonly #plans = new WeakMap<object, CreationPlan | undefined>();
  constructor(client: DataAccessClient, attempts: number) {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) throw new RangeError("invalid confirmation attempt budget");
    this.#client = client; this.#attempts = attempts;
  }
  async replayAfterSession(client: DataAccessClient, context: CreationPlan["context"], request: CreationPlan["request"]): Promise<void> {
    try {
      const committed = await lookupConfirmation(client, context, request);
      if (committed) { this.#replays.set(client, committed); throw new CommittedReplay(committed); }
      const found = await client.platformSelect({ table: "budget_creation_proposal", conditions: [
        { column: "environment", value: context.environment }, { column: "account_subject_id", value: context.subjectId },
        { column: "proposal_id", value: proposalUuid(request.proposalId) } ] });
      const record = (found.rows[0] as { proposal_payload: ProposalRecord } | undefined)?.proposal_payload;
      if (!record || record.profileId !== context.profileId || record.accountId !== context.accountId || record.sessionGeneration !== context.sessionGeneration) throw new ConfirmationError("proposal_not_found");
      if (record.status !== "previewed" || record.successorProposalId !== null) throw new ConfirmationError("proposal_not_current");
    } catch (error) {
      if (error instanceof ConfirmationError) this.#failures.set(client, confirmationFailure(error));
      throw error;
    }
  }
  recordPlan(transaction: DataAccessClient, plan: CreationPlan): void { this.#plans.set(transaction, plan); }
  /**
   * Publishes a stable route failure raised *inside* the boundary's transaction, so it survives the
   * boundary's generic `AuthorizationDenied` translation. `transaction()` already captures whatever is
   * recorded here for the transaction's client and returns it instead of the 403 denial. Used for
   * `stale_disclosure`, which CBD-233 owes the caller as a named outcome (CBD-236 SS7 step 5).
   */
  recordFailure(transaction: DataAccessClient, failure: RouteFailure): void { this.#failures.set(transaction, failure); }
  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    let plan: CreationPlan | undefined;
    let replay: ConfirmBudgetCreationResponse | undefined;
    let failure: RouteFailure | undefined;
    for (let attempt = 1; ; attempt++) {
      let handle: object | undefined;
      let durable = false;
      try {
        const result = await this.#client.transaction({ isolation: "serializable" }, async client => {
          handle = client;
          try { return await work(client); }
          finally { failure = this.#failures.get(client); this.#failures.set(client, undefined); plan = this.#plans.get(client); replay = this.#replays.get(client); this.#plans.set(client, undefined); this.#replays.set(client, undefined); }
        });
        // The seam resolves only after COMMIT: report the fate before anything else can be returned.
        durable = true;
        if (handle) this.#outcomes?.committed(handle);
        if (!plan) throw new AuthorizationDenied();
        const committed = await lookupConfirmation(this.#client, plan.context, plan.request);
        if (!committed) throw new ConfirmationError("retryable_conflict");
        // The handler returns the persisted response; refresh it only after commit.
        if (typeof result !== "object" || result === null || !("confirmationOutcomeId" in result)) throw new AuthorizationDenied();
        return committed as T;
      } catch (error) {
        // Every path below returns or retries after a rollback: report it before choosing the response.
        if (handle && !durable) this.#outcomes?.rolledBack(handle);
        if (replay) return replay as T;
        if (failure) return failure as T;
        const state = (error as { sqlState?: string }).sqlState;
        if (plan && ["23505", "40001", "40P01"].includes(state ?? "")) {
          const committed = await lookupConfirmation(this.#client, plan.context, plan.request);
          if (committed) return committed as T;
        }
        if (error instanceof ConfirmationError && !["unauthenticated", "authorization_denied"].includes(error.code)) return confirmationFailure(error) as T;
        if (!["23505", "40001", "40P01"].includes(state ?? "")) throw error;
        if (attempt >= this.#attempts) return confirmationFailure(new ConfirmationError("retryable_conflict")) as T;
      }
    }
  }
  async discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    if (obligation.kind !== "create_primary_owner_membership" || input.request.action !== "space.create" || !input.bootstrap || !input.subject || !input.profile) return false;
    const client = transaction as DataAccessClient;
    await client.tenantInsert({ table: "budget_space_membership", budgetSpaceId: input.bootstrap.candidateSpaceId,
      values: { membership_id: input.bootstrap.candidatePrimaryMembershipId, account_subject_id: input.subject.accountSubjectId,
        profile_id: input.profile.profileId, role: "primary_owner", status: "active", authorization_version: 1,
        created_by_subject_id: input.subject.accountSubjectId } });
    return true;
  }
  async verify(transaction: unknown, input: PolicyInput, _obligations: readonly Obligation[]): Promise<boolean> {
    if (!input.bootstrap || !input.subject || !input.profile) return false;
    const client = transaction as DataAccessClient; const budgetSpaceId = input.bootstrap.candidateSpaceId;
    const budgets = await client.tenantSelect({ table: "budget_space", budgetSpaceId });
    const memberships = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId });
    const member = memberships.rows[0] as Record<string, unknown> | undefined;
    const budget = budgets.rows[0] as Record<string, unknown> | undefined;
    // CBD-236 SS7: the creator's consent row is a postcondition of this transaction. Exactly one current
    // self_disclosure row for the candidate membership, recorded for the acting subject, carrying the
    // registry version and digest the composition read server-side -- a handler that omitted or altered
    // the consent write fails verification here, and the migration's deferred trigger fails it again at
    // COMMIT. This check never *creates* consent; it refuses to commit a membership without it.
    const consents = await client.tenantSelect({ table: "budget_space_consent", budgetSpaceId,
      conditions: [{ column: "membership_id", value: input.bootstrap.candidatePrimaryMembershipId }, { column: "state", value: "current" }] });
    const consent = consents.rows[0] as Record<string, unknown> | undefined;
    if (consents.rowCount !== 1 || consent?.source !== "self_disclosure" || consent.account_subject_id !== input.subject.accountSubjectId
      || consent.disclosure_kind !== PRIMARY_OWNER_SELF_DISCLOSURE || !Number.isSafeInteger(Number(consent.disclosure_version))
      || Number(consent.disclosure_version) < 1 || typeof consent.disclosure_digest !== "string" || !consent.disclosure_digest) return false;
    return budgets.rowCount === 1 && memberships.rowCount === 1 && member?.membership_id === input.bootstrap.candidatePrimaryMembershipId
      && member.account_subject_id === input.subject.accountSubjectId && member.profile_id === input.profile.profileId
      && member.role === "primary_owner" && member.status === "active" && member.authorization_version === 1
      && budget?.primary_owner_membership_id === member.membership_id && budget.lifecycle === "live";
  }
}
