/**
 * CBD-191 §7 "Browser-held state" -- the client half (server half is
 * `packages/sessions`' `verifySessionStillLive`, outside this workspace).
 * Manager ruling `CBD191-CORRECTION-001` (amended): this half ships in the
 * same PR as the server corrections.
 *
 * IMPORTANT SCOPE NOTE the contract text can obscure: the session cookie
 * itself is `HttpOnly` (§5.1) by design -- client JavaScript cannot read or
 * delete it, on purpose, so a compromised page script cannot steal or forge
 * it. "Clears the session cookie" in §7 is therefore accomplished by the
 * *server's* `Set-Cookie` deletion response (`buildSessionCookieDeletionHeader`
 * in `@cobudget/sessions`, already implemented) reaching the browser on
 * logout/recovery/switch/access-loss -- not by this module reaching into
 * `document.cookie`. What THIS module owns is everything else §7 names that
 * client script genuinely can and must clear: cached identifiers, drafts
 * (including CBD-232 §8.2 draft state), previews, bindings, session-keyed
 * data, in-flight subscriptions, and queued client mutations -- and the
 * reconnect comparison that decides whether any of that is even safe to
 * keep.
 *
 * `apps/web` has no authenticated route surface yet (CBD-20's public
 * marketing pages only); this module is therefore a framework-free,
 * storage-abstracted unit deliverable, ready for a future authenticated
 * page/layout to call at the four named triggers and at bootstrap. It is
 * not wired into any page, because there is no page to wire it into yet --
 * inventing one would be a product decision this packet does not own.
 */

/** Minimal storage shape both `localStorage`/`sessionStorage` and a test
 * double satisfy. Kept this narrow (rather than the full `Storage`
 * interface) so a non-DOM test double needs no `length`/`key(index)`
 * indirection. */
export interface ClientStorage {
  keys(): readonly string[];
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Wraps a real `Storage` (localStorage/sessionStorage) to the narrower
 * `ClientStorage` shape. Not called from any test; exercised only by a
 * future page that runs in a real browser. */
export function fromWebStorage(storage: Storage): ClientStorage {
  return {
    keys: () => Object.keys(storage),
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  };
}

/**
 * Every prefix that constitutes "session-keyed client state" under §7:
 * cached identifiers, drafts (CBD-232 §8.2), previews, bindings, and the
 * session-context cache itself. A key not under one of these prefixes is
 * left alone -- this module only owns session-scoped state, not every key
 * in storage.
 */
export const SESSION_KEYED_PREFIXES = [
  "cobudget.session.",
  "cobudget.identifier.",
  "cobudget.draft.",
  "cobudget.preview.",
  "cobudget.binding.",
] as const;

/** Clears every stored key under a registered session-keyed prefix. Returns the count cleared, for tests and diagnostics. */
export function clearSessionKeyedState(storage: ClientStorage): number {
  let cleared = 0;
  for (const key of storage.keys()) {
    if (SESSION_KEYED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      storage.removeItem(key);
      cleared += 1;
    }
  }
  return cleared;
}

/** The four named triggers (§7) besides reconnect, which has its own function below. */
export type SessionEndingCause = "logout" | "recovery_completed" | "account_switch" | "access_loss";

export interface SessionEndHandlers {
  /** Cancels any live subscription (e.g. a websocket or polling loop) so no
   * further server push can render under the ending session. */
  stopSubscriptions(): void;
  /** Drops any client mutation queued but not yet sent -- it must never be
   * flushed under a different session than the one that queued it. */
  clearQueuedMutations(): void;
}

/**
 * §7: "clear the session cookie plus locally cached identifiers, drafts,
 * previews, bindings, and session-keyed data before rendering." Order
 * matters: subscriptions and queued mutations are stopped/dropped *before*
 * storage is cleared, so nothing mid-flight can read half-cleared state or
 * queue a fresh write against data this function is in the middle of
 * removing.
 */
export function handleSessionEnding(_cause: SessionEndingCause, storage: ClientStorage, handlers: SessionEndHandlers): number {
  handlers.stopSubscriptions();
  handlers.clearQueuedMutations();
  return clearSessionKeyedState(storage);
}

export interface ClientSessionContext {
  readonly sessionRef: string;
  readonly sessionVersion: number;
}

export interface ReconnectResolution {
  /** `true` if the client context was missing, denied, or did not match the
   * server's, and storage/subscriptions/queued mutations were therefore
   * cleared. The caller must not resume subscriptions or flush queued
   * mutations until it has awaited this and observed `cleared: false`. */
  readonly cleared: boolean;
  readonly serverContext: ClientSessionContext | undefined;
}

/**
 * §7 reconnect/bootstrap handshake: "first resolves the cookie and compares
 * the returned sessionRef/sessionVersion with the client context; missing,
 * denied, or changed context clears before subscriptions or queued client
 * mutations resume."
 *
 * `fetchServerContext` is the caller's own same-origin request to whatever
 * bootstrap/whoami endpoint resolves the (HttpOnly, unreadable-by-script)
 * cookie server-side and returns `{ sessionRef, sessionVersion }` or
 * `undefined` for a denied/expired/absent session -- this module has no
 * opinion on that endpoint's shape, only on what happens with its result.
 * A transport failure is treated identically to an explicit denial
 * (fail closed, never "assume unchanged and keep going").
 */
export async function reconcileOnReconnect(
  fetchServerContext: () => Promise<ClientSessionContext | undefined>,
  storedContext: ClientSessionContext | undefined,
  storage: ClientStorage,
  handlers: SessionEndHandlers,
): Promise<ReconnectResolution> {
  let serverContext: ClientSessionContext | undefined;
  try {
    serverContext = await fetchServerContext();
  } catch {
    serverContext = undefined;
  }

  const unchanged = Boolean(
    serverContext && storedContext && serverContext.sessionRef === storedContext.sessionRef && serverContext.sessionVersion === storedContext.sessionVersion,
  );

  if (unchanged) {
    return { cleared: false, serverContext };
  }

  handlers.stopSubscriptions();
  handlers.clearQueuedMutations();
  clearSessionKeyedState(storage);
  return { cleared: true, serverContext };
}
