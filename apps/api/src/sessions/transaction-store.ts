/**
 * `AuthorizationTransactionStore` over the CBD-246 transaction seam
 * (PROTO-WIRE-02). `AuthorizationBoundary.execute` runs every mutating
 * route inside `transaction()`, re-assembles facts on the scoped client,
 * discharges obligations, runs the handler, verifies postconditions and
 * appends the allow audit -- all before this store's COMMIT resolves.
 *
 * The scoped client is the transaction handle the route receives as
 * `effect.transaction`. A commit failure (including a deferred constraint
 * at COMMIT) rejects after the seam's ROLLBACK, and the buffered audit
 * events for that handle are discarded; a successful commit flushes them.
 *
 * Obligations: the only p1 obligation with a write effect is
 * `create_primary_owner_membership` (bootstrap `space.create`), which
 * belongs to the budget-creation package
 * (`apps/api/src/budget-creation/transaction-store.ts`); composition may
 * layer that store over this one. Unimplemented obligations return `false`
 * so the boundary denies rather than pretending.
 *
 * PROTO-IDENTITY-API-001 correction round 3 RC-05 (C2 activation): p2
 * introduces `profile.read` as a subject-scoped read cell that carries a
 * `bind_cache_key` obligation (packages/contracts/src/authorization
 * `evaluate.ts#obligation`, kind `"bind_cache_key"`). That obligation names
 * the version dimensions a caller-side cache would key a cached response
 * by (`environmentId`, `accountSubjectId`, `subjectVersion`,
 * `profileVersion`, `policyVersion`, and `targetVersion` when the cell has
 * a resource) -- it is declarative response-caching metadata the policy
 * asserts about *this already-authorized* decision, not a write this store
 * must perform. Discharging it is therefore a structural acceptance (the
 * shape is exactly what the contract's own obligation builder produces for
 * a subject-scoped read), never a byte written to any table; `verify`
 * likewise treats it as free, alongside `audit`/`recheck_at_commit`. Before
 * this, the blanket `discharge` refusal denied every subject-scoped read
 * cell -- including `identity.me`'s future `profile.read` binding -- for a
 * reason unrelated to the actual (still separately gated) activation state.
 *
 * PK-4 (CBD-234 design section 10.4; CBD-236 section 5.3) adds the one
 * obligation in the released policy that *is* a write: `fresh_assurance`.
 * CBD-236 section 8.2 makes a cell protected exactly by naming it, and
 * `decide` has already refused unless the assembled `assurance` leaves are
 * `fresh` and bound to this request's own action and space. Discharging it
 * means spending the grant those leaves came from -- once. That happens here
 * and not in the fact source for two reasons: the fact source is read twice
 * (precheck and commit-time recheck) and must return the same bytes both
 * times, and only this point is inside the transaction *after* the
 * commit-time re-decision allowed. A `false` here denies exactly like any
 * other undischargeable obligation, and a rollback anywhere later returns
 * the grant unspent, so a single step-up authorizes a single committed
 * protected effect -- never zero, never two.
 *
 * PK-7B (`SEC-PK7A-F2`): the reference channel. The Primary-transfer commit
 * records the evidence *reference* of the grant it was authorized by on the
 * transfer row and the outgoing consent row, and the module compares that
 * reference for equality only -- so the reference has to come from the one
 * place that knows which grant this transaction spent. This store records the
 * consumed `account_session_fresh_assurance.fresh_assurance_id` against the
 * transaction handle when the spend succeeds and exposes it through
 * `spentFreshAssuranceRef(handle)`; the transfer store and the confirm route
 * read it from here and from nowhere else -- never from a request field, never
 * from the session reference, never from a token or provider evidence. A
 * handle that spent nothing has no reference, and a rollback discards the
 * entry with the handle.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import { consumeFreshAssurance, findUsableFreshAssurance } from "@cobudget/sessions";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import type { InProcessRestrictedAuditStore } from "./audit.ts";

/** Fault-injection seam for the live race proofs (PROTO-ACTIVATION-001 A2): runs after the boundary's work and before COMMIT. Never set in production composition. */
export interface TransactionHooks {
  readonly beforeCommit?: ((transaction: unknown) => Promise<void>) | undefined;
}

const SERIALIZATION_ATTEMPTS = 3;

const RETRYABLE_SQL_STATES: ReadonlySet<string> = new Set(["40001", "40P01"]);

/**
 * SEC-PK4-F4. A serialization failure can surface on any statement of an
 * attempt -- the session row's idle extension inside the commit-time fact
 * read, the revocation fence, or the grant row -- and the layers between that
 * statement and this loop legitimately reduce it to their own fail-closed
 * answers (`resolve.ts` reports `not_authenticated`, the assembler throws
 * `FactFailure`). PostgreSQL has already aborted the whole transaction at that
 * point, so whether the attempt is retried cannot depend on which error object
 * finally arrives here. The scoped client is therefore observed: the SQLSTATE
 * of every failed statement is reported, and a retryable state seen anywhere in
 * the attempt retries the attempt. The observed object is the handle the route
 * receives, so identity-keyed audit buffering keeps working unchanged.
 */
function observeSqlState(client: DataAccessClient, seen: (sqlState: string) => void): DataAccessClient {
  const observed = Object.create(Object.getPrototypeOf(client) as object | null) as Record<string, unknown>;
  // Every own property, enumerable or not: the api client defines its profile
  // and membership statements as non-enumerable values.
  for (const name of Object.getOwnPropertyNames(client)) {
    const descriptor = Object.getOwnPropertyDescriptor(client, name)!;
    const member = descriptor.value as unknown;
    if (typeof member !== "function" || name === "transaction") {
      Object.defineProperty(observed, name, descriptor);
      continue;
    }
    const call = member as (...inner: unknown[]) => Promise<unknown>;
    Object.defineProperty(observed, name, {
      ...descriptor,
      value: async (...args: unknown[]) => {
        try {
          return await call.apply(client, args);
        } catch (error) {
          const state = (error as { sqlState?: unknown } | null)?.sqlState;
          if (typeof state === "string") seen(state);
          throw error;
        }
      },
    });
  }
  return observed as unknown as DataAccessClient;
}

export class ApiTransactionStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  readonly #audit: InProcessRestrictedAuditStore;
  readonly #hooks: TransactionHooks;
  /** PK-7B: the grant identifier each transaction handle consumed, set only by a successful spend. */
  readonly #spent = new WeakMap<object, string>();

  constructor(client: DataAccessClient, audit: InProcessRestrictedAuditStore, hooks: TransactionHooks = {}) {
    this.#client = client;
    this.#audit = audit;
    this.#hooks = hooks;
  }

  /**
   * One serializable transaction per effect. PROTO-ACTIVATION-001 A4 live proof: two actors creating
   * proposals at the same instant can trip SERIALIZABLE's predicate detection on the shared proposal
   * table (SQLSTATE 40001/40P01) although their rows never overlap; such a rolled-back attempt is retried
   * with a fresh transaction, up to `SERIALIZATION_ATTEMPTS`, exactly as the creation store already
   * does. Every attempt's buffered audit events are discarded on its rollback; only the committed
   * attempt's are published.
   */
  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      let handle: object | undefined;
      let observedState: string | undefined;
      try {
        const result = await this.#client.transaction({ isolation: "serializable" }, async (scoped) => {
          const observed = observeSqlState(scoped, (state) => { if (RETRYABLE_SQL_STATES.has(state)) observedState = state; });
          handle = observed;
          const value = await work(observed);
          if (this.#hooks.beforeCommit) await this.#hooks.beforeCommit(observed);
          return value;
        });
        if (handle) await this.#audit.commit(handle);
        return result;
      } catch (error) {
        if (handle) this.#audit.discard(handle);
        // The thrown error's own state (a wrapped store error, SEC-PK4-F4) or a retryable state any
        // statement of this attempt reported before a higher layer replaced the error.
        const state = (error as { sqlState?: string } | null)?.sqlState ?? observedState;
        if (attempt < SERIALIZATION_ATTEMPTS && state !== undefined && RETRYABLE_SQL_STATES.has(state)) continue;
        throw error;
      }
    }
  }

  async discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    // RC-05: bind_cache_key names caching dimensions for an already-authorized read; nothing to write.
    if (obligation.kind === "bind_cache_key") return true;
    if (obligation.kind === "fresh_assurance") return this.#spendFreshAssurance(transaction, input, obligation);
    return false;
  }

  /**
   * PK-4. Spends the grant `decide` just re-proved, on the boundary's own
   * transaction client. Every value in the lookup comes from the assembled
   * policy input and the obligation the policy itself produced -- never from
   * a request field -- and the obligation's action and space are compared
   * against the assurance leaves before anything is written, so a grant can
   * only ever be spent by the request it was bound to.
   */
  async #spendFreshAssurance(transaction: unknown, input: PolicyInput, obligation: Extract<Obligation, { kind: "fresh_assurance" }>): Promise<boolean> {
    const client = transaction as DataAccessClient | undefined;
    if (!client || typeof client.platformUpdate !== "function") return false;
    const assurance = input.assurance;
    const sessionRef = input.subject && "sessionRef" in input.subject ? input.subject.sessionRef : undefined;
    if (typeof sessionRef !== "string" || !sessionRef) return false;
    if (!assurance || assurance.level !== "fresh" || assurance.boundAction !== obligation.actionClass || assurance.boundSpaceId !== obligation.spaceId) return false;
    const now = new Date(input.evaluation.evaluatedAt);
    const grant = await findUsableFreshAssurance(client, { sessionRef, boundAction: obligation.actionClass, boundSpaceId: obligation.spaceId, now });
    if (!grant) return false;
    const consumed = await consumeFreshAssurance(client, { freshAssuranceId: grant.freshAssuranceId, action: obligation.actionClass, now: new Date() });
    if (consumed) this.#spent.set(client, grant.freshAssuranceId);
    return consumed;
  }

  /**
   * PK-7B (`SEC-PK7A-F2`): the evidence reference of the grant this
   * transaction spent -- the consumed row's own `fresh_assurance_id` -- or
   * `undefined` when this handle has spent none. It is the only source the
   * confirm route may take `ActorContext.freshAssuranceRef` from.
   */
  spentFreshAssuranceRef(transaction: unknown): string | undefined {
    return transaction !== null && typeof transaction === "object" ? this.#spent.get(transaction) : undefined;
  }

  async verify(_transaction: unknown, _input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean> {
    // `fresh_assurance` was discharged above by consuming the grant; a failure
    // there already denied, so reaching verification means it was spent.
    return obligations.every((obligation) => obligation.kind === "audit" || obligation.kind === "recheck_at_commit" || obligation.kind === "bind_cache_key" || obligation.kind === "fresh_assurance");
  }
}
