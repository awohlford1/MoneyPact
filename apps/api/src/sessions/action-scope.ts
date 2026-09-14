/**
 * The action of the current boundary execution (PROTO-ACTIVATION-001).
 *
 * `AuthorizationBoundary.execute` (mirrored byte-for-byte into the worker)
 * calls its transaction store without naming the action, so
 * `ApiAuthorizationBoundary` opens this scope around `execute` and the
 * dispatching store (`dispatch.ts`) reads it to choose the package store.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<{ readonly action: string }>();

/** Opens the action scope for one boundary execution; the innermost scope wins. */
export function runWithAction<T>(action: string, work: () => Promise<T>): Promise<T> {
  return scope.run({ action }, work);
}

/** The action of the current boundary execution, if any. */
export function currentAction(): string | undefined {
  return scope.getStore()?.action;
}
