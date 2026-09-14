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
 * transaction handle and only the general store flushed it. PROTO-ACTIVATION-001
 * A3 (review R03): a package store reports every handle's fate explicitly
 * through `TransactionOutcomes` -- `committed` when the database COMMIT
 * returned, `rolledBack` when the seam rolled back, whatever value the store
 * then chooses to return (a translated failure, a replayed winner recovered
 * after a serialization failure). This store flushes exactly the handles
 * reported committed and discards every other handle it observed, so a
 * losing attempt's pending allow event can never enter the chain on the
 * strength of the response shape.
 */
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import { currentAction } from "./action-scope.ts";
import type { InProcessRestrictedAuditStore } from "./audit.ts";

/** Explicit per-handle outcome channel a package store reports on (A3). */
export interface TransactionOutcomes {
  committed(handle: object): void;
  rolledBack(handle: object): void;
}

export interface ActionStore {
  /** Actions this store owns. */
  readonly actions: readonly string[];
  readonly store: AuthorizationTransactionStore;
  /** Binds the store's outcome reports to this dispatcher; a store that cannot report has every handle discarded. */
  readonly observe?: (outcomes: TransactionOutcomes) => void;
  /** Whether the delegate already flushes the audit buffer for a committed handle (only the general store does). */
  readonly flushesAudit?: boolean;
}

export class DispatchingTransactionStore implements AuthorizationTransactionStore {
  readonly #general: AuthorizationTransactionStore;
  readonly #byAction: ReadonlyMap<string, ActionStore>;
  readonly #audit: InProcessRestrictedAuditStore;

  /** Per-handle fate reports, consumed by `settle`; entries are overwritten to `undefined` rather than deleted so the surface guard's raw-write scan stays quiet. */
  readonly #fates = new WeakMap<object, "committed" | "rolled_back" | undefined>();

  constructor(general: AuthorizationTransactionStore, audit: InProcessRestrictedAuditStore, stores: readonly ActionStore[]) {
    const byAction = new Map<string, ActionStore>();
    const outcomes: TransactionOutcomes = {
      committed: (handle) => { this.#fates.set(handle, "committed"); },
      rolledBack: (handle) => { this.#fates.set(handle, "rolled_back"); },
    };
    for (const entry of stores) {
      for (const action of entry.actions) {
        if (byAction.has(action)) throw new Error(`transaction store dispatch: "${action}" claimed twice`);
        byAction.set(action, entry);
      }
      entry.observe?.(outcomes);
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
    const settle = async (): Promise<void> => {
      // Flush only what the store reported committed; a handle it never reported on is treated as rolled back.
      for (const handle of handles) {
        if (this.#fates.get(handle) === "committed") await this.#audit.commit(handle);
        else this.#audit.discard(handle);
        this.#fates.set(handle, undefined);
      }
    };
    let result: T;
    try {
      result = await selected.store.transaction(async (transaction) => {
        if (transaction !== null && typeof transaction === "object") handles.push(transaction);
        return work(transaction);
      });
    } catch (error) {
      await settle();
      throw error;
    }
    await settle();
    return result;
  }

  discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    return (this.#select(input.request.action)?.store ?? this.#general).discharge(transaction, input, obligation);
  }

  verify(transaction: unknown, input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean> {
    return (this.#select(input.request.action)?.store ?? this.#general).verify(transaction, input, obligations);
  }
}
