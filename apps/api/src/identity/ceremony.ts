/**
 * CBD-190 ceremony orchestration: begin (§4.1), callback (§4.2-4.3), bounded
 * exchange (§10.1), atomic mapping (§5), hand-off to CBD-191 issuance (§6),
 * deterministic safe outcomes (§7), logout and the identity view.
 *
 * Every browser-visible answer is one of two things: a navigation to the
 * committed success destination (with the session cookie only on the first
 * delivery) or a navigation to the application-owned result page carrying a
 * closed public outcome. Nothing here discloses whether an account or
 * binding exists, and nothing here ever holds a provider token: the exchange
 * releases only `VerifiedIdentityResultV1` fields after issuer revocation.
 *
 * Restricted security evidence is emitted through `IdentityEvidenceSink` as
 * content-free classes correlated by `challenge_id`; ordinary telemetry goes
 * through the reliability sink with coarse operation/outcome only.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import { buildSessionCookieDeletionHeader, buildSessionCookieHeader, consumeAndIssue, createSessionStore, IssuanceRejectedError, logout as revokeSession, resolveSession, UnsupportedUnderV03Error } from "@cobudget/sessions";
import type { EnvelopeKeyProvider, SealedSessionDelivery, SessionConfig, SessionIssueCommandV1, SessionStore } from "@cobudget/sessions";
import { CEREMONIES, ChallengeStore, ChallengeStoreFullError, oneWayDigest } from "./challenge.ts";
import type { Ceremony, ChallengeRecord } from "./challenge.ts";
import { callbackContextMatches } from "./callback-context.ts";
import type { LocalIdentityConfig } from "./config.ts";
import { extractStateForTermination, parseCallbackEnvelope } from "./envelope.ts";
import { runBoundedExchange } from "./exchange.ts";
import type { ExchangeOutcome } from "./exchange.ts";
import type { ProviderTransport } from "./local-issuer.ts";
import { newIdentityEventId, resolveMapping } from "./mapping.ts";
import type { MappingHooks, VerifiedIdentityResultV1 } from "./mapping.ts";
import { outcomeForProviderError } from "./outcomes.ts";
import type { PublicOutcome } from "./outcomes.ts";
import { findBindingBySubject, findCallback, findHandoff, findHandoffByChallenge, findSubject, incrementHandoffAttempt, listProfiles, markCallbackCommitted, markCallbackTerminal, markHandoffConsumed, markHandoffTerminalFailed } from "./store.ts";
import type { HandoffRow } from "./store.ts";
import type { ReliabilitySink } from "../telemetry.ts";

const STILL_PROCESSING_WAIT_MS = 5_000;

export type IdentityEvidenceClass =
  | "callback_malformed"
  | "callback_unknown_state"
  | "callback_wrong_context"
  | "challenge_expired"
  | "challenge_replayed"
  | "provider_error"
  | "exchange_rejected"
  | "mapping_integrity"
  | "mapping_failure"
  | "handoff_consumed"
  | "handoff_terminal_failed"
  | "session_unavailable"
  | "account_unavailable"
  | "logout";

export interface IdentityEvidence {
  readonly class: IdentityEvidenceClass;
  readonly challengeId: string | undefined;
  readonly outcome: PublicOutcome | "success" | undefined;
  readonly fidelity: "simulated";
  readonly detail: string | undefined;
}

export type IdentityEvidenceSink = (evidence: IdentityEvidence) => void;

export interface CeremonyDependencies {
  readonly config: LocalIdentityConfig;
  readonly client: DataAccessClient;
  readonly sessionStore: SessionStore;
  readonly sessionConfig: SessionConfig;
  readonly sealing: EnvelopeKeyProvider;
  readonly transport: ProviderTransport;
  readonly challenges: ChallengeStore;
  readonly now: () => Date;
  readonly evidence: IdentityEvidenceSink;
  readonly reliability: ReliabilitySink;
  readonly serviceVersion: string;
  readonly mappingHooks?: MappingHooks | undefined;
  /** A8: timer scheduler for the CSRF bootstrap sweep; `null` disables the timer (clock-driven tests), default `setTimeout` unref'd. */
  readonly scheduler?: ((run: () => void, delayMs: number) => ReturnType<typeof setTimeout>) | null | undefined;
}

export type BeginRejection = "origin_rejected" | "ceremony_invalid" | "destination_invalid" | "session_required" | "capacity";
export type BeginResult = { readonly ok: true; readonly navigateTo: string; readonly challengeId: string } | { readonly ok: false; readonly reason: BeginRejection };

export interface CallbackContext {
  readonly rawQuery: string | undefined;
  readonly method: string;
  readonly observedOrigin: string;
  readonly path: string;
  readonly receiptTime: Date;
}

export type CompletionResult =
  | { readonly kind: "success"; readonly navigateTo: string; readonly setCookie: readonly string[]; readonly challengeId: string; readonly accountSubjectId: string; readonly sessionRef: string; readonly firstDelivery: boolean }
  | { readonly kind: "outcome"; readonly outcome: PublicOutcome; readonly navigateTo: string; readonly challengeId: string | undefined };

export interface IdentityView {
  readonly accountSubjectId: string;
  readonly profileId: string;
  readonly identityBindingId: string;
  readonly sessionRef: string;
  /** CBD-191 section 5.1: the per-session version the web may hold as a non-authoritative reconnect hint. */
  readonly sessionVersion: number;
  readonly environmentId: string;
  readonly assurance: "session" | "fresh";
  /**
   * PROTO-IDENTITY-API-001 correction C9 (Manager ruling): CBD-191 §5.1
   * requires the raw CSRF value to reach the browser only through a
   * same-origin bootstrap response, held in browser memory -- never a
   * cookie. `GET /v1/identity/me` is that bootstrap response. The raw
   * value exists only in this process's memory from the moment of
   * issuance (the session row persists only its peppered digest), so a
   * process restart or a session established before this process started
   * makes it unavailable here; `undefined` in that case (prototype
   * limitation, same custody class as the challenge and rate-limit
   * counter stores).
   *
   * Correction round 3 RC-06 (packet residual, P3) first made delivery
   * one-time. PROTO-ACTIVATION-001 reverted that to the finding's other
   * option, bounded retention: the browser holds the value only in memory
   * (§5.1 forbids a cookie or durable client value), so every page reload
   * or new tab performs the bootstrap read again and must receive the
   * value or it can never mutate again -- which is exactly what the
   * browser walkthrough showed. The value is therefore returned on every
   * bootstrap read of a live session and bounded by the session's own
   * absolute expiry (entries past it are erased on read), and it is erased
   * at logout. `undefined` means "unknown to this process" (a session
   * issued before this process started) or "expired".
   */
  readonly csrfValue: string | undefined;
}

interface CsrfBootstrapEntry {
  readonly value: string;
  readonly expiresAt: Date;
}

export class IdentityCeremony {
  readonly #d: CeremonyDependencies;
  readonly #inflight: Record<string, Promise<CompletionResult> | undefined> = Object.create(null);
  /** RC-06: in-process only, keyed by `sessionRef`; never persisted, never a cookie. Populated at issuance, returned on each bootstrap read, cleared at logout, expired at the session's own absolute expiry. */
  readonly #csrfValues: Record<string, CsrfBootstrapEntry | undefined> = Object.create(null);
  /** A7: the ceremony each subject's current session was issued by (in-process, like the CSRF values). */
  readonly #ceremonyBySubject: Record<string, { readonly challengeId: string; readonly sessionRef: string } | undefined> = Object.create(null);
  /** PROTO-ACTIVATION-001 A8 (SEC-ACT-F04): lifecycle-owned cleanup of the raw values, independent of bootstrap traffic. */
  #csrfTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(dependencies: CeremonyDependencies) {
    this.#d = dependencies;
  }

  get config(): LocalIdentityConfig { return this.#d.config; }

  /** Number of raw CSRF bootstrap values currently held in process memory (evidence only). */
  get retainedCsrfValues(): number { return Object.keys(this.#csrfValues).length; }

  /**
   * A8: erases every raw CSRF value whose session passed its absolute expiry, whether or not any
   * bootstrap read ever happened, and re-arms an unref'd timer for the earliest remaining expiry so
   * the next erasure is owned by the deadline itself. Called at issuance, from the timer, and on demand.
   */
  sweepCsrfBootstrap(now: Date = this.#d.now()): void {
    if (this.#csrfTimer) { clearTimeout(this.#csrfTimer); this.#csrfTimer = undefined; }
    let earliest: number | undefined;
    for (const sessionRef of Object.keys(this.#csrfValues)) {
      const entry = this.#csrfValues[sessionRef];
      if (!entry) continue;
      if (entry.expiresAt.getTime() <= now.getTime()) { delete this.#csrfValues[sessionRef]; continue; }
      if (earliest === undefined || entry.expiresAt.getTime() < earliest) earliest = entry.expiresAt.getTime();
    }
    if (earliest !== undefined && this.#d.scheduler !== null) {
      const schedule = this.#d.scheduler ?? ((run, delayMs) => { const timer = setTimeout(run, delayMs); timer.unref?.(); return timer; });
      this.#csrfTimer = schedule(() => { this.#csrfTimer = undefined; this.sweepCsrfBootstrap(this.#d.now()); }, Math.max(1, earliest - now.getTime()));
    }
  }

  /** A8: a session revoked by any path (logout, account switch, security action) loses its raw value at once. */
  forgetSession(sessionRef: string): void {
    delete this.#csrfValues[sessionRef];
    for (const subject of Object.keys(this.#ceremonyBySubject)) if (this.#ceremonyBySubject[subject]?.sessionRef === sessionRef) delete this.#ceremonyBySubject[subject];
  }

  /**
   * PROTO-ACTIVATION-001 A7 (review R04): the server-issued ceremony id behind a callback/authorize `state`
   * (a known, still-classifiable challenge only) so the rate-limit hook counts the ceremony's own bucket.
   */
  ceremonyIdForState(state: string | undefined): string | undefined {
    if (typeof state !== "string" || !state) return undefined;
    return this.#d.challenges.find(state)?.challengeId;
  }

  /** A7: the ceremony that signed the subject's current session in (this process), for the initial space.create reservation. */
  ceremonyIdForSubject(accountSubjectId: string): string | undefined {
    return this.#ceremonyBySubject[accountSubjectId]?.challengeId;
  }

  /** Releases the deadline timers (process shutdown); nothing else is affected. */
  stop(): void {
    if (this.#csrfTimer) clearTimeout(this.#csrfTimer);
    this.#csrfTimer = undefined;
    this.#d.challenges.stop();
  }

  #resultNavigation(outcome: PublicOutcome): string {
    return `${this.#d.config.applicationOrigin}${this.#d.config.resultPath}?outcome=${outcome}`;
  }

  #successNavigation(destinationId: string): string {
    const path = this.#d.config.postResultDestinations[destinationId] ?? "/";
    return `${this.#d.config.applicationOrigin}${path}`;
  }

  #evidence(cls: IdentityEvidenceClass, challengeId: string | undefined, outcome?: PublicOutcome | "success", detail?: string): void {
    this.#d.evidence({ class: cls, challengeId, outcome, fidelity: "simulated", detail });
  }

  #reliability(outcome: "ok" | "error"): void {
    this.#d.reliability({ service: "api", version: this.#d.serviceVersion, operation: "request", outcome, ...(outcome === "error" ? { errorClass: "unavailable" as const } : {}) });
  }

  /** Keyed replay digest (§5.1): HMAC over the callback's replay material with the server-side session pepper; the raw code and state are never stored. */
  #replayDigest(state: string, code: string): string {
    return createHmac("sha256", this.#d.sessionConfig.pepper).update(`${state}\u0000${code}`, "utf8").digest("base64url");
  }

  /** §4.1 begin. Server selects the environment; the browser supplies only intent and an opaque destination key. */
  async begin(input: { readonly ceremony: unknown; readonly postResultDestinationId: unknown; readonly origin: string | undefined; readonly secFetchSite: string | undefined; readonly sessionCookie: string | undefined }): Promise<BeginResult> {
    const config = this.#d.config;
    if (input.origin !== config.applicationOrigin || input.secFetchSite === "cross-site") return { ok: false, reason: "origin_rejected" };
    if (typeof input.ceremony !== "string" || !CEREMONIES.includes(input.ceremony as Ceremony)) return { ok: false, reason: "ceremony_invalid" };
    const destination = typeof input.postResultDestinationId === "string" ? input.postResultDestinationId : "home";
    if (!Object.hasOwn(config.postResultDestinations, destination)) return { ok: false, reason: "destination_invalid" };
    let currentAccountSubjectId: string | undefined;
    let currentSessionRef: string | undefined;
    if (input.ceremony === "account_switch") {
      const resolved = await resolveSession(input.sessionCookie, this.#d.sessionStore, this.#d.sessionConfig, config.environmentId, this.#d.now());
      if (resolved.status !== "resolved") return { ok: false, reason: "session_required" };
      currentAccountSubjectId = resolved.accountSubjectId;
      currentSessionRef = resolved.sessionRef;
    }
    let issued;
    try {
      issued = this.#d.challenges.issue({
        environmentId: config.environmentId, ceremony: input.ceremony as Ceremony, initiatingOrigin: config.applicationOrigin, callbackUri: config.callbackUri,
        postResultDestinationId: destination, lifetimeSeconds: config.challengeLifetimeSeconds, currentAccountSubjectId, currentSessionRef,
      });
    } catch (error) {
      if (error instanceof ChallengeStoreFullError) return { ok: false, reason: "capacity" };
      throw error;
    }
    const target = new URL(config.authorizationEndpoint);
    target.searchParams.set("client_id", config.clientId);
    target.searchParams.set("redirect_uri", config.callbackUri);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("scope", config.scopes.join(" "));
    target.searchParams.set("code_challenge", issued.codeChallenge);
    target.searchParams.set("code_challenge_method", "S256");
    target.searchParams.set("state", issued.state);
    target.searchParams.set("nonce", issued.nonce);
    return { ok: true, navigateTo: target.toString(), challengeId: issued.record.challengeId };
  }

  /** §4.2-§7 callback. Duplicate deliveries of one challenge join the in-flight completion for a bounded interval, then observe the stored result. */
  async complete(context: CallbackContext): Promise<CompletionResult> {
    const envelope = parseCallbackEnvelope(context.rawQuery);
    if (envelope.kind === "malformed") {
      // C5 (§7): a malformed envelope naming a known, still-pending state terminates that challenge
      // here -- it never becomes usable for a later, well-formed replay -- without ever accepting
      // the malformed envelope itself (the outcome below is unconditionally the safe one).
      const candidateState = extractStateForTermination(context.rawQuery);
      const known = candidateState ? this.#d.challenges.find(candidateState) : undefined;
      if (known && known.status === "pending") this.#d.challenges.terminate(known.challengeId);
      this.#evidence("callback_malformed", known?.challengeId, "invalid_or_expired");
      return { kind: "outcome", outcome: "invalid_or_expired", navigateTo: this.#resultNavigation("invalid_or_expired"), challengeId: known?.challengeId };
    }
    const known = this.#d.challenges.find(envelope.state);
    if (!known) {
      // Unknown input: no state change (§7).
      this.#evidence("callback_unknown_state", undefined, "invalid_or_expired");
      return { kind: "outcome", outcome: "invalid_or_expired", navigateTo: this.#resultNavigation("invalid_or_expired"), challengeId: undefined };
    }
    // PROTO-HARDENING-001 (GUARD-STAGES-F03): the one implementation, shared
    // with the rate-limit gate's prediction in sessions/runtime.ts.
    const contextValid = callbackContextMatches(context, known, this.#d.config.environmentId);
    if (!contextValid) {
      // Wrong environment, origin, callback URI or method: the known challenge terminates and restricted evidence is raised (§7).
      this.#d.challenges.terminate(known.challengeId);
      this.#evidence("callback_wrong_context", known.challengeId, "invalid_or_expired");
      return { kind: "outcome", outcome: "invalid_or_expired", navigateTo: this.#resultNavigation("invalid_or_expired"), challengeId: known.challengeId };
    }
    if (known.status !== "pending") {
      const inflight = this.#inflight[known.challengeId];
      if (inflight) {
        const settled = await Promise.race([inflight, new Promise<undefined>((resolve) => { setTimeout(() => resolve(undefined), STILL_PROCESSING_WAIT_MS).unref(); })]);
        if (settled) return this.#replayOf(settled, known);
      }
      return this.#storedResult(known);
    }
    const taken = this.#d.challenges.take(envelope.state, context.receiptTime);
    if (!taken) {
      this.#evidence("challenge_expired", known.challengeId, "invalid_or_expired");
      return { kind: "outcome", outcome: "invalid_or_expired", navigateTo: this.#resultNavigation("invalid_or_expired"), challengeId: known.challengeId };
    }
    const run = async (): Promise<CompletionResult> => {
      if (envelope.kind === "provider_error") {
        taken.codeVerifier.fill(0);
        const outcome = outcomeForProviderError(envelope.error);
        this.#d.challenges.terminate(known.challengeId);
        this.#evidence("provider_error", known.challengeId, outcome);
        return { kind: "outcome", outcome, navigateTo: this.#resultNavigation(outcome), challengeId: known.challengeId };
      }
      return this.#completeSuccess(taken.record, taken.codeVerifier, envelope.code, envelope.state, context.receiptTime);
    };
    // Registered before the work starts (a microtask later) so a concurrent duplicate always finds the in-flight completion.
    const work = Promise.resolve().then(run).finally(() => { delete this.#inflight[known.challengeId]; });
    this.#inflight[known.challengeId] = work;
    return work;
  }

  /** A duplicate that joined the in-flight completion sees the committed safe destination and never a second cookie (§7 "duplicate callback after committed success"). */
  #replayOf(settled: CompletionResult, challenge: ChallengeRecord): CompletionResult {
    if (settled.kind === "success") {
      return { kind: "success", navigateTo: settled.navigateTo, setCookie: [], challengeId: challenge.challengeId, accountSubjectId: settled.accountSubjectId, sessionRef: settled.sessionRef, firstDelivery: false };
    }
    return settled;
  }

  /** Retry after the in-flight completion settled or the process moved on: the durable callback row decides. */
  async #storedResult(challenge: ChallengeRecord): Promise<CompletionResult> {
    const callback = await findCallback(this.#d.client, challenge.challengeId);
    if (!callback) {
      const outcome: PublicOutcome = challenge.status === "consumed" ? "still_processing" : "invalid_or_expired";
      this.#evidence("challenge_replayed", challenge.challengeId, outcome);
      return { kind: "outcome", outcome, navigateTo: this.#resultNavigation(outcome), challengeId: challenge.challengeId };
    }
    if (callback.processingState === "terminal") {
      const outcome = callback.terminalOutcome ?? "callback_failure";
      return { kind: "outcome", outcome, navigateTo: this.#resultNavigation(outcome), challengeId: challenge.challengeId };
    }
    const handoff = await findHandoffByChallenge(this.#d.client, challenge.challengeId);
    if (!handoff) return { kind: "outcome", outcome: "callback_failure", navigateTo: this.#resultNavigation("callback_failure"), challengeId: challenge.challengeId };
    if (handoff.state === "consumed" && callback.commitAt) {
      this.#evidence("challenge_replayed", challenge.challengeId, "success");
      return { kind: "success", navigateTo: this.#successNavigation(challenge.postResultDestinationId), setCookie: [], challengeId: challenge.challengeId, accountSubjectId: handoff.accountSubjectId, sessionRef: handoff.issuedSessionReference ?? "", firstDelivery: false };
    }
    if (handoff.state === "terminal_failed") return { kind: "outcome", outcome: "callback_failure", navigateTo: this.#resultNavigation("callback_failure"), challengeId: challenge.challengeId };
    // handoff still prepared (or consumed but not finalized): an authorized bounded retry may consume the same unexpired hand-off (§6).
    return this.#issueAndFinalize(challenge, handoff, true);
  }

  async #completeSuccess(challenge: ChallengeRecord, codeVerifier: Buffer, code: string, state: string, receiptTime: Date): Promise<CompletionResult> {
    const config = this.#d.config;
    const exchange: ExchangeOutcome = await runBoundedExchange({
      transport: this.#d.transport, code, codeVerifier, redirectUri: config.callbackUri, clientId: config.clientId, issuer: config.issuer,
      allowedAlgorithms: config.allowedAlgorithms, nonceDigest: challenge.nonceDigest, digest: oneWayDigest, receiptTime, challengeIssuedAt: challenge.createdAt,
      clockSkewSeconds: config.clockSkewSeconds, maxLifetimeMs: config.exchangeLifetimeMs,
    });
    if (exchange.status === "rejected") {
      const outcome: PublicOutcome = exchange.rejection === "provider_unavailable" || exchange.rejection === "exchange_timeout" || exchange.rejection === "revocation_failed" || exchange.rejection === "revocation_uncertain" || exchange.rejection === "revocation_missing_token"
        ? "temporarily_unavailable" : "invalid_or_expired";
      this.#d.challenges.terminate(challenge.challengeId);
      this.#evidence("exchange_rejected", challenge.challengeId, outcome, exchange.rejection);
      this.#reliability(outcome === "temporarily_unavailable" ? "error" : "ok");
      return { kind: "outcome", outcome, navigateTo: this.#resultNavigation(outcome), challengeId: challenge.challengeId };
    }
    const result: VerifiedIdentityResultV1 = {
      contractVersion: 1, environmentId: challenge.environmentId, issuer: exchange.claims.issuer, providerSubject: exchange.claims.providerSubject,
      ceremony: challenge.ceremony, providerEventTime: exchange.claims.authTime, assurance: "session", challengeId: challenge.challengeId, identityEventId: newIdentityEventId(),
      previousAccountSubjectId: challenge.currentAccountSubjectId, previousSessionRef: challenge.currentSessionRef,
    };
    let mapping;
    try {
      mapping = await resolveMapping(this.#d.client, {
        result, replayDigest: this.#replayDigest(state, code), receiptAt: receiptTime, callbackExpiresAt: challenge.expiresAt,
        handoffLifetimeSeconds: config.handoffLifetimeSeconds, maxAttempts: config.mappingMaxAttempts, now: this.#d.now, hooks: this.#d.mappingHooks,
      });
    } catch {
      this.#evidence("mapping_failure", challenge.challengeId, "temporarily_unavailable");
      this.#reliability("error");
      return { kind: "outcome", outcome: "temporarily_unavailable", navigateTo: this.#resultNavigation("temporarily_unavailable"), challengeId: challenge.challengeId };
    }
    if (mapping.status === "still_processing") {
      return { kind: "outcome", outcome: "still_processing", navigateTo: this.#resultNavigation("still_processing"), challengeId: challenge.challengeId };
    }
    if (mapping.status === "terminal") {
      this.#evidence(mapping.outcome === "account_unavailable" ? "account_unavailable" : "mapping_integrity", challenge.challengeId, mapping.outcome);
      return { kind: "outcome", outcome: mapping.outcome, navigateTo: this.#resultNavigation(mapping.outcome), challengeId: challenge.challengeId };
    }
    return this.#issueAndFinalize(challenge, mapping.handoff);
  }

  /**
   * §6: consume the prepared hand-off through CBD-191 issuance and finalize
   * the callback/hand-off rows, all in one database transaction.
   *
   * PROTO-IDENTITY-API-001 correction C1 (review R01): the root
   * `this.#d.sessionStore` talks to the un-scoped client, so a prior
   * revision's separate issuance call and separate finalize transaction
   * left a real gap between "session minted" and "hand-off marked
   * consumed" -- a crash there stranded an active session with an
   * unconsumed hand-off, and a retry could mint a second session for the
   * same hand-off. `createSessionStore(scoped)` binds a session store to
   * the *same* scoped transaction client `markHandoffConsumed`/
   * `markCallbackCommitted` use, so issuance, rotation, hand-off
   * consumption and callback commit now commit or roll back together
   * (CBD-190 §6, CBD-191 SC-191-003A).
   *
   * Correction C8 (security S05): a same-subject reauthentication ends the
   * prior browser row through the *same* scoped store inside this one
   * transaction instead of a best-effort call after the fact, so a
   * revocation failure aborts the whole issuance rather than delivering
   * success while two rows stay active.
   */
  async #issueAndFinalize(challenge: ChallengeRecord, handoff: HandoffRow, retry = false): Promise<CompletionResult> {
    const now = this.#d.now();
    const switching = handoff.ceremony === "account_switch" && handoff.previousSessionId !== undefined && challenge.currentAccountSubjectId !== undefined && challenge.currentAccountSubjectId !== handoff.accountSubjectId;
    const sameSubjectPriorSession = handoff.ceremony === "account_switch" && !switching ? handoff.previousSessionId : undefined;
    const command: SessionIssueCommandV1 = {
      contractVersion: 1, sessionHandoffId: handoff.sessionHandoffId, accountSubjectId: handoff.accountSubjectId, environmentId: this.#d.config.environmentId,
      identityBindingId: handoff.identityBindingId, rotationCause: switching ? "account_switch" : "authentication",
      previousSessionId: switching ? handoff.previousSessionId : undefined, boundCurrentSessionRef: undefined, preparedRevocationEpoch: undefined,
      freshAssurance: undefined, deliverUntil: handoff.expiresAt,
    };
    // Attempt metadata (§5.1): the prepared row starts at attempt 1; only a bounded retry of the same hand-off increments it.
    if (retry && handoff.state === "prepared") await incrementHandoffAttempt(this.#d.client, handoff, now).catch(() => undefined);
    let delivery: SealedSessionDelivery;
    try {
      delivery = await this.#d.client.transaction({ isolation: "serializable" }, async (scoped) => {
        const scopedStore = createSessionStore(scoped);
        const issued = await consumeAndIssue(command, scopedStore, this.#d.sessionConfig, this.#d.sealing, now);
        if (sameSubjectPriorSession) {
          // C8: required, not best-effort -- a throw here rolls back the fresh issuance too, so success is never delivered with two active browser rows.
          await revokeSession(scopedStore, this.#d.sessionConfig, sameSubjectPriorSession, this.#d.config.environmentId);
          this.forgetSession(sameSubjectPriorSession);
        }
        await markHandoffConsumed(scoped, handoff.sessionHandoffId, issued.sessionRef, now);
        await markCallbackCommitted(scoped, challenge.challengeId, now);
        return issued;
      });
    } catch (error) {
      if (error instanceof IssuanceRejectedError || error instanceof UnsupportedUnderV03Error) {
        // Deterministic rejection (stale epoch, subject not active, expired hand-off): terminal_failed, callback_failure; subject, profile and binding remain (§6).
        await this.#d.client.transaction({ isolation: "serializable" }, async (scoped) => {
          await markHandoffTerminalFailed(scoped, handoff.sessionHandoffId, now);
          await markCallbackTerminal(scoped, challenge.challengeId, "callback_failure", now);
        }).catch(() => undefined);
        this.#evidence("handoff_terminal_failed", challenge.challengeId, "callback_failure");
        return { kind: "outcome", outcome: "callback_failure", navigateTo: this.#resultNavigation("callback_failure"), challengeId: challenge.challengeId };
      }
      // SessionStoreUnavailableError, a prior-row revocation failure (C8) or any other transactional
      // fault: nothing committed, so the prepared hand-off stays retryable until consumed or terminal (§6).
      this.#evidence("session_unavailable", challenge.challengeId, "still_processing");
      this.#reliability("error");
      return { kind: "outcome", outcome: "still_processing", navigateTo: this.#resultNavigation("still_processing"), challengeId: challenge.challengeId };
    }
    // Best-effort acknowledgement of the now-committed delivery result: a failure here only means a
    // replay could still recover the byte-identical delivery (§5.3), never a second session.
    await this.#d.sessionStore.acknowledgeDeliveryResult(handoff.sessionHandoffId).catch(() => undefined);
    // C9 (Manager ruling) / RC-06: the raw CSRF value is never a cookie. It lives only in this
    // process's memory, keyed by sessionRef, delivered through the GET /v1/identity/me bootstrap
    // response (CBD-191 §5.1), and bounded by the session's own absolute expiry.
    this.#csrfValues[delivery.sessionRef] = { value: delivery.csrfValue, expiresAt: delivery.absoluteExpiresAt };
    this.#ceremonyBySubject[handoff.accountSubjectId] = { challengeId: challenge.challengeId, sessionRef: delivery.sessionRef };
    this.sweepCsrfBootstrap(now);
    this.#evidence("handoff_consumed", challenge.challengeId, "success");
    this.#reliability("ok");
    const setCookie = [buildSessionCookieHeader(delivery.cookieValue, delivery.absoluteExpiresAt, now)];
    return { kind: "success", navigateTo: this.#successNavigation(challenge.postResultDestinationId), setCookie, challengeId: challenge.challengeId, accountSubjectId: handoff.accountSubjectId, sessionRef: delivery.sessionRef, firstDelivery: true };
  }

  /**
   * GET /v1/identity/me: the resolved subject's identifiers for the web; no contact attribute, no
   * provider value. RC-06: `csrfValue` is the bounded in-process bootstrap value.
   */
  async view(cookieValue: string | undefined): Promise<IdentityView | undefined> {
    const resolved = await resolveSession(cookieValue, this.#d.sessionStore, this.#d.sessionConfig, this.#d.config.environmentId, this.#d.now());
    if (resolved.status !== "resolved") return undefined;
    return this.viewResolved(this.#d.client, { accountSubjectId: resolved.accountSubjectId, sessionRef: resolved.sessionRef, sessionVersion: resolved.sessionVersion, assurance: resolved.assurance.level });
  }

  /**
   * PROTO-ACTIVATION-001: the `me` route runs inside the authorization boundary, whose fact assembly
   * already resolved the session (and slid its idle expiry). The handler therefore reads the
   * subject, binding and profile rows through the boundary's transaction client for the subject the
   * policy authorized, without resolving the cookie a second time.
   */
  async viewResolved(client: DataAccessClient, session: { readonly accountSubjectId: string; readonly sessionRef: string; readonly sessionVersion: number; readonly assurance: "session" | "fresh" }): Promise<IdentityView | undefined> {
    const subject = await findSubject(client, session.accountSubjectId);
    if (!subject || subject.lifecycleState !== "active") return undefined;
    const binding = await findBindingBySubject(client, this.#d.config.environmentId, subject.accountSubjectId);
    const profile = (await listProfiles(client, subject.accountSubjectId)).find((candidate) => candidate.profileState === "active");
    if (!binding || !profile) return undefined;
    return { accountSubjectId: subject.accountSubjectId, profileId: profile.profileId, identityBindingId: binding.identityBindingId, sessionRef: session.sessionRef, sessionVersion: session.sessionVersion, environmentId: this.#d.config.environmentId, assurance: session.assurance, csrfValue: this.#consumeCsrfBootstrap(session.sessionRef) };
  }

  /** RC-06 (bounded retention): the raw value for a live session, erased once its own absolute expiry passes. */
  #consumeCsrfBootstrap(sessionRef: string): string | undefined {
    const entry = this.#csrfValues[sessionRef];
    if (!entry) return undefined;
    if (entry.expiresAt.getTime() <= this.#d.now().getTime()) { delete this.#csrfValues[sessionRef]; return undefined; }
    return entry.value;
  }

  /** POST /v1/identity/logout: CBD-191 §6.1 `logout` plus cookie deletion; the CSRF check is the caller's (`checkCsrf`) with the digest returned here. */
  async csrfDigestFor(cookieValue: string | undefined): Promise<{ readonly sessionRef: string; readonly csrfDigest: string } | undefined> {
    const resolved = await resolveSession(cookieValue, this.#d.sessionStore, this.#d.sessionConfig, this.#d.config.environmentId, this.#d.now());
    if (resolved.status !== "resolved") return undefined;
    const record = await this.#d.sessionStore.findBySessionRef(resolved.sessionRef);
    if (!record) return undefined;
    return { sessionRef: resolved.sessionRef, csrfDigest: record.csrfDigest };
  }

  async logout(sessionRef: string): Promise<readonly string[]> {
    await revokeSession(this.#d.sessionStore, this.#d.sessionConfig, sessionRef, this.#d.config.environmentId);
    this.forgetSession(sessionRef);
    this.#evidence("logout", undefined, undefined);
    return [buildSessionCookieDeletionHeader()];
  }

  /** Test evidence helper: the hand-off row by id, without any cookie material. */
  async handoff(sessionHandoffId: string): Promise<HandoffRow | undefined> {
    return findHandoff(this.#d.client, sessionHandoffId);
  }
}

export function newCorrelationId(): string {
  return randomUUID();
}
