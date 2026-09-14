/**
 * Action-dispatching `AuthorizationTransactionStore` (PROTO-ACTIVATION-001).
 *
 * The boundary holds exactly one transaction store, but three merged packages
 * each shipped their own: the CBD-233 `CreationAuthorizationStore` (bootstrap
 * `space.create`: retry budget, committed-replay and translated route
 * failures), the CBD-153 `TargetsAuthorizationStore` (the three target
 * actions: the structural `preserve` obligation and a rolled-back
 * `RouteFailure` returned as the result) and the identity/session
 * `ApiTransactionStore` (every other action, including the p2 subject-scoped
 * cells and their `bind_cache_key` obligation).
 *
 * `AuthorizationBoundary.execute` calls `transaction(work)` without naming the
 * action, and `boundary.ts` is mirrored byte-for-byte into the worker, so the
 * action travels on an `AsyncLocalStorage` scope that `ApiAuthorizationBoundary`
 * opens around `execute` (`action-scope.ts`). A `transaction()` call outside any
 * scope, or for an action no store claims, uses the general store.
 *
 * The in-process restricted audit stream buffers the allow event against the
 * transaction handle and only the general store flushed it. This store
 * observes every handle the delegate opens (a creation retry opens several)
 * and flushes the one that committed -- the last handle, when the delegate
 * resolved with a value that is not a rolled-back `RouteFailure` -- while
 * discarding the rest, so the audit chain sees exactly the committed effects.
 */
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import { RouteFailure } from "../authorization/http.js";
import { currentAction } from "./action-scope.ts";
import type { InProcessRestrictedAuditStore } from "./audit.ts";

export interface ActionStore {
  /** Actions this store owns. */
  readonly actions: readonly string[];
  readonly store: AuthorizationTransactionStore;
  /** Whether the delegate already flushes the audit buffer for a committed handle (only the general store does). */
  readonly flushesAudit?: boolean;
}

export class DispatchingTransactionStore implements AuthorizationTransactionStore {
  readonly #general: AuthorizationTransactionStore;
  readonly #byAction: ReadonlyMap<string, ActionStore>;
  readonly #audit: InProcessRestrictedAuditStore;

  constructor(general: AuthorizationTransactionStore, audit: InProcessRestrictedAuditStore, stores: readonly ActionStore[]) {
    const byAction = new Map<string, ActionStore>();
    for (const entry of stores) for (const action of entry.actions) {
      if (byAction.has(action)) throw new Error(`transaction store dispatch: "${action}" claimed twice`);
      byAction.set(action, entry);
    }
    this.#general = general; this.#byAction = byAction; this.#audit = audit;
  }

  #select(action: string | undefined): ActionStore | undefined {
    return action === undefined ? undefined : this.#byAction.get(action);
  }

  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    const selected = this.#select(currentAction());
    if (!selected) return this.#general.transaction(work);
    if (selected.flushesAudit) return selected.store.transaction(work);
    const handles: object[] = [];
    let result: T;
    try {
      result = await selected.store.transaction(async (transaction) => {
        if (transaction !== null && typeof transaction === "object") handles.push(transaction);
        return work(transaction);
      });
    } catch (error) {
      for (const handle of handles) this.#audit.discard(handle);
      throw error;
    }
    const committed = result instanceof RouteFailure ? undefined : handles.at(-1);
    for (const handle of handles) if (handle !== committed) this.#audit.discard(handle);
    if (committed) await this.#audit.commit(committed);
    return result;
  }

  discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    return (this.#select(input.request.action)?.store ?? this.#general).discharge(transaction, input, obligation);
  }

  verify(transaction: unknown, input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean> {
    return (this.#select(input.request.action)?.store ?? this.#general).verify(transaction, input, obligations);
  }
}
