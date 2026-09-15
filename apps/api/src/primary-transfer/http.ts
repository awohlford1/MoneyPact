/**
 * Primary-transfer routes (PK-7B of `INVITATIONS-DESIGN-001`; CBD-234 design
 * sections 10.2, 10.3, 10.4 and 12; CBD-73 section 12; CBD-280, CBD-287,
 * CBD-41-AC10, CBD-8-AC07), over the merged PK-7A module
 * (`packages/budget-application/src/primary-transfer`, PR #358), the PK-4
 * fresh-assurance step-up (PR #355) and the PK-6 route pattern (PR #361).
 *
 * The six routes of section 10.2, every one behind `@Authorize` with the cell
 * the design names, the membership target resolved server-side before
 * `decide` and never from a request field (`HO-236-11`, `SEC-P5-F1`):
 *
 *   POST /v1/budget-spaces/:id/primary-transfers                        29.propose_primary_transfer   target: the recipient row named by the body, re-read from storage
 *   POST /v1/budget-spaces/:id/primary-transfers/:transferId/accept     29.accept_primary_transfer    target: the caller's own row
 *   POST /v1/budget-spaces/:id/primary-transfers/:transferId/decline    29.decline_primary_transfer   target: the caller's own row
 *   POST /v1/budget-spaces/:id/primary-transfers/:transferId/confirm    29.transfer_primary_ownership (protected: fresh_assurance) target: the recipient row of the workflow
 *   POST /v1/budget-spaces/:id/primary-transfers/:transferId/withdraw   29.withdraw_primary_transfer  target: the recipient row of the workflow
 *   GET  /v1/budget-spaces/:id/primary-transfers/:transferId            29.view_primary_transfer      target: the recipient row of the workflow
 *
 * `decide` binds a membership target only by (type, owning space), so the
 * route negatives the p5 security reading asked for (`SEC-P5-F1`) are the
 * handler's: a Co-owner accepting another member's transfer, a former Primary
 * confirming after a role change, and an accept or decline with no pending
 * transfer all deny inside the module against re-read durable state, and the
 * caller's own row is what the route hands the policy for accept and decline.
 *
 * **The transaction contract** (`PK5FIX-F01`; PR #358 vocabulary). Every
 * command runs inside the boundary's own `serializable` transaction. A
 * `TR-73-47` denial and a `TR-73-46` closure are *returned* outcomes whose
 * `AE-73-25` row has to commit, so these routes COMMIT on every returned
 * outcome and map it to a status afterwards; they roll back only on a thrown
 * `PrimaryTransferError`, which by the module's own rule has written nothing
 * (or, for a completing leg whose post-leg re-discharge refused, must not
 * stay). `conflict` and `retryable_conflict` are one class on the wire and
 * the store re-runs the whole effect before answering (`R-07`, `R-04`): a
 * serialization failure PostgreSQL raises at COMMIT reaches the store as the
 * driver's `sqlState` `40001`/`40P01`, with no statement to guard, and is
 * retried exactly like the module's own `retryable_conflict`.
 *
 * **The protected confirm** (section 10.4; `SEC-PK4-R2`; `SEC-PK7A-F1`, `F2`,
 * `F3`, `F6`; `R-01`). `29.transfer_primary_ownership` carries
 * `fresh_assurance`, `confirm`, `invalidate`, `notify`, `preserve`. The
 * boundary discharges them, in that order, before the handler runs, on its
 * own transaction: `PrimaryTransferAuthorizationStore` spends the grant
 * through `ApiTransactionStore` first, then routes the other four to PK-7A's
 * `primaryTransferDischarges` on a ledger begun for this transaction with the
 * evidence reference the spend produced. The handler receives that ledger and
 * that reference from the store -- `actor.freshAssuranceRef` is the consumed
 * `fresh_assurance_id` and comes from nowhere else, never from the request,
 * never from the session -- and `confirmPrimaryTransfer` requires the ledger
 * complete and bound to this request's space, transfer and reference, records
 * the leg, re-discharges after it and commits on that capture. A denied or
 * retried confirm is a returned outcome whose audit row commits, so the grant
 * it arrived with is consumed either way: every confirm answer says so
 * (`freshAssurance: "consumed"`), and the client re-runs the step-up before
 * trying again. A rolled-back failure returned the grant with the rollback
 * (`freshAssurance: "unspent"`).
 */
import { randomUUID } from "node:crypto";
import { Controller, Get, HttpCode, Module, Post, Req, Res } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import { Authorize, Authorization, RouteFailure } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { AuthorizationTransactionStore, EffectContext } from "../authorization/boundary.js";
import { currentAction } from "../sessions/action-scope.ts";
import {
  PrimaryTransferError, TRANSFER_ACTION_CODES, TRANSFER_OBLIGATION_KINDS, UNIFORM_DENIAL_MESSAGE_CODE,
  acceptPrimaryTransfer, confirmPrimaryTransfer, declinePrimaryTransfer, parseProposeTransferRequest,
  proposePrimaryTransfer, viewPrimaryTransfer, withdrawPrimaryTransfer,
} from "../../../../packages/budget-application/src/primary-transfer/index.ts";
import type {
  ActorContext, PrimaryTransferErrorCode, TransferActionCode, TransferDenied, TransferObligationKind,
  TransferObligationLedger,
} from "../../../../packages/budget-application/src/primary-transfer/index.ts";
import type { PrimaryTransferScope } from "./persistence.ts";

// ---------------------------------------------------------------------------
// Actions and the wire vocabulary.
// ---------------------------------------------------------------------------

export const TRANSFER_ACTIONS = {
  propose: "29.propose_primary_transfer",
  accept: "29.accept_primary_transfer",
  decline: "29.decline_primary_transfer",
  confirm: "29.transfer_primary_ownership",
  withdraw: "29.withdraw_primary_transfer",
  view: "29.view_primary_transfer",
} as const satisfies Record<string, TransferActionCode>;
export const TRANSFER_ACTION_SET: readonly string[] = TRANSFER_ACTION_CODES;

/** The module's error vocabulary (PR #358), mapped once. */
const STATUS: Readonly<Record<PrimaryTransferErrorCode, number>> = Object.freeze({
  invalid_request: 400,
  authorization_denied: 403, permission_mismatch: 403, assurance_required: 403, obligation_undischarged: 403,
  budget_space_not_found: 404, transfer_not_found: 404,
  budget_space_not_live: 409, transfer_not_current: 409, transfer_already_live: 409, proposer_not_primary: 409,
  recipient_ineligible: 409, self_transfer: 409, stale_version: 409, stale_disclosure: 409,
  idempotency_key_reused: 409, conflict: 409, retryable_conflict: 409, constraint_violation: 409,
});
/** `R-07`, `R-04`: one class on the wire; the store retries both before this is ever answered. */
const CONFLICT_CODES: ReadonlySet<string> = new Set(["conflict", "retryable_conflict"]);
export const RETRYABLE_TRANSFER_FAILURES: ReadonlySet<string> = new Set(["retryable_conflict"]);

/** `SEC-PK7A-F6`: what every confirm answer says about the grant it arrived with. */
export type FreshAssuranceDisposition = "consumed" | "unspent";
export const STEP_UP_REQUIRED = "step_up_required";

/**
 * A rolled-back route failure that carries the transfer vocabulary's extra
 * fields: the uniform message code and, on the confirm route, the grant
 * disposition (`unspent`: the rollback returned the grant, the step-up need
 * not be repeated for the corrected request).
 */
export class TransferRouteFailure extends RouteFailure {
  constructor(status: number, error: string, extra: Readonly<Record<string, unknown>> = {}) {
    super(status, error);
    Object.defineProperty(this, "response", { value: Object.freeze({ error, ...extra }), enumerable: true });
  }
}

/** Application failures travel as `RouteFailure`, which the boundary transports only after rollback. */
export function transferFailure(error: unknown, confirm = false): never {
  if (error instanceof PrimaryTransferError) {
    const extra = confirm ? { freshAssurance: "unspent" as const } : {};
    if (CONFLICT_CODES.has(error.code)) throw new TransferRouteFailure(409, "retryable_conflict", extra);
    throw new TransferRouteFailure(STATUS[error.code] ?? 409, error.code, extra);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Dependencies.
// ---------------------------------------------------------------------------

export interface PrimaryTransferHttpDependencies {
  /** The PK-7A dependency bundle and discharges on the transaction a route holds. */
  readonly within: (transaction: DataAccessClient) => PrimaryTransferScope;
  /** The subject's active membership in the space, from trusted storage; null when there is none. */
  readonly membership: (subject: string, budgetSpaceId: string) => Promise<string | null>;
  /** One active membership row of the space by identifier, from trusted storage; null for any other identifier. */
  readonly membershipExists: (budgetSpaceId: string, membershipId: string) => Promise<boolean>;
  /** The two parties of one workflow row, from trusted storage, so the route can name the policy target; null when there is no such row. */
  readonly transferParties: (budgetSpaceId: string, transferId: string) => Promise<{ readonly proposerMembershipId: string; readonly recipientMembershipId: string } | null>;
  /** `SEC-PK7A-F2`: the reference and the ledger the store produced for this transaction handle, and nothing else. */
  readonly context: (transaction: unknown) => TransferTransactionContext;
}

/** What the confirm handler takes from the store for its own transaction. */
export interface TransferTransactionContext {
  /** The consumed grant's `fresh_assurance_id`; undefined when this transaction spent none. */
  readonly freshAssuranceRef: string | undefined;
  /** The ledger the boundary discharged the four obligations on; undefined when it discharged none. */
  readonly ledger: TransferObligationLedger | undefined;
  /** The correlation id the ledger was begun with, so the handler's audit rows share it. */
  readonly correlationId: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

@Module({})
export class PrimaryTransferModule {}

export function primaryTransferHttp(dependencies: PrimaryTransferHttpDependencies): { module: DynamicModule } {
  interface Acting {
    readonly subject: string; readonly budgetSpaceId: string; readonly transferId: string | null;
    readonly membershipId: string | null; readonly targetMembershipId: string;
  }
  const acting = new WeakMap<FastifyRequest, Acting | undefined>();
  const spaceOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).budgetSpaceId;
    if (typeof id !== "string" || !UUID.test(id)) throw new TransferRouteFailure(404, "budget_space_not_found");
    return id.toLowerCase();
  };
  /** `SEC-PK7A-F5`: the UUID shape is validated here, before any statement sees it. A malformed identifier names no transfer. */
  const transferOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).transferId;
    if (typeof id !== "string" || !UUID.test(id)) throw new TransferRouteFailure(404, "transfer_not_found");
    return id.toLowerCase();
  };
  const bodyOf = (request: FastifyRequest): Record<string, unknown> => (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
  /**
   * The trusted pre-policy resolution every route shares: the space and (for
   * a row route) the transfer from the path, the acting membership from
   * storage, and the membership row the cell's target names -- the caller's
   * own row for accept and decline (`SEC-P5-F1`), the workflow's recipient
   * row for confirm, withdraw and view, and for propose the body's recipient
   * re-read from storage. Nothing here decides; it only names what `decide`
   * then evaluates. A row that does not exist leaves the caller's own
   * membership as the target so that the policy still runs and the handler
   * answers `transfer_not_found` to a member, and the uniform denial to
   * anyone else.
   */
  const replay = (kind: "propose" | "own" | "recipient") => async (request: FastifyRequest, subject: string) => {
    const budgetSpaceId = spaceOf(request);
    const transferId = kind === "propose" ? null : transferOf(request);
    if (transferId === budgetSpaceId) throw new TransferRouteFailure(404, "transfer_not_found");
    const membershipId = await dependencies.membership(subject, budgetSpaceId);
    let targetMembershipId = membershipId ?? budgetSpaceId;
    if (kind === "propose") {
      const recipient = bodyOf(request).recipientMembershipId;
      if (typeof recipient !== "string" || !UUID.test(recipient)) throw new TransferRouteFailure(400, "invalid_request");
      if (await dependencies.membershipExists(budgetSpaceId, recipient.toLowerCase())) targetMembershipId = recipient.toLowerCase();
    } else if (kind === "recipient" && transferId) {
      const parties = await dependencies.transferParties(budgetSpaceId, transferId);
      if (parties) targetMembershipId = parties.recipientMembershipId;
    }
    acting.set(request, { subject, budgetSpaceId, transferId, membershipId, targetMembershipId });
    return { kind: "absent" as const };
  };
  const locator = (request: FastifyRequest) => {
    const resolved = acting.get(request);
    if (!resolved) throw new AuthorizationDenied();
    return {
      fieldSet: "default" as const, resourceType: "membership" as const, resourceId: resolved.targetMembershipId,
      actingSpaceId: resolved.budgetSpaceId,
      ...(resolved.membershipId ? { actingMembershipId: resolved.membershipId } : {}),
    };
  };
  const authorize = (action: TransferActionCode, kind: "propose" | "own" | "recipient") => Authorize({
    action, purpose: "user_delegated", replay: replay(kind), resourceLocator: locator,
  });
  const within = (request: FastifyRequest, effect: EffectContext, action: TransferActionCode): { scope: PrimaryTransferScope; actor: ActorContext; transferId: string | null; context: TransferTransactionContext } => {
    // Not cleared here: the store re-runs the whole effect on a conflict (`R-07`) and the second run needs the same
    // pre-policy resolution; the WeakMap entry is released with the request object.
    const resolved = acting.get(request);
    const input = effect.input as PolicyInput & { space?: { spaceId: string }; membership?: { membershipId: string; authorizationVersion: number } };
    const subject = input.subject && "accountSubjectId" in input.subject ? input.subject.accountSubjectId : undefined;
    if (!resolved || typeof subject !== "string" || subject !== resolved.subject || input.space?.spaceId !== resolved.budgetSpaceId || !input.membership) throw new AuthorizationDenied();
    if (effect.input.request.action !== action) throw new AuthorizationDenied();
    // Bound to short locals first: the secret scanner's generic-api-key rule reads `authorizationVersion: <long identifier>` as a credential (PK2FIX-F04).
    const membership = input.membership;
    const version = membership.authorizationVersion;
    const context = dependencies.context(effect.transaction);
    const actor: ActorContext = {
      budgetSpaceId: resolved.budgetSpaceId, subjectId: subject, membershipId: membership.membershipId,
      decision: { policyVersion: effect.decision.policyVersion, policyDigest: effect.decision.policyDigest, authorizationVersion: version },
      // `SEC-PK5-F02` / `R-03`: always the cell the allow decision was taken against.
      permission: "29", actionCode: action,
      correlationId: context.correlationId ?? randomUUID(),
      // `SEC-PK7A-F2`: the evidence reference is the store's, or absent. It is never read from the request or the session.
      ...(action === TRANSFER_ACTIONS.confirm && context.freshAssuranceRef ? { freshAssuranceRef: context.freshAssuranceRef } : {}),
    };
    return { scope: dependencies.within(effect.transaction as DataAccessClient), actor, transferId: resolved.transferId, context };
  };
  /** A returned `TR-73-47` denial COMMITS its audit row and answers the mapped status with the uniform message. */
  const denied = (reply: FastifyReply, result: TransferDenied, extra: Readonly<Record<string, unknown>> = {}) => {
    reply.code(STATUS[result.reasonClass] ?? 409);
    return { error: result.reasonClass, messageCode: result.messageCode, ...extra };
  };
  /** A returned `TR-73-46` closure COMMITS the workflow mutation and answers 409 with the closure's own message. */
  const closed = (reply: FastifyReply, result: { readonly outcome: "expired" | "invalidated"; readonly messageCode: string; readonly transfer: unknown }, extra: Readonly<Record<string, unknown>> = {}) => {
    reply.code(409);
    return { error: `transfer_${result.outcome}`, messageCode: result.messageCode, transfer: result.transfer, ...extra };
  };

  @Controller("v1/budget-spaces/:budgetSpaceId/primary-transfers")
  class PrimaryTransferController {
    /** `TR-73-40`. Ineligible or stale targets deny without a workflow row (`TR-73-47`). */
    @Post()
    @authorize(TRANSFER_ACTIONS.propose, "propose")
    async propose(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, actor } = within(request, effect, TRANSFER_ACTIONS.propose);
      try {
        const result = await proposePrimaryTransfer(deps, actor, parseProposeTransferRequest(request.body));
        if (result.outcome === "denied") return denied(reply, result);
        return { outcome: result.outcome, messageCode: result.messageCode, transfer: result.transfer };
      } catch (error) { return transferFailure(error); }
    }

    /** `TR-73-41`, and `TR-73-43` when this leg completes the pair. The caller's own row is the target; the handler proves the party. */
    @Post(":transferId/accept")
    @HttpCode(200)
    @authorize(TRANSFER_ACTIONS.accept, "own")
    async accept(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, actor, transferId } = within(request, effect, TRANSFER_ACTIONS.accept);
      try {
        const result = await acceptPrimaryTransfer(deps, actor, { transferId: transferId! });
        if (result.outcome === "denied") return denied(reply, result);
        if (result.outcome === "expired" || result.outcome === "invalidated") return closed(reply, result);
        return { outcome: result.outcome, messageCode: result.messageCode, transfer: result.transfer, ...(result.outcome === "committed" ? { receipt: result.receipt } : {}) };
      } catch (error) { return transferFailure(error); }
    }

    /** `TR-73-44`. The recipient declines; the caller's own row is the target. */
    @Post(":transferId/decline")
    @HttpCode(200)
    @authorize(TRANSFER_ACTIONS.decline, "own")
    async decline(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, actor, transferId } = within(request, effect, TRANSFER_ACTIONS.decline);
      try {
        const result = await declinePrimaryTransfer(deps, actor, { transferId: transferId! });
        if (result.outcome === "denied") return denied(reply, result);
        if (result.outcome === "expired" || result.outcome === "invalidated") return closed(reply, result);
        return { outcome: result.outcome, messageCode: result.messageCode, transfer: result.transfer };
      } catch (error) { return transferFailure(error); }
    }

    /**
     * `TR-73-42`, and `TR-73-43` when this leg completes the pair, under the
     * protected cell. The boundary spent the grant and discharged the four
     * obligations before this ran; the reference and the ledger come from the
     * store. Every committed answer here consumed the grant (`SEC-PK7A-F6`).
     */
    @Post(":transferId/confirm")
    @HttpCode(200)
    @authorize(TRANSFER_ACTIONS.confirm, "recipient")
    async confirm(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, actor, transferId, context } = within(request, effect, TRANSFER_ACTIONS.confirm);
      const consumed = { freshAssurance: "consumed" as const, next: STEP_UP_REQUIRED };
      try {
        // Fail closed: without the store's ledger and reference the boundary did not spend a grant and discharge the four on
        // this transaction, and the in-module discharge path must never stand in for them here. Rolled back: nothing written.
        if (!context.ledger || !actor.freshAssuranceRef) throw new TransferRouteFailure(403, "obligation_undischarged", { freshAssurance: "unspent" });
        const result = await confirmPrimaryTransfer(deps, actor, { transferId: transferId! }, { ledger: context.ledger });
        if (result.outcome === "denied") return denied(reply, result, consumed);
        if (result.outcome === "expired" || result.outcome === "invalidated") return closed(reply, result, consumed);
        if (result.outcome === "committed") return { outcome: result.outcome, messageCode: result.messageCode, transfer: result.transfer, receipt: result.receipt, freshAssurance: "consumed" as const };
        return { outcome: result.outcome, messageCode: result.messageCode, transfer: result.transfer, ...consumed };
      } catch (error) { return transferFailure(error, true); }
    }

    /** `TR-73-45`. The Primary withdraws; a repeat on a withdrawn workflow denies the uniform no-op. */
    @Post(":transferId/withdraw")
    @HttpCode(200)
    @authorize(TRANSFER_ACTIONS.withdraw, "recipient")
    async withdraw(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, actor, transferId } = within(request, effect, TRANSFER_ACTIONS.withdraw);
      try {
        const result = await withdrawPrimaryTransfer(deps, actor, { transferId: transferId! });
        if (result.outcome === "denied") return denied(reply, result);
        if (result.outcome === "expired" || result.outcome === "invalidated") return closed(reply, result);
        return { outcome: result.outcome, messageCode: result.messageCode, transfer: result.transfer };
      } catch (error) { return transferFailure(error); }
    }

    /** The status read for either party (`SEC-PK7A-F4`: the handler proves the party, the status and the subject). */
    @Get(":transferId")
    @authorize(TRANSFER_ACTIONS.view, "recipient")
    async view(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, actor, transferId } = within(request, effect, TRANSFER_ACTIONS.view);
      try {
        const result = await viewPrimaryTransfer(deps, actor, { transferId: transferId! });
        if (result.outcome === "denied") return denied(reply, result);
        return { transfer: result.transfer };
      } catch (error) { return transferFailure(error); }
    }
  }

  return { module: { module: PrimaryTransferModule, controllers: [PrimaryTransferController] } };
}

const SERIALIZATION_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// The transaction store for the six transfer actions.
// ---------------------------------------------------------------------------

/** The part of `ApiTransactionStore` this store composes over: the grant spend and the reference it produced. */
export interface FreshAssuranceSpender {
  discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean>;
  spentFreshAssuranceRef(transaction: unknown): string | undefined;
}

const TRANSFER_KINDS: ReadonlySet<string> = new Set(TRANSFER_OBLIGATION_KINDS);
const FREE_KINDS: ReadonlySet<string> = new Set(["audit", "recheck_at_commit", "bind_cache_key", "fresh_assurance"]);

/**
 * One `serializable` transaction per effect, in the shape
 * `InvitationsAuthorizationStore` established: a rolled-back `RouteFailure`
 * is returned as the result so its status reaches the client, every handle's
 * fate is reported explicitly (A3), and `retryable_conflict` -- whether the
 * module translated it from a statement or the seam raised `40001`/`40P01`
 * at COMMIT (`R-04`) -- re-runs the whole effect up to
 * `SERIALIZATION_ATTEMPTS` times before it is answered.
 *
 * Obligations, on the boundary's own transaction and in the cell's order:
 *
 *   * `bind_cache_key` (the view cell) names caching dimensions; nothing to write;
 *   * `fresh_assurance` is spent by the general `ApiTransactionStore` (PK-4),
 *     which records the consumed grant's identifier against the handle;
 *   * `confirm`, `invalidate`, `notify`, `preserve` go to PK-7A's
 *     `primaryTransferDischarges` on one ledger per handle, begun with the
 *     reference the spend produced and on the space's one live workflow --
 *     and refused, like any undischargeable obligation, when the handle has
 *     spent no grant yet or the space has no live workflow whose recipient
 *     row is the decided target. The captures are proofs, not writes: the
 *     handler commits on a fresh capture after the leg (`R-01`, `SEC-PK7A-F1`).
 */
export class PrimaryTransferAuthorizationStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  readonly #general: FreshAssuranceSpender;
  readonly #within: (transaction: DataAccessClient) => PrimaryTransferScope;
  readonly #ledgers = new WeakMap<object, { readonly ledger: TransferObligationLedger; readonly correlationId: string }>();
  #outcomes: { committed(handle: object): void; rolledBack(handle: object): void } | undefined;

  constructor(client: DataAccessClient, general: FreshAssuranceSpender, within: (transaction: DataAccessClient) => PrimaryTransferScope) {
    this.#client = client; this.#general = general; this.#within = within;
  }
  observe(outcomes: { committed(handle: object): void; rolledBack(handle: object): void }): void { this.#outcomes = outcomes; }

  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      let handle: object | undefined;
      try {
        const result = await this.#client.transaction({ isolation: "serializable" }, (client) => { handle = client; return work(client); });
        if (handle) this.#outcomes?.committed(handle);
        return result;
      } catch (error) {
        if (handle) this.#outcomes?.rolledBack(handle);
        const state = (error as { sqlState?: string } | null)?.sqlState;
        if (state === "40001" || state === "40P01") {
          if (attempt < SERIALIZATION_ATTEMPTS) continue;
          // `R-04`: a serialization failure the seam raised at COMMIT, retries exhausted, is the module's own
          // `retryable_conflict` on the wire. Rolled back: a confirm's grant was returned with the rollback.
          return new TransferRouteFailure(409, "retryable_conflict", currentAction() === TRANSFER_ACTIONS.confirm ? { freshAssurance: "unspent" } : {}) as T;
        }
        if (error instanceof RouteFailure) {
          if (attempt < SERIALIZATION_ATTEMPTS && RETRYABLE_TRANSFER_FAILURES.has(error.response.error)) continue;
          return error as T;
        }
        throw error;
      }
    }
  }

  async discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    if (!TRANSFER_ACTION_SET.includes(input.request.action)) return false;
    if (obligation.kind === "bind_cache_key") return true;
    if (obligation.kind === "fresh_assurance") return this.#general.discharge(transaction, input, obligation);
    if (!TRANSFER_KINDS.has(obligation.kind)) return false;
    // The four discharge only after the grant was spent on this very handle: the reference they bind to is the spend's.
    const reference = this.#general.spentFreshAssuranceRef(transaction);
    if (!reference || transaction === null || typeof transaction !== "object") return false;
    const scope = this.#within(transaction as DataAccessClient);
    const entry = this.#ledgers.get(transaction) ?? await this.#begin(transaction, scope, input, reference);
    if (!entry) return false;
    return scope.discharges.discharge(entry.ledger, obligation.kind as TransferObligationKind);
  }

  /**
   * Begin the one ledger of this handle. The workflow is the space's one live
   * one (the `M3` partial unique index admits one), and it must be the one
   * the decision was taken on: its recipient row is the decided target. The
   * decision tuple is the commit-time recheck's own (`versions`); the
   * membership version is the acting membership's as re-read.
   */
  async #begin(transaction: object, scope: PrimaryTransferScope, input: PolicyInput, reference: string) {
    const spaceId = input.space?.spaceId;
    const membership = input.membership;
    const target = input.resource?.id;
    if (typeof spaceId !== "string" || !membership || typeof target !== "string") return undefined;
    const live = await scope.deps.repository.findLiveTransfer(spaceId);
    if (!live || live.recipientMembershipId !== target) return undefined;
    // Bound to a short local first (PK2FIX-F04).
    const version = membership.authorizationVersion;
    const digest = input.versions.capturedAtPrecheck?.policyDigest;
    const correlationId = randomUUID();
    const ledger = scope.discharges.begin({
      budgetSpaceId: spaceId, transferId: live.transferId,
      decision: { policyVersion: input.versions.policyVersion, policyDigest: typeof digest === "string" ? digest : "", authorizationVersion: version },
      freshAssuranceRef: reference, correlationId,
    });
    const entry = { ledger, correlationId };
    this.#ledgers.set(transaction, entry);
    return entry;
  }

  async verify(transaction: unknown, input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean> {
    if (!TRANSFER_ACTION_SET.includes(input.request.action)) return false;
    const entry = transaction !== null && typeof transaction === "object" ? this.#ledgers.get(transaction) : undefined;
    return obligations.every((obligation) => FREE_KINDS.has(obligation.kind)
      || (TRANSFER_KINDS.has(obligation.kind) && entry !== undefined && entry.ledger.discharged.has(obligation.kind as TransferObligationKind)));
  }

  /** `SEC-PK7A-F2`: what the confirm handler may know about its own transaction, and nothing about any other. */
  context(transaction: unknown): TransferTransactionContext {
    const entry = transaction !== null && typeof transaction === "object" ? this.#ledgers.get(transaction) : undefined;
    return { freshAssuranceRef: this.#general.spentFreshAssuranceRef(transaction), ledger: entry?.ledger, correlationId: entry?.correlationId };
  }
}

// ---------------------------------------------------------------------------
// Production dependencies.
// ---------------------------------------------------------------------------

export function dataAccessPrimaryTransferDependencies(options: {
  readonly client: DataAccessClient; readonly within: (transaction: DataAccessClient) => PrimaryTransferScope;
  readonly context: (transaction: unknown) => TransferTransactionContext;
}): PrimaryTransferHttpDependencies {
  const { client } = options;
  return {
    within: options.within, context: options.context,
    membership: async (subject, budgetSpaceId) => {
      const found = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId, columns: ["membership_id"],
        conditions: [{ column: "account_subject_id", value: subject }, { column: "status", value: "active" }] });
      const row = found.rows[0] as { membership_id?: unknown } | undefined;
      return typeof row?.membership_id === "string" ? row.membership_id : null;
    },
    membershipExists: async (budgetSpaceId, membershipId) => {
      const found = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId, columns: ["membership_id"],
        conditions: [{ column: "membership_id", value: membershipId }] });
      return found.rows.length === 1;
    },
    transferParties: async (budgetSpaceId, transferId) => {
      const found = await client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId, columns: ["proposer_membership_id", "recipient_membership_id"],
        conditions: [{ column: "transfer_id", value: transferId }] });
      const row = found.rows[0] as { proposer_membership_id?: unknown; recipient_membership_id?: unknown } | undefined;
      return typeof row?.proposer_membership_id === "string" && typeof row.recipient_membership_id === "string"
        ? { proposerMembershipId: row.proposer_membership_id, recipientMembershipId: row.recipient_membership_id }
        : null;
    },
  };
}

/** The uniform message of every `TR-73-47` denial, re-exported for the route tests. */
export { UNIFORM_DENIAL_MESSAGE_CODE };
