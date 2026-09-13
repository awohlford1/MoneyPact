/**
 * §6.2 "Local adapter emulation obligation" (`PROVIDERS-LOCAL-001`): a
 * deterministic, Cognito-shaped `ProviderSecurityEventV1` fixture source
 * covering every `event_class`, plus malformed/forged/replayed/stale/
 * cross-environment fixtures, and a controllable current-browser/global
 * provider-artifact double for `CT-191-012`. Every authenticity proof this
 * module emits is labeled `simulated` and cannot satisfy `OQ-191-002`'s
 * real-provider-only evidence.
 *
 * CBD191-CORRECTION-001 item 6 / CBD191-SECURITY-003 finding 2 (Refuted ->
 * fixed): "provider-event authenticity is not bound to the processor
 * input." An earlier revision relied on `AuthenticatedProviderEvent` having
 * a TypeScript `private` constructor to make it unforgeable. `private` is
 * erased by both `tsc` and the runtime type-stripping this repository uses
 * (`node --experimental-strip-types`/tsx) -- it is a compile-time-only
 * annotation, not a runtime guarantee, so `new AuthenticatedProviderEvent({
 * event: forgedEvent })` compiled/stripped and called from plain JS (or
 * past a `// @ts-expect-error`) constructed a fully usable instance at
 * runtime with no authenticity check at all. Security's reproduction did
 * exactly this and reached the epoch-bump path.
 *
 * The real fix is a runtime capability, not a compile-time one:
 * `#AUTHENTICATED` is a module-private `WeakSet`, never exported, that only
 * `AuthenticatedProviderEvent.authenticate` (below) ever adds to. `isAuthenticated`
 * is the one exported way to ask "did this specific instance come from a
 * successful `authenticate` call" -- membership in a `WeakSet` this module
 * never lets outside code touch cannot be forged by construction,
 * assertion, or property spoofing (`WeakSet.has` is an identity check, not
 * a shape/duck-type check). `processProviderEvent` (`provider-events.ts`)
 * calls `isAuthenticated` itself and throws `UnauthenticatedProviderEventError`
 * before touching the event's fields at all if it fails -- a raw
 * `{ event }` object, or an `AuthenticatedProviderEvent` constructed
 * directly rather than through `authenticate`, is refused identically.
 */
import { randomUUID } from "node:crypto";
import type { ProviderRevocationAdapter, ProviderOperationOutcome } from "./outbox-worker.ts";
import type { ProviderEventClass, ProviderSecurityEventV1, RevocationAction } from "./types.ts";

export const FIDELITY_LABEL = "simulated" as const;

const EVENT_CLASSES: readonly ProviderEventClass[] = [
  "credential_changed", // §6.2 closed event_class vocabulary
  "factor_changed", // §6.2 closed event_class vocabulary
  "account_disabled", // §6.2 closed event_class vocabulary
  "account_deleted", // §6.2 closed event_class vocabulary
  "global_sign_out", // §6.2 closed event_class vocabulary
  "compromised_credentials_action", // §6.2 closed event_class vocabulary
];

export interface LocalAdapterAuthenticity {
  readonly fidelity: typeof FIDELITY_LABEL;
  readonly signatureValid: boolean;
}

export interface LocalProviderEventFixture {
  readonly event: ProviderSecurityEventV1;
  readonly authenticity /* signature outcome */: LocalAdapterAuthenticity;
}

/**
 * Module-private: never exported. `has()` (via `isAuthenticated` below) is
 * the only way outside code can observe membership, and only `authenticate`
 * ever calls `.add()`. This is the actual runtime capability -- see the
 * module header for why the class's constructor being `private` in source
 * is not one.
 */
const AUTHENTICATED = new WeakSet<AuthenticatedProviderEvent>();

export class AuthenticatedProviderEvent {
  readonly event: ProviderSecurityEventV1;
  /** Public at runtime regardless of any compile-time modifier stripped
   * away by transpilation -- see the module header. Constructing one this
   * way never marks it authenticated; only `authenticate` does that. */
  constructor(event: ProviderSecurityEventV1) {
    this.event = event;
  }

  /** The adapter's own authenticity gate: a forged fixture, or one with an
   * incomplete/malformed envelope shape, is discarded here and never
   * forwarded. Only an instance returned from here is ever added to
   * `AUTHENTICATED`. */
  static authenticate(fixture: LocalProviderEventFixture): AuthenticatedProviderEvent | undefined {
    if (!fixture.authenticity.signatureValid) return undefined;
    if (!hasValidShape(fixture.event)) return undefined;
    const instance = new AuthenticatedProviderEvent(fixture.event);
    AUTHENTICATED.add(instance);
    return instance;
  }
}

/**
 * The one runtime check `processProviderEvent` trusts. `candidate` must be
 * an actual `AuthenticatedProviderEvent` instance *and* a member of the
 * module-private `AUTHENTICATED` set -- a directly-constructed instance
 * (`new AuthenticatedProviderEvent({ event: forged })`), a plain
 * `{ event }` object shaped to match, or any other forgery fails this,
 * because none of them were ever added to `AUTHENTICATED`.
 */
export function isAuthenticated(candidate: unknown): candidate is AuthenticatedProviderEvent {
  return candidate instanceof AuthenticatedProviderEvent && AUTHENTICATED.has(candidate);
}

export class UnauthenticatedProviderEventError extends Error {
  constructor() {
    super("provider event failed the runtime authenticity check; it was never produced by AuthenticatedProviderEvent.authenticate and is refused before any of its fields are read");
    this.name = "UnauthenticatedProviderEventError";
  }
}

/** A genuine (signature-valid) fixture for `eventClass`, at the given cursor if provided. */
export function genuineFixture(
  environmentId: string,
  issuer: string,
  providerSubject: string,
  eventClass: ProviderEventClass,
  options: { readonly orderingCursor?: string; readonly providerEventTime?: Date; readonly providerEventId?: string } = {},
): LocalProviderEventFixture {
  return {
    event: {
      contractVersion: 1,
      environmentId,
      issuer,
      providerSubject,
      eventClass,
      providerEventId: options.providerEventId ?? randomUUID(),
      providerEventTime: options.providerEventTime ?? new Date(),
      orderingCursor: options.orderingCursor,
      receivedAt: new Date(),
    },
    authenticity: { fidelity: FIDELITY_LABEL, signatureValid: true },
  };
}

/** A forged fixture: authenticity fails before the event ever reaches `processEvent` (§6.2 step 2, "caught by the adapter, never reaches this table"). */
export function forgedFixture(environmentId: string, issuer: string, providerSubject: string, eventClass: ProviderEventClass): LocalProviderEventFixture {
  const fixture = genuineFixture(environmentId, issuer, providerSubject, eventClass);
  return { event: fixture.event, authenticity: { fidelity: FIDELITY_LABEL, signatureValid: false } };
}

function hasValidShape(event: ProviderSecurityEventV1): boolean {
  return (
    event.contractVersion === 1
    && typeof event.environmentId === "string" && event.environmentId.length > 0
    && typeof event.issuer === "string" && event.issuer.length > 0
    && typeof event.providerSubject === "string" && event.providerSubject.length > 0
    && typeof event.providerEventId === "string" && event.providerEventId.length > 0
    && EVENT_CLASSES.includes(event.eventClass)
    && event.providerEventTime instanceof Date && !Number.isNaN(event.providerEventTime.getTime())
    && event.receivedAt instanceof Date && !Number.isNaN(event.receivedAt.getTime())
  );
}

/** Convenience wrapper around `AuthenticatedProviderEvent.authenticate`. */
export function authenticateLocalEvent(fixture: LocalProviderEventFixture): AuthenticatedProviderEvent | undefined {
  return AuthenticatedProviderEvent.authenticate(fixture);
}

export function allEventClasses(): readonly ProviderEventClass[] {
  return EVENT_CLASSES;
}

/** Controllable double for CT-191-012: separate current-browser and global operations, with outage/ambiguous injection. */
export class ControllableLocalProviderAdapter implements ProviderRevocationAdapter {
  #globalMode: "succeed" | "ambiguous" | "fail" = "succeed";
  #currentBrowserMode: "succeed" | "ambiguous" | "fail" = "succeed";
  #queryMode: "succeed" | "ambiguous" | "fail" = "ambiguous";
  readonly globalInvocations: RevocationAction[] = [];
  readonly currentBrowserInvocations: RevocationAction[] = [];
  readonly queryInvocations: RevocationAction[] = [];

  setGlobalMode(mode: "succeed" | "ambiguous" | "fail"): void {
    this.#globalMode = mode;
  }
  setCurrentBrowserMode(mode: "succeed" | "ambiguous" | "fail"): void {
    this.#currentBrowserMode = mode;
  }
  /** Controls what a subsequent `queryStatus` reconciliation discovers. */
  setQueryMode(mode: "succeed" | "ambiguous" | "fail"): void {
    this.#queryMode = mode;
  }

  async invalidateGlobal(action: RevocationAction): Promise<ProviderOperationOutcome> {
    this.globalInvocations.push(action);
    return this.#globalMode === "succeed" ? "succeeded" : this.#globalMode === "ambiguous" ? "ambiguous" : "failed";
  }

  async invalidateCurrentBrowserBound(action: RevocationAction): Promise<ProviderOperationOutcome> {
    this.currentBrowserInvocations.push(action);
    return this.#currentBrowserMode === "succeed" ? "succeeded" : this.#currentBrowserMode === "ambiguous" ? "ambiguous" : "failed";
  }

  async queryStatus(action: RevocationAction): Promise<ProviderOperationOutcome> {
    this.queryInvocations.push(action);
    return this.#queryMode === "succeed" ? "succeeded" : this.#queryMode === "ambiguous" ? "ambiguous" : "failed";
  }
}
