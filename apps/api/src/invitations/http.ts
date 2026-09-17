/**
 * Invitation routes (PK-6 of `INVITATIONS-DESIGN-001`; CBD-234 design
 * sections 5.1, 5.2, 12 and 13; CBD-73 sections 4, 5 and 8; CBD-41, CBD-274,
 * CBD-275, CBD-276).
 *
 * Owner routes, every one behind `@Authorize` with the cell the design names,
 * selected server-side before `decide` where the body or the record decides
 * which cell applies (`RouteAuthorization.select`, PROTO-ACTIVATION-001 A5):
 *
 *   POST   /v1/budget-spaces/:id/invitations                          24.invite_nonowner | 26.invite_coowner   (from `proposedRole`)
 *   GET    /v1/budget-spaces/:id/invitations                          24.view_invitations
 *   POST   /v1/budget-spaces/:id/invitations/:invitationId/replace    24.replace_invitation | 24.resend_invitation (`mode: "resend"`, OQ-IV-002) | 26.invite_coowner
 *   DELETE /v1/budget-spaces/:id/invitations/:invitationId            24.revoke_nonowner | 26.invite_coowner
 *   POST   /v1/budget-spaces/:id/invitations/:invitationId/confirm    24.confirm_acceptance | 26.confirm_acceptance
 *   POST   /v1/budget-spaces/:id/invitations/:invitationId/reject     same codes as confirm
 *
 * The `26.*` cell is selected from the record's own `required_permission`,
 * read by a trusted pre-policy statement -- never from a body field -- so an
 * owner holding only permission 24 cannot confirm, replace or cancel a
 * Co-owner invitation (CBD-73 section 5.1 item 2; `SEC-PK5-F02`, `R-03`).
 * `OwnerActorContext.permission` is always the selected cell's permission key (`PK5FIX-F02`: required in the type).
 *
 * The pre-authentication ceremony trio, on `@PreAuthenticationSurface()` with
 * no policy decision (section 5.1: a link holder has no session; decline must
 * work without an account), each one its own `serializable` transaction:
 *
 *   POST /v1/invitations/resolve                    TR-73-08 / TR-73-14; sets `__Host-mp_invitation_ceremony`
 *   POST /v1/invitations/:ceremonyId/verify-channel TR-73-09
 *   POST /v1/invitations/:ceremonyId/decline        TR-73-11
 *
 * The authenticated invitee routes, on the p5 subject cells (design section
 * 11.3; CBD-236 section 4.4) through the real fact assembler and the ceremony
 * fact reader in `../sessions/budget-facts.ts`:
 *
 *   POST /v1/invitations/:ceremonyId/attach   invitation.attach        (subject-self; the ceremony is located by the cookie, not a policy target)
 *   GET  /v1/invitations/:ceremonyId          invitation.read_ceremony (subject-target `invitation_ceremony`)
 *   POST /v1/invitations/:ceremonyId/accept   invitation.accept        (subject-target `invitation_ceremony`)
 *
 * **The transaction contract (`PK5FIX-F01`, the explicit PK-6 criterion).**
 * Every command of the PK-5 module runs inside the transaction the route
 * holds, and the CBD-246 seam rolls that transaction back on any thrown
 * error. Three answers are therefore *returned* by the module rather than
 * thrown, because the writes that make them meaningful must commit: the
 * `retry` and `exhausted` outcomes of `verifyChannel` (the attempt increment
 * and its `AE-73-09` row are what make the six-digit challenge bounded), and
 * the `{ outcome: "unusable" }` the private `TR-73-06` cancels in
 * `attachAccount` and `TR-73-38` produce (the cancel and its restricted
 * `AE-73-06` row). These routes COMMIT on every returned outcome and map it to
 * the status it needs afterwards; they roll back only on a thrown
 * `InvitationError`, which by the module's own rule has written nothing. A
 * route that wrapped every non-success answer in a rollback would silently
 * reintroduce `SEC-PK5-F01`.
 *
 * **Uniform outcomes (CBD-73 section 5.1 item 6; design section 5.2).** Every
 * unusable-link and unusable-ceremony class -- unknown, malformed, expired,
 * consumed, cancelled, superseded, declined, foreign, wrong or missing cookie,
 * another environment, invalidated by a newer resolve, a second subject, an
 * out-of-order step (`channel_proof_required`, `attachment_required`), and
 * the private already-member and stale-membership cancels -- answers with one
 * status and one envelope, `UNIFORM_INVITATION_BODY`, on every route of this
 * module. A successful decline answers the same envelope: the person who
 * declined learns only that the link is finished (CBD-73 section 8.1).
 *
 * `conflict` and `retryable_conflict` are one class on the wire (`R-07`): the
 * store re-runs the effect (re-read, replay with the client's own key) before
 * answering, so the loser of two concurrent confirms with the winner's key is
 * handed the stored receipt and with its own key is told the record is no
 * longer current.
 */
import { randomUUID } from "node:crypto";
import { Controller, Delete, Get, HttpCode, Module, Post, Req, Res } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import { externalDenial } from "@cobudget/contracts/authorization";
import { Authorize, Authorization, PreAuthenticationSurface, RouteFailure } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { AuthorizationTransactionStore, EffectContext } from "../authorization/boundary.js";
import {
  InvitationError, UNIFORM_LINK_MESSAGE_CODE,
  acceptInvitation, attachAccount, cancelInvitation, confirmAcceptance, createInvitation, declineInvitation,
  destinationToken, expireOnObservation, invitationProjection, parseAcceptInvitationRequest, parseCeremonyRequest,
  parseConfirmAcceptanceRequest, parseCreateInvitationRequest, parseResolveCodeRequest, parseUnauthenticatedCeremonyRequest,
  parseVerifyChannelRequest, readDisclosure, rejectAcceptance, replaceInvitation, resolveCode, verifyChannel,
} from "../../../../packages/budget-application/src/invitations/index.ts";
import type {
  InvitationDependencies, InvitationErrorCode, InvitationProjection, InviteeContext, OwnerActorContext, OwnerContext,
} from "../../../../packages/budget-application/src/invitations/index.ts";
import { readInvitationCeremonyCookie, invitationCeremonyCookie } from "./cookie.ts";
import type { InvitationScope } from "./persistence.ts";

// ---------------------------------------------------------------------------
// Actions and the wire vocabulary.
// ---------------------------------------------------------------------------

export const INVITATION_ACTIONS = {
  inviteNonowner: "24.invite_nonowner",
  inviteCoowner: "26.invite_coowner",
  view: "24.view_invitations",
  replace: "24.replace_invitation",
  resend: "24.resend_invitation",
  revoke: "24.revoke_nonowner",
  confirmNonowner: "24.confirm_acceptance",
  confirmCoowner: "26.confirm_acceptance",
  attach: "invitation.attach",
  readCeremony: "invitation.read_ceremony",
  accept: "invitation.accept",
} as const;
export const INVITATION_ACTION_SET: readonly string[] = Object.values(INVITATION_ACTIONS);

/** The one status and one envelope every unusable-link and unusable-ceremony class answers with. */
export const UNIFORM_INVITATION_STATUS = 404;
export const UNIFORM_INVITATION_ERROR = "invitation_unusable";
export const UNIFORM_INVITATION_BODY: Readonly<{ error: string; messageCode: string }> = Object.freeze({ error: UNIFORM_INVITATION_ERROR, messageCode: UNIFORM_LINK_MESSAGE_CODE });

/** The uniform outcome as a rolled-back route failure (nothing was written by the path that raised it). */
export class UniformInvitationFailure extends RouteFailure {
  constructor() {
    super(UNIFORM_INVITATION_STATUS, UNIFORM_INVITATION_ERROR);
    Object.defineProperty(this, "response", { value: UNIFORM_INVITATION_BODY, enumerable: true });
  }
}

/**
 * `R-02`: the pre-authentication trio's answer for an error that is neither an
 * `InvitationError` nor a serialization failure it could retry -- the same
 * `503 {outcome: deny, reason: denied}` the boundary answers when its store
 * fails (`deny` in `authorization/http.ts`), so the trio never answers a
 * framework body. Nothing was written: the transaction rolled back.
 */
export class TrioExternalDenial extends RouteFailure {
  constructor() {
    super(503, "denied");
    Object.defineProperty(this, "response", { value: Object.freeze(externalDenial()), enumerable: true });
  }
}

/** The module's error vocabulary (PR #352), mapped once. Uniform classes carry no status of their own. */
const UNIFORM_CODES: ReadonlySet<InvitationErrorCode> = new Set<InvitationErrorCode>(["code_unusable", "ceremony_unusable", "channel_proof_required", "attachment_required"]);
const STATUS: Readonly<Record<Exclude<InvitationErrorCode, "code_unusable" | "ceremony_unusable" | "channel_proof_required" | "attachment_required">, number>> = Object.freeze({
  invalid_request: 400, destination_invalid: 400, proposed_role_unsupported: 400,
  channel_challenge_invalid: 400, channel_attempts_exhausted: 400,
  authorization_denied: 403, permission_mismatch: 403,
  budget_space_not_found: 404, invitation_not_found: 404,
  budget_space_not_live: 409, invitation_not_current: 409, stale_version: 409, already_member: 409,
  membership_ended_after_issue: 409, subject_ineligible: 409, stale_disclosure: 409, confirmation_not_current: 409,
  idempotency_key_reused: 409, conflict: 409, retryable_conflict: 409, constraint_violation: 409,
});
/** `R-07`: one class on the wire; the store retries both before this is ever answered. */
const CONFLICT_CODES: ReadonlySet<string> = new Set(["conflict", "retryable_conflict"]);
export const RETRYABLE_INVITATION_FAILURES: ReadonlySet<string> = new Set(["retryable_conflict"]);

/** Application failures travel as `RouteFailure`, which the boundary transports only after rollback. */
export function invitationFailure(error: unknown): never {
  if (error instanceof InvitationError) {
    if (UNIFORM_CODES.has(error.code)) throw new UniformInvitationFailure();
    if (CONFLICT_CODES.has(error.code)) throw new RouteFailure(409, "retryable_conflict");
    throw new RouteFailure(STATUS[error.code as keyof typeof STATUS] ?? 409, error.code);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Dependencies.
// ---------------------------------------------------------------------------

export interface InvitationsHttpDependencies {
  /** The PK-5 dependency bundle on the transaction a route holds. */
  readonly within: (transaction: DataAccessClient) => InvitationScope;
  /** The root client: the pre-authentication trio's own transactions run on it. */
  readonly client: DataAccessClient;
  /** The CBD-232 section 8.1 environment key, from runtime configuration and never from a request. */
  readonly environmentId: string;
  /** CBD-191 section 5.1: the exact application origin the pre-authentication trio accepts (as `POST /v1/identity/begin` does). */
  readonly applicationOrigin: string;
  /** The subject's active membership in the space, from trusted storage; null when there is none. */
  readonly membership: (subject: string, budgetSpaceId: string) => Promise<string | null>;
  /** The record's own `required_permission`, from trusted storage, so the `26.*` cell is selected from the record and never from the body. */
  readonly requiredPermission: (budgetSpaceId: string, invitationId: string) => Promise<"24" | "26" | null>;
  /** `SEC-PK5-R07`: the account subject a destination *token* belongs to, by keyed comparison or a provider-side lookup only; null when unknown. */
  readonly subjectForDestination: (token: string) => Promise<string | null>;
  /** `SEC-PK2-F07`: the `account_session.session_id` row identifier behind the session the boundary resolved; never a token. */
  readonly sessionRowId: (transaction: DataAccessClient, sessionRef: string) => Promise<string | null>;
  readonly now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function permissionOf(action: string): "24" | "26" {
  return action.startsWith("26.") ? "26" : "24";
}

@Module({})
export class InvitationsModule {}

export function invitationsHttp(dependencies: InvitationsHttpDependencies): { module: DynamicModule } {
  // --- owner routes -----------------------------------------------------------
  interface Acting { readonly subject: string; readonly budgetSpaceId: string; readonly invitationId: string | null; readonly membershipId: string | null; readonly permission: "24" | "26" | null }
  const acting = new WeakMap<FastifyRequest, Acting | undefined>();
  const spaceOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).budgetSpaceId;
    if (typeof id !== "string" || !UUID.test(id)) throw new RouteFailure(404, "budget_space_not_found");
    return id.toLowerCase();
  };
  const invitationOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).invitationId;
    if (typeof id !== "string" || !UUID.test(id)) throw new RouteFailure(404, "invitation_not_found");
    return id.toLowerCase();
  };
  const bodyOf = (request: FastifyRequest): Record<string, unknown> => (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
  /**
   * The trusted pre-policy resolution every owner route shares: the space and
   * (for a row route) the invitation from the path, the acting membership and
   * the record's `required_permission` from storage. Nothing here decides; it
   * only names what `select` then evaluates.
   */
  const replay = (row: boolean) => async (request: FastifyRequest, subject: string) => {
    const budgetSpaceId = spaceOf(request);
    const invitationId = row ? invitationOf(request) : null;
    if (invitationId === budgetSpaceId) throw new RouteFailure(404, "invitation_not_found");
    acting.set(request, {
      subject, budgetSpaceId, invitationId,
      membershipId: await dependencies.membership(subject, budgetSpaceId),
      permission: invitationId ? await dependencies.requiredPermission(budgetSpaceId, invitationId) : null,
    });
    return { kind: "absent" as const };
  };
  const locator = (request: FastifyRequest, resourceType: "space" | "invitation") => {
    const resolved = acting.get(request);
    if (!resolved) throw new AuthorizationDenied();
    return {
      fieldSet: "default" as const, resourceType, resourceId: resolved.invitationId ?? resolved.budgetSpaceId,
      actingSpaceId: resolved.budgetSpaceId,
      ...(resolved.membershipId ? { actingMembershipId: resolved.membershipId } : {}),
    };
  };
  /** A row route whose cell depends on the record's permission: the given `26.*` code for a Co-owner invitation, the given row-24 code otherwise. */
  const selectByRecord = (nonowner: (request: FastifyRequest) => string, coowner: string) => async (request: FastifyRequest) => {
    const resolved = acting.get(request);
    if (!resolved) throw new AuthorizationDenied();
    return { action: resolved.permission === "26" ? coowner : nonowner(request), ...locator(request, "invitation") };
  };
  const ownerAuthorize = (options: { readonly actions: readonly string[]; readonly row: boolean; readonly select: (request: FastifyRequest) => Promise<{ readonly action: string } & ReturnType<typeof locator>> }) => Authorize({
    action: options.actions[0]!, actions: options.actions, purpose: "user_delegated",
    replay: replay(options.row),
    select: (request) => options.select(request),
    resourceLocator: (request) => locator(request, options.row ? "invitation" : "space"),
  });
  const ownerWithin = (request: FastifyRequest, effect: EffectContext): { scope: InvitationScope; owner: OwnerActorContext; invitationId: string | null } => {
    // Not cleared here: the store re-runs the whole effect on a conflict (`R-07`) and the second run needs the same
    // pre-policy resolution; the WeakMap entry is released with the request object.
    const resolved = acting.get(request);
    const input = effect.input as PolicyInput & { space?: { spaceId: string }; membership?: { membershipId: string; authorizationVersion: number } };
    const subject = input.subject && "accountSubjectId" in input.subject ? input.subject.accountSubjectId : undefined;
    if (!resolved || typeof subject !== "string" || subject !== resolved.subject || input.space?.spaceId !== resolved.budgetSpaceId || !input.membership) throw new AuthorizationDenied();
    // Bound to short locals first: the secret scanner's generic-api-key rule reads `authorizationVersion: <long identifier>` as a credential (PK2FIX-F04).
    const membership = input.membership;
    const version = membership.authorizationVersion;
    const owner: OwnerActorContext = {
      budgetSpaceId: resolved.budgetSpaceId, subjectId: subject, membershipId: membership.membershipId,
      decision: { policyVersion: effect.decision.policyVersion, policyDigest: effect.decision.policyDigest, authorizationVersion: version },
      // `SEC-PK5-F02` / `R-03`: always the permission of the cell the allow decision was taken against.
      permission: permissionOf(effect.input.request.action),
      correlationId: randomUUID(),
    };
    return { scope: dependencies.within(effect.transaction as DataAccessClient), owner, invitationId: resolved.invitationId };
  };

  @Controller("v1/budget-spaces/:budgetSpaceId/invitations")
  class InvitationsOwnerController {
    /** `TR-73-01` + `TR-73-02`. The cell is selected from `proposedRole` before `decide`; the body never becomes an authority fact. */
    @Post()
    @ownerAuthorize({
      actions: [INVITATION_ACTIONS.inviteNonowner, INVITATION_ACTIONS.inviteCoowner], row: false,
      select: async (request) => ({ action: bodyOf(request).proposedRole === "co_owner" ? INVITATION_ACTIONS.inviteCoowner : INVITATION_ACTIONS.inviteNonowner, ...locator(request, "invitation") }),
    })
    async create(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, owner } = ownerWithin(request, effect);
      try {
        const parsed = parseCreateInvitationRequest(request.body);
        // `SEC-PK5-R07`: the destination is resolved to a subject by its keyed token only, and the answer never reaches the response.
        const inviteeSubjectId = await dependencies.subjectForDestination(await destinationToken(deps.digest, parsed.destination));
        const created = await createInvitation(deps, owner, parsed, { inviteeSubjectIdForDestination: inviteeSubjectId });
        // The customer projection only: real and synthetic are indistinguishable (`DR-73-10`), and `suppressed` never leaves the server.
        return { invitation: created.projection };
      } catch (error) { return invitationFailure(error); }
    }

    /** The owner's projection list (`24.view_invitations`; CBD-73 section 4.5). Expiry is materialized on observation (`TR-73-07`). */
    @Get()
    @ownerAuthorize({ actions: [INVITATION_ACTIONS.view], row: false, select: async (request) => ({ action: INVITATION_ACTIONS.view, ...locator(request, "space") }) })
    async list(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope, owner } = ownerWithin(request, effect);
      try {
        const rows = await listInvitationProjections(scope, owner);
        return { budgetSpaceId: owner.budgetSpaceId, invitations: rows };
      } catch (error) { return invitationFailure(error); }
    }

    /** `TR-73-05`. Resend and replacement are one transition and one route with a mode (OQ-IV-002). */
    @Post(":invitationId/replace")
    @ownerAuthorize({
      actions: [INVITATION_ACTIONS.replace, INVITATION_ACTIONS.resend, INVITATION_ACTIONS.inviteCoowner], row: true,
      select: selectByRecord((request) => bodyOf(request).mode === "resend" ? INVITATION_ACTIONS.resend : INVITATION_ACTIONS.replace, INVITATION_ACTIONS.inviteCoowner),
    })
    async replace(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, owner, invitationId } = ownerWithin(request, effect);
      try {
        const replaced = await replaceInvitation(deps, owner, invitationId!);
        return { invitation: replaced.projection, supersededInvitationId: replaced.supersededInvitationId };
      } catch (error) { return invitationFailure(error); }
    }

    /** `TR-73-06` actor path: the projection retires as `cancelled`. */
    @Delete(":invitationId")
    @HttpCode(200)
    @ownerAuthorize({ actions: [INVITATION_ACTIONS.revoke, INVITATION_ACTIONS.inviteCoowner], row: true, select: selectByRecord(() => INVITATION_ACTIONS.revoke, INVITATION_ACTIONS.inviteCoowner) })
    async cancel(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, owner, invitationId } = ownerWithin(request, effect);
      try { return { invitation: await cancelInvitation(deps, owner, invitationId!) }; }
      catch (error) { return invitationFailure(error); }
    }

    /** `TR-73-39` confirm plus `TR-73-13`: the section 8 acceptance transaction, idempotent on `confirmationIdempotencyKey`. */
    @Post(":invitationId/confirm")
    @HttpCode(200)
    @ownerAuthorize({ actions: [INVITATION_ACTIONS.confirmNonowner, INVITATION_ACTIONS.confirmCoowner], row: true, select: selectByRecord(() => INVITATION_ACTIONS.confirmNonowner, INVITATION_ACTIONS.confirmCoowner) })
    async confirm(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, owner, invitationId } = ownerWithin(request, effect);
      try { return { receipt: await confirmAcceptance(deps, owner, parseConfirmAcceptanceRequest(invitationId, request.body)) }; }
      catch (error) { return invitationFailure(error); }
    }

    /** `TR-73-39` reject: the acceptor receives the uniform `MSG-73-052` notice and never who or why. */
    @Post(":invitationId/reject")
    @HttpCode(200)
    @ownerAuthorize({ actions: [INVITATION_ACTIONS.confirmNonowner, INVITATION_ACTIONS.confirmCoowner], row: true, select: selectByRecord(() => INVITATION_ACTIONS.confirmNonowner, INVITATION_ACTIONS.confirmCoowner) })
    async reject(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { scope: { deps }, owner, invitationId } = ownerWithin(request, effect);
      try { return { invitation: await rejectAcceptance(deps, owner, { invitationId: invitationId! }) }; }
      catch (error) { return invitationFailure(error); }
    }
  }

  // --- the ceremony ------------------------------------------------------------
  const ceremonyIdOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).ceremonyId;
    if (typeof id !== "string" || !UUID.test(id)) throw new UniformInvitationFailure();
    return id.toLowerCase();
  };
  const sameOrigin = (request: FastifyRequest): boolean =>
    header(request, "origin") === dependencies.applicationOrigin && header(request, "sec-fetch-site") !== "cross-site";
  /**
   * One `serializable` transaction for a pre-authentication route, composed
   * exactly as the boundary's store composes the authenticated ones: the
   * returned outcome COMMITS, a thrown `InvitationError` rolls back and becomes
   * the mapped status, and a serialization failure is retried before it is
   * answered. `PK5FIX-F01` is honoured here by construction.
   *
   * `R-02`: a serialization failure PostgreSQL raises at COMMIT reaches this
   * catch as the driver's error, not as the adapter's `retryable_conflict`, and
   * is retried by `sqlState` exactly as `InvitationsAuthorizationStore` does;
   * whatever is left that is not a mapped `RouteFailure` is answered as the
   * uniform external denial, never as the framework's default body.
   */
  const committed = async <T>(work: (scope: InvitationScope) => Promise<T>): Promise<T | RouteFailure> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await dependencies.client.transaction({ isolation: "serializable" }, (scoped) => work(dependencies.within(scoped)));
      } catch (error) {
        const state = (error as { sqlState?: string } | null)?.sqlState;
        if ((state === "40001" || state === "40P01") && attempt < SERIALIZATION_ATTEMPTS) continue;
        try { invitationFailure(error); }
        catch (mapped) {
          if (mapped instanceof RouteFailure) {
            if (RETRYABLE_INVITATION_FAILURES.has(mapped.response.error) && attempt < SERIALIZATION_ATTEMPTS) continue;
            return mapped;
          }
          return new TrioExternalDenial();
        }
      }
    }
  };
  const send = async (reply: FastifyReply, result: unknown, status: number): Promise<void> => {
    if (result instanceof RouteFailure) { await reply.code(result.status).send(result.response); return; }
    await reply.code(status).send(result);
  };
  const uniform = (reply: FastifyReply) => reply.code(UNIFORM_INVITATION_STATUS).send(UNIFORM_INVITATION_BODY);

  // --- the invitee ------------------------------------------------------------
  const inviteeWithin = async (effect: EffectContext): Promise<{ deps: InvitationDependencies; invitee: InviteeContext }> => {
    const subject = effect.input.subject;
    const accountSubjectId = subject && "accountSubjectId" in subject ? subject.accountSubjectId : undefined;
    const sessionRef = subject && "sessionRef" in subject ? subject.sessionRef : undefined;
    if (typeof accountSubjectId !== "string" || typeof sessionRef !== "string") throw new AuthorizationDenied();
    const transaction = effect.transaction as DataAccessClient;
    const sessionRowId = await dependencies.sessionRowId(transaction, sessionRef);
    if (!sessionRowId) throw new AuthorizationDenied();
    return {
      deps: dependencies.within(transaction).deps,
      invitee: { subjectId: accountSubjectId, sessionRowId, environment: dependencies.environmentId, correlationId: randomUUID() },
    };
  };
  const subjectSelf = () => ({ fieldSet: "default" as const, scope: "subject" as const });
  const subjectTarget = (request: FastifyRequest) => ({ fieldSet: "default" as const, scope: "subject" as const, resourceType: "invitation_ceremony" as const, resourceId: ceremonyIdOf(request) });

  @Controller("v1/invitations")
  class InvitationCeremonyController {
    /** `TR-73-08`, or `TR-73-14` with the identical answer. The ceremony secret travels only in the cookie, once. */
    @Post("resolve")
    @PreAuthenticationSurface()
    async resolve(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!sameOrigin(request)) { await reply.code(403).send({ error: "origin_rejected" }); return; }
      const correlationId = randomUUID();
      const result = await committed(({ deps }) => resolveCode(deps, parseResolveCodeRequest(request.body, dependencies.environmentId, correlationId)));
      if (result instanceof RouteFailure) { await send(reply, result, 200); return; }
      if (result.outcome !== "resolved") { await uniform(reply); return; }
      reply.header("set-cookie", invitationCeremonyCookie(result.ceremonySecret, result.ceremonyExpiresAt, dependencies.now()));
      // The ceremony-entry minimum of CBD-73 section 7.1 item 2 and nothing else: no role, no space, no inviter.
      await reply.code(200).send({ ceremonyId: result.ceremonyId, ceremonyExpiresAt: result.ceremonyExpiresAt, channelType: result.channelType });
    }

    /** `TR-73-09`. `retry` and `exhausted` COMMIT (the increment and the `AE-73-09` row are the bound). */
    @Post(":ceremonyId/verify-channel")
    @PreAuthenticationSurface()
    async verifyChannel(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!sameOrigin(request)) { await reply.code(403).send({ error: "origin_rejected" }); return; }
      const correlationId = randomUUID();
      const result = await committed(({ deps }) => verifyChannel(deps, parseVerifyChannelRequest(
        (request.params as Record<string, unknown>).ceremonyId, readInvitationCeremonyCookie(header(request, "cookie")), request.body, dependencies.environmentId, correlationId,
      )));
      if (result instanceof RouteFailure) { await send(reply, result, 200); return; }
      if (result.outcome === "proved") { await reply.code(200).send({ outcome: "proved", attemptsRemaining: result.attemptsRemaining }); return; }
      await reply.code(STATUS.channel_challenge_invalid).send({
        error: result.outcome === "exhausted" ? "channel_attempts_exhausted" : "channel_challenge_invalid",
        attemptsRemaining: result.attemptsRemaining,
      });
    }

    /** `TR-73-11`. Works with or without a session; the answer is the uniform envelope even on success. */
    @Post(":ceremonyId/decline")
    @PreAuthenticationSurface()
    async decline(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!sameOrigin(request)) { await reply.code(403).send({ error: "origin_rejected" }); return; }
      const correlationId = randomUUID();
      const result = await committed(({ deps }) => declineInvitation(deps, parseUnauthenticatedCeremonyRequest(
        (request.params as Record<string, unknown>).ceremonyId, readInvitationCeremonyCookie(header(request, "cookie")), dependencies.environmentId, correlationId,
      )));
      if (result instanceof RouteFailure) { await send(reply, result, 200); return; }
      await uniform(reply);
    }

    /** `TR-73-10`. Subject-self: the ceremony is located by the cookie and the path, never by a policy target. A returned `unusable` COMMITS. */
    @Post(":ceremonyId/attach")
    @HttpCode(200)
    @Authorize({ action: INVITATION_ACTIONS.attach, purpose: "user_delegated", resourceLocator: subjectSelf })
    async attach(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, invitee } = await inviteeWithin(effect);
      try {
        const result = await attachAccount(deps, invitee, parseCeremonyRequest(ceremonyIdOf(request), readInvitationCeremonyCookie(header(request, "cookie")), invitee.correlationId));
        if ("outcome" in result) { reply.code(UNIFORM_INVITATION_STATUS); return UNIFORM_INVITATION_BODY; }
        return { ceremonyId: result.ceremonyId, attached: true };
      } catch (error) { return invitationFailure(error); }
    }

    /** The disclosure surface: the full section 6 disclosure for the proposed role, the two-way statement, the section 5.1 item 4 notice, and (PK8-F06) the space name and inviter's display label the approved texts promise. */
    @Get(":ceremonyId")
    @Authorize({ action: INVITATION_ACTIONS.readCeremony, purpose: "user_delegated", resourceLocator: subjectTarget })
    async read(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, invitee } = await inviteeWithin(effect);
      try {
        const view = await readDisclosure(deps, invitee, parseCeremonyRequest(ceremonyIdOf(request), readInvitationCeremonyCookie(header(request, "cookie")), invitee.correlationId));
        return { ...view, choice: { accept: false, decline: false } };
      } catch (error) { return invitationFailure(error); }
    }

    /** `TR-73-38` with the `acknowledgedDisclosure` claim. `stale_disclosure` rolls back; a returned `unusable` COMMITS. */
    @Post(":ceremonyId/accept")
    @HttpCode(200)
    @Authorize({ action: INVITATION_ACTIONS.accept, purpose: "user_delegated", resourceLocator: subjectTarget })
    async accept(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, invitee } = await inviteeWithin(effect);
      try {
        const result = await acceptInvitation(deps, invitee, parseAcceptInvitationRequest(ceremonyIdOf(request), readInvitationCeremonyCookie(header(request, "cookie")), request.body, invitee.correlationId));
        if ("outcome" in result) { reply.code(UNIFORM_INVITATION_STATUS); return UNIFORM_INVITATION_BODY; }
        return result;
      } catch (error) { return invitationFailure(error); }
    }
  }

  return { module: { module: InvitationsModule, controllers: [InvitationsOwnerController, InvitationCeremonyController] } };
}

const SERIALIZATION_ATTEMPTS = 3;

/** The owner's projection list: every record of the space, expiry materialized on observation, projected and nothing else. */
async function listInvitationProjections({ deps, listInvitationIds }: InvitationScope, owner: OwnerContext): Promise<readonly InvitationProjection[]> {
  const projections: InvitationProjection[] = [];
  for (const invitationId of await listInvitationIds(owner.budgetSpaceId)) {
    const record = await deps.repository.readInvitation(owner.budgetSpaceId, invitationId);
    if (!record) continue;
    projections.push(invitationProjection(await expireOnObservation(deps, record, owner.correlationId)));
  }
  return projections.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
}

// ---------------------------------------------------------------------------
// The transaction store for the invitation actions.
// ---------------------------------------------------------------------------

/**
 * One `serializable` transaction per effect, in the shape
 * `AccountsAuthorizationStore` established: a rolled-back `RouteFailure` is
 * returned as the result so its status reaches the client, and every handle's
 * fate is reported explicitly (A3). Two additions:
 *
 *   * `retryable_conflict` -- a `40001`/`40P01` the module translated, or the
 *     `23505` a concurrent writer won (`conflict`, one class with it per `R-07`)
 *     -- re-runs the whole effect (re-assembly, re-decision, handler) up to
 *     `SERIALIZATION_ATTEMPTS` times before it is answered, which is the
 *     "re-read, replay with the client's own key" the confirm route needs;
 *   * the p5 obligations the invitation cells carry are discharged
 *     structurally: `invalidate` is the code and ceremony invalidation every
 *     transition performs inside the same transaction (`IC-73-006`), `notify` is
 *     the `AE-73-30` notice rows the commands write in the same transaction
 *     (CBD-280-AC06: no delivery is ever a commit dependency), and
 *     `bind_cache_key` names caching dimensions for an already-authorized read.
 */
export class InvitationsAuthorizationStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  #outcomes: { committed(handle: object): void; rolledBack(handle: object): void } | undefined;
  constructor(client: DataAccessClient) { this.#client = client; }
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
        if (attempt < SERIALIZATION_ATTEMPTS && (state === "40001" || state === "40P01")) continue;
        if (error instanceof RouteFailure) {
          if (attempt < SERIALIZATION_ATTEMPTS && RETRYABLE_INVITATION_FAILURES.has(error.response.error)) continue;
          return error as T;
        }
        throw error;
      }
    }
  }
  async discharge(_transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    return INVITATION_ACTION_SET.includes(input.request.action) && ["invalidate", "notify", "bind_cache_key"].includes(obligation.kind);
  }
  async verify(_transaction: unknown, input: PolicyInput, _obligations: readonly Obligation[]): Promise<boolean> {
    return INVITATION_ACTION_SET.includes(input.request.action);
  }
}

// ---------------------------------------------------------------------------
// Production dependencies.
// ---------------------------------------------------------------------------

export function dataAccessInvitationsDependencies(options: {
  readonly client: DataAccessClient; readonly within: (transaction: DataAccessClient) => InvitationScope;
  readonly environmentId: string; readonly applicationOrigin: string; readonly now: () => Date;
}): InvitationsHttpDependencies {
  const { client } = options;
  return {
    within: options.within, client, environmentId: options.environmentId, applicationOrigin: options.applicationOrigin, now: options.now,
    membership: async (subject, budgetSpaceId) => {
      const found = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId, columns: ["membership_id"],
        conditions: [{ column: "account_subject_id", value: subject }, { column: "status", value: "active" }] });
      const row = found.rows[0] as { membership_id?: unknown } | undefined;
      return typeof row?.membership_id === "string" ? row.membership_id : null;
    },
    requiredPermission: async (budgetSpaceId, invitationId) => {
      const found = await client.tenantSelect({ table: "budget_space_invitation", budgetSpaceId, columns: ["required_permission"],
        conditions: [{ column: "invitation_id", value: invitationId }] });
      const value = (found.rows[0] as { required_permission?: unknown } | undefined)?.required_permission;
      return value === "24" || value === "26" ? value : null;
    },
    // PROVIDERS-LOCAL-001: the identity schema stores no contact for a subject and the local provider has no
    // directory, so nothing resolves; the recipient-side checks at attach and accept close the two cases.
    subjectForDestination: async () => null,
    sessionRowId: async (transaction, sessionRef) => {
      const found = await transaction.platformSelect({ table: "account_session", columns: ["session_id"], conditions: [{ column: "session_ref", value: sessionRef }] });
      const value = (found.rows[0] as { session_id?: unknown } | undefined)?.session_id;
      return typeof value === "string" ? value : null;
    },
  };
}
