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
 */
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import type { InProcessRestrictedAuditStore } from "./audit.ts";

/** Fault-injection seam for the live race proofs (PROTO-ACTIVATION-001 A2): runs after the boundary's work and before COMMIT. Never set in production composition. */
export interface TransactionHooks {
  readonly beforeCommit?: ((transaction: unknown) => Promise<void>) | undefined;
}

const SERIALIZATION_ATTEMPTS = 3;

export class ApiTransactionStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  readonly #audit: InProcessRestrictedAuditStore;
  readonly #hooks: TransactionHooks;

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
      try {
        const result = await this.#client.transaction({ isolation: "serializable" }, async (scoped) => {
          handle = scoped;
          const value = await work(scoped);
          if (this.#hooks.beforeCommit) await this.#hooks.beforeCommit(scoped);
          return value;
        });
        if (handle) await this.#audit.commit(handle);
        return result;
      } catch (error) {
        if (handle) this.#audit.discard(handle);
        const state = (error as { sqlState?: string }).sqlState;
        if (attempt < SERIALIZATION_ATTEMPTS && (state === "40001" || state === "40P01")) continue;
        throw error;
      }
    }
  }

  async discharge(_transaction: unknown, _input: PolicyInput, obligation: Obligation): Promise<boolean> {
    // RC-05: bind_cache_key names caching dimensions for an already-authorized read; nothing to write.
    if (obligation.kind === "bind_cache_key") return true;
    return false;
  }

  async verify(_transaction: unknown, _input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean> {
    return obligations.every((obligation) => obligation.kind === "audit" || obligation.kind === "recheck_at_commit" || obligation.kind === "bind_cache_key");
  }
}
