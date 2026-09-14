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
 * Obligations: this store discharges none. The only p1 obligation with a
 * write effect is `create_primary_owner_membership` (bootstrap
 * `space.create`), which belongs to the budget-creation package
 * (`apps/api/src/budget-creation/transaction-store.ts`); composition may
 * layer that store over this one. Unimplemented obligations return `false`
 * so the boundary denies rather than pretending. `verify` succeeds only
 * when no non-audit obligation was required.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import type { InProcessRestrictedAuditStore } from "./audit.ts";

export class ApiTransactionStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  readonly #audit: InProcessRestrictedAuditStore;

  constructor(client: DataAccessClient, audit: InProcessRestrictedAuditStore) {
    this.#client = client;
    this.#audit = audit;
  }

  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    let handle: object | undefined;
    try {
      const result = await this.#client.transaction({ isolation: "serializable" }, async (scoped) => {
        handle = scoped;
        return work(scoped);
      });
      if (handle) await this.#audit.commit(handle);
      return result;
    } catch (error) {
      if (handle) this.#audit.discard(handle);
      throw error;
    }
  }

  async discharge(_transaction: unknown, _input: PolicyInput, _obligation: Obligation): Promise<boolean> {
    return false;
  }

  async verify(_transaction: unknown, _input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean> {
    return obligations.every((obligation) => obligation.kind === "audit" || obligation.kind === "recheck_at_commit");
  }
}
