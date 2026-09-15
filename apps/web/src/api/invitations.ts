/**
 * PK-8 (INVITATIONS-DESIGN-001; CBD-234 design sections 5, 6, 9, 10.2, 13): the
 * web's transport for the merged PK-6 invitation and members routes (PR 361),
 * the PK-7B Primary-transfer routes (PR 368) and the PK-4 step-up (PR 355).
 *
 * A separate client on purpose: `client.ts` is another packet's file this
 * round. This one carries exactly the wire vocabulary those PRs published and
 * nothing the routes did not state, and its rules are the Security readings':
 *
 *   * The ceremony trio (resolve, verify-channel, decline) carries no CSRF
 *     header -- there is no session -- and is sent same-origin with
 *     `credentials: "same-origin"`, so the browser adds `Origin` and
 *     `Sec-Fetch-Site` and carries the `__Host-mp_invitation_ceremony` cookie
 *     the API set through the same-origin `/v1` proxy (first-party to this
 *     origin, as the session cookie is). Script never reads that cookie.
 *   * Every authenticated mutation echoes the bootstrap CSRF value in
 *     `X-CoBudget-CSRF`. The value is taken from the same-origin bootstrap body
 *     (`GET /identity/me`) and held only in this closure (CBD-191 section 5.1).
 *   * The disclosure surface's choice is `{ accept: false, decline: false }` as
 *     the API states it; nothing here or in a view pre-selects an answer.
 *   * Exhaustion of the six-digit challenge is terminal: the client reports it
 *     as its own outcome so a view never offers "resolve the link again" after
 *     it (SEC-PK6-F2).
 *   * Every unusable-link and unusable-ceremony class is the one uniform 404
 *     envelope and is reported as one outcome, `unusable`.
 *   * A confirm request names only the live transfer id read from the view and
 *     the disclosure claim (PK8-F03: the kind, version and digest of the
 *     approved text the view served, as `accept` sends the recipient's); it
 *     carries no assurance reference and no ledger. Every confirm answer's
 *     `freshAssurance` disposition and `next` hint are surfaced so a view can
 *     say "step up again" and never resend a confirm expecting a replay.
 */

// ---------------------------------------------------------------------------
// Wire shapes, as the merged routes publish them.
// ---------------------------------------------------------------------------

export type InvitableRole = "collaborator" | "co_owner";
export type InvitationState = "pending" | "awaiting_confirmation" | "accepted" | "replaced" | "cancelled" | "no_longer_active";
/** The customer projection of one invitation record; `kind`, private state and cause never leave the server. */
export interface WireInvitation {
  invitationId: string; destinationMasked: string; proposedRole: InvitableRole; state: InvitationState;
  issuedAt: string; inactiveAt: string; predecessorInvitationId: string | null;
}
export interface WireInvitationList { budgetSpaceId: string; invitations: readonly WireInvitation[] }
/** `TR-73-13`: the receipt the owner's confirm stores and replays. */
export interface WireAcceptanceReceipt {
  invitationId: string; membershipId: string; consentId: string; confirmationId: string; role: InvitableRole; committedAt: string; projection: WireInvitation;
}
export interface WireMember { membershipId: string; displayName: string; role: string; joinedAt: string }
export interface WireMemberList { budgetSpaceId: string; members: readonly WireMember[] }

/** `POST /v1/invitations/resolve`: the ceremony-entry minimum and nothing else. */
export interface WireCeremonyEntry { ceremonyId: string; ceremonyExpiresAt: string; channelType: string }
export interface ConsentDisclosureText { heading: string; items: readonly { id: string; text: string }[]; acknowledgement: string }
export interface ConsentDisclosure { kind: string; version: number; digest: string; text: ConsentDisclosureText }
/** `GET /v1/invitations/{ceremonyId}`: the section 6 disclosure with the no-default choice. */
export interface WireDisclosureView {
  ceremonyId: string; proposedRole: InvitableRole; resourceScope: "full"; disclosure: ConsentDisclosure;
  twoWayNoticeCode: string; confirmationNoticeCode: string; expiresAt: string;
  choice: { accept: boolean; decline: boolean };
}
export interface WireAcceptance { confirmationId: string; state: "awaiting_confirmation"; confirmationExpiresAt: string }

export type TransferState = "proposed" | "recipient_accepted" | "primary_confirmed" | "ready" | "committed" | "declined" | "withdrawn" | "expired" | "invalidated";
/** The status view either party reads (PR 368). Identifiers of the two parties only; never a reference, ledger or digest. */
export interface WireTransfer {
  transferId: string; budgetSpaceId: string; state: TransferState; stateVersion: number;
  proposerMembershipId: string; recipientMembershipId: string; expiresAt: string;
  recipientAcceptedAt: string | null; primaryConfirmedAt: string | null; committedAt: string | null;
  recipientDisclosureKind: string; recipientDisclosureVersion: number; outgoingDisclosureKind: string; outgoingDisclosureVersion: number;
}
/** `GET .../primary-transfers/{id}` (PK8-F03): the projection and each party's approved text at the captured kind, version and digest (null once the registry moved). */
export interface WireTransferDisclosures { recipient: ConsentDisclosure | null; outgoing: ConsentDisclosure | null }
export interface WireTransferView { transfer: WireTransfer; disclosures: WireTransferDisclosures }
/** The claim accept and confirm carry: exactly the registry identity of the text the person read, never a text or an assurance value. */
export interface TransferDisclosureClaim { kind: string; version: number; digest: string }
export const claimOf = (disclosure: ConsentDisclosure): TransferDisclosureClaim => ({ kind: disclosure.kind, version: disclosure.version, digest: disclosure.digest });
export type FreshAssuranceDisposition = "consumed" | "unspent";
export interface WireTransferAnswer {
  outcome: string; messageCode: string; transfer: WireTransfer; receipt?: unknown;
  freshAssurance?: FreshAssuranceDisposition; next?: string;
}

/** `GET /v1/notices`: the caller's own `account_lifecycle_notice` rows (design section 13), newest first; `POST /v1/notices/{id}/read` answers one. */
export interface WireNotice { noticeId: string; budgetSpaceId: string | null; messageCode: string; createdAt: string; readAt: string | null }
export interface WireNoticeList { notices: readonly WireNotice[] }

// ---------------------------------------------------------------------------
// Outcomes the views render.
// ---------------------------------------------------------------------------

/** One uniform outcome per unusable class: the view says "resolve the link again" and nothing more specific. */
export const UNIFORM_INVITATION_ERROR = "invitation_unusable";
export const UNIFORM_MESSAGE_CODE = "MSG-73-003";
export const STEP_UP_REQUIRED = "step_up_required";
export const TRANSFER_ACTION = "29.transfer_primary_ownership";

export class InvitationApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Readonly<Record<string, unknown>>;
  constructor(status: number, code: string, body: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.status = status; this.code = code; this.body = body;
  }
  /** The one 404 envelope every unusable link and ceremony answers (PR 361). */
  get uniform(): boolean { return this.status === 404 && this.code === UNIFORM_INVITATION_ERROR; }
  /** The boundary's uniform denial: not a member, not a party, or the assurance is not fresh or is bound elsewhere. */
  get denied(): boolean { return this.status === 403; }
}

export type VerifyOutcome =
  | { outcome: "proved"; attemptsRemaining: number }
  | { outcome: "retry"; attemptsRemaining: number }
  /** Terminal for this link: the code and the ceremony are gone; only the inviter's resend recovers it (SEC-PK6-F2). */
  | { outcome: "exhausted" }
  | { outcome: "unusable" };

export type ConfirmTransferOutcome =
  | { outcome: "committed"; transfer: WireTransfer }
  | { outcome: "primary_confirmed" | "ready"; transfer: WireTransfer }
  /** The grant was consumed by an answer other than the commit: the person runs the step-up again before trying again. */
  | { outcome: "step_up_again"; error: string; messageCode: string; transfer?: WireTransfer }
  /** The uniform 403: not the live workflow, not the Primary, or the assurance is not fresh or is bound elsewhere. The grant was returned. */
  | { outcome: "denied" }
  /** A rolled-back refusal (`freshAssurance: "unspent"`): the step-up need not be repeated for a corrected request. */
  | { outcome: "refused"; error: string; status: number };

/** The `MSG-73-*` codes the routes and notices carry, as prototype sentences (OI-73-004 gates the exact copy). */
export const MESSAGE_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  "MSG-73-003": "This invitation link cannot be used. If you were expecting an invitation, ask the person who invited you to send a new one.",
  "MSG-73-011": "Enter the six-digit code that was sent to the invited address.",
  "MSG-73-015": "You joined a budget space. It is listed with your budgets.",
  "MSG-73-016": "Existing members will see your display name, your role and the activity attributed to you. Your personal settings and your other budget spaces stay private.",
  "MSG-73-017": "Accepting or declining is your explicit choice. Nothing is chosen for you.",
  "MSG-73-019": "A new member joined one of your budget spaces.",
  "MSG-73-025": "An invitation you were part of is no longer active.",
  "MSG-73-027": "A primary-ownership transfer was closed because something it depended on changed. A new proposal is needed.",
  "MSG-73-040": "You have been proposed as the next Primary Owner of a budget space. Open the transfer to read what accepting means before you choose.",
  "MSG-73-041": "Your confirmation as Primary Owner was recorded for a transfer.",
  "MSG-73-042": "A primary-ownership transfer committed. The roles in that budget space changed.",
  "MSG-73-043": "A primary-ownership transfer was declined. Roles are unchanged.",
  "MSG-73-044": "A primary-ownership transfer was withdrawn. Roles are unchanged.",
  "MSG-73-045": "A primary-ownership transfer expired before it completed. Roles are unchanged.",
  "MSG-73-046": "That transfer step could not be taken. Nothing changed.",
  "MSG-73-050": "Someone accepted an invitation to one of your budget spaces. Review their display name and confirm or reject the acceptance.",
  "MSG-73-051": "Your acceptance was recorded. The person who invited you will see your display name and must confirm before anything is shared with you.",
  "MSG-73-052": "An acceptance you recorded did not complete. Nothing was shared.",
});
export function sentenceFor(messageCode: string): string {
  return MESSAGE_SENTENCES[messageCode] ?? "A budget space you belong to has an update.";
}

export const ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({ primary_owner: "Primary Owner", co_owner: "Co-owner", collaborator: "Collaborator" });
export function roleLabel(role: string): string { return ROLE_LABELS[role] ?? role; }
export const INVITATION_STATE_LABELS: Readonly<Record<InvitationState, string>> = Object.freeze({
  pending: "Sent, awaiting a response", awaiting_confirmation: "Acceptance awaiting your confirmation",
  accepted: "Accepted and confirmed", replaced: "Replaced by a newer invitation", cancelled: "Cancelled", no_longer_active: "No longer active",
});
export const TRANSFER_STATE_LABELS: Readonly<Record<TransferState, string>> = Object.freeze({
  proposed: "Proposed, awaiting the recipient", recipient_accepted: "Accepted by the recipient, awaiting the Primary Owner's confirmation",
  primary_confirmed: "Confirmed by the Primary Owner, awaiting the recipient", ready: "Ready to commit", committed: "Committed",
  declined: "Declined by the recipient", withdrawn: "Withdrawn by the Primary Owner", expired: "Expired", invalidated: "Closed because something changed",
});

/** The subject-self notices routes (PK8-F01): the caller's own rows and nothing else, on the `profile.read` cell. */
export const NOTICES_ROUTE = "/notices";
/** The `MSG-73-*` codes that name a Primary-ownership transfer: the notice's space link opens the transfer, not the dashboard. */
export const TRANSFER_MESSAGE_CODES: ReadonlySet<string> = new Set(["MSG-73-027", "MSG-73-040", "MSG-73-041", "MSG-73-042", "MSG-73-043", "MSG-73-044", "MSG-73-045"]);

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export interface InvitationsClient {
  /** The current session's bootstrap, or null when signed out; captures the CSRF value for the mutations below. */
  session(signal?: AbortSignal): Promise<{ accountSubjectId: string; assurance: "session" | "fresh" } | null>;
  // Owner routes (PR 361).
  createInvitation(spaceId: string, draft: { destination: string; proposedRole: InvitableRole }, idempotencyKey: string): Promise<WireInvitation>;
  listInvitations(spaceId: string, signal?: AbortSignal): Promise<readonly WireInvitation[]>;
  replaceInvitation(spaceId: string, invitationId: string, mode: "resend" | "replace"): Promise<WireInvitation>;
  cancelInvitation(spaceId: string, invitationId: string): Promise<WireInvitation>;
  confirmAcceptance(spaceId: string, invitationId: string, confirmationIdempotencyKey: string): Promise<WireAcceptanceReceipt>;
  rejectAcceptance(spaceId: string, invitationId: string): Promise<WireInvitation>;
  listMembers(spaceId: string, signal?: AbortSignal): Promise<readonly WireMember[]>;
  /** The caller's own membership id in the space, from `GET /v1/budget-spaces` (membership.list_own); null when not a member. */
  ownMembership(spaceId: string, signal?: AbortSignal): Promise<string | null>;
  // The ceremony (pre-authentication trio, then the subject cells).
  resolve(code: string): Promise<WireCeremonyEntry | { outcome: "unusable" }>;
  verifyChannel(ceremonyId: string, channelCode: string): Promise<VerifyOutcome>;
  decline(ceremonyId: string): Promise<void>;
  attach(ceremonyId: string): Promise<"attached" | "unusable">;
  readCeremony(ceremonyId: string, signal?: AbortSignal): Promise<WireDisclosureView>;
  accept(ceremonyId: string, acknowledgedDisclosure: { kind: string; version: number }): Promise<WireAcceptance | { outcome: "unusable" }>;
  /** `POST /v1/identity/begin` for the invitee who has no session yet; the answer is the provider navigation. */
  beginSignIn(): Promise<string>;
  // Primary transfer (PR 368) and the step-up (PR 355).
  proposeTransfer(spaceId: string, recipientMembershipId: string): Promise<WireTransferAnswer>;
  viewTransfer(spaceId: string, transferId: string, signal?: AbortSignal): Promise<WireTransferView>;
  /** PK8-F04: the space's one live transfer for its two parties; null when there is none or the caller is neither party (the one 404). */
  liveTransfer(spaceId: string, signal?: AbortSignal): Promise<WireTransferView | null>;
  /** `TR-73-41` with the recipient disclosure's claim; a claim that is not the captured one is thrown as 409 `stale_disclosure` (nothing written). */
  acceptTransfer(spaceId: string, transferId: string, acknowledgedDisclosure: TransferDisclosureClaim): Promise<WireTransferAnswer>;
  declineTransfer(spaceId: string, transferId: string): Promise<WireTransferAnswer>;
  withdrawTransfer(spaceId: string, transferId: string): Promise<WireTransferAnswer>;
  /** Binds a step-up to `29.transfer_primary_ownership` and the space; the answer is the provider navigation. */
  beginStepUp(spaceId: string): Promise<string>;
  /** Confirms exactly the transfer id given -- the caller reads it from the view immediately before -- with the outgoing disclosure's claim. */
  confirmTransfer(spaceId: string, transferId: string, acknowledgedDisclosure: TransferDisclosureClaim): Promise<ConfirmTransferOutcome>;
  // Notices (PK8-F01): the caller's own rows, newest first, and the set-once read stamp.
  listNotices(signal?: AbortSignal): Promise<readonly WireNotice[]>;
  markNoticeRead(noticeId: string): Promise<WireNotice>;
  clear(): void;
}

const CSRF_HEADER = "X-CoBudget-CSRF";

export function createInvitationsClient(base = "/v1", fetcher: typeof fetch = fetch): InvitationsClient {
  let csrf: string | undefined;
  const space = (id: string) => `/budget-spaces/${encodeURIComponent(id)}`;
  const ceremony = (id: string) => `/invitations/${encodeURIComponent(id)}`;
  async function send(path: string, method: string, body: unknown, options: { csrf: boolean; signal?: AbortSignal; idempotency?: string }): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotency) headers["Idempotency-Key"] = options.idempotency;
    if (options.csrf) {
      if (!csrf) await bootstrap(options.signal);
      if (!csrf) throw new InvitationApiError(401, "unauthenticated");
      headers[CSRF_HEADER] = csrf;
    }
    const response = await fetcher(`${base}${path}`, {
      method, headers, credentials: "same-origin", cache: "no-store", ...(options.signal ? { signal: options.signal } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = response.status === 204 ? {} : await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, json };
  }
  function failure(answer: { status: number; json: Record<string, unknown> }): InvitationApiError {
    return new InvitationApiError(answer.status, typeof answer.json.error === "string" ? answer.json.error : "request_failed", answer.json);
  }
  /** GET (no CSRF) or an authenticated mutation (CSRF); a non-2xx is thrown as `InvitationApiError`. */
  async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, idempotency?: string): Promise<T> {
    const answer = await send(path, method, body, { csrf: method !== "GET", signal, idempotency });
    if (answer.status < 200 || answer.status >= 300) throw failure(answer);
    return answer.json as T;
  }
  /** The pre-authentication trio: same-origin, cookie-carried, no CSRF header (there is no session to bind one to). */
  async function trio(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    return send(path, "POST", body, { csrf: false });
  }
  async function bootstrap(signal?: AbortSignal): Promise<{ accountSubjectId: string; assurance: "session" | "fresh" } | null> {
    const answer = await send("/identity/me", "GET", undefined, { csrf: false, signal });
    if (answer.status === 401 || answer.status === 403) return null;
    if (answer.status !== 200) throw failure(answer);
    if (typeof answer.json.csrfValue === "string" && answer.json.csrfValue) csrf = answer.json.csrfValue;
    return { accountSubjectId: String(answer.json.accountSubjectId ?? ""), assurance: answer.json.assurance === "fresh" ? "fresh" : "session" };
  }
  const transferAnswer = (json: Record<string, unknown>) => json as unknown as WireTransferAnswer;
  /** Committed non-2xx transfer answers (denials, closures) carry the workflow vocabulary; they are thrown with their body. */
  async function transferMutation(path: string, body: unknown = {}): Promise<WireTransferAnswer> {
    const answer = await send(path, "POST", body, { csrf: true });
    if (answer.status >= 200 && answer.status < 300) return transferAnswer(answer.json);
    throw failure(answer);
  }

  return {
    session: bootstrap,
    createInvitation: async (spaceId, draft, idempotencyKey) =>
      (await request<{ invitation: WireInvitation }>(`${space(spaceId)}/invitations`, "POST", { channel: "email", destination: draft.destination.trim(), proposedRole: draft.proposedRole, idempotencyKey })).invitation,
    listInvitations: async (spaceId, signal) => (await request<WireInvitationList>(`${space(spaceId)}/invitations`, "GET", undefined, signal)).invitations,
    replaceInvitation: async (spaceId, invitationId, mode) =>
      (await request<{ invitation: WireInvitation }>(`${space(spaceId)}/invitations/${encodeURIComponent(invitationId)}/replace`, "POST", mode === "resend" ? { mode: "resend" } : {})).invitation,
    cancelInvitation: async (spaceId, invitationId) => (await request<{ invitation: WireInvitation }>(`${space(spaceId)}/invitations/${encodeURIComponent(invitationId)}`, "DELETE")).invitation,
    confirmAcceptance: async (spaceId, invitationId, confirmationIdempotencyKey) =>
      (await request<{ receipt: WireAcceptanceReceipt }>(`${space(spaceId)}/invitations/${encodeURIComponent(invitationId)}/confirm`, "POST", { confirmationIdempotencyKey })).receipt,
    rejectAcceptance: async (spaceId, invitationId) => (await request<{ invitation: WireInvitation }>(`${space(spaceId)}/invitations/${encodeURIComponent(invitationId)}/reject`, "POST", {})).invitation,
    listMembers: async (spaceId, signal) => (await request<WireMemberList>(`${space(spaceId)}/members`, "GET", undefined, signal)).members,
    ownMembership: async (spaceId, signal) => {
      const list = await request<{ spaces: readonly { budgetSpaceId: string; membershipId: string }[] }>("/budget-spaces", "GET", undefined, signal);
      return list.spaces.find(entry => entry.budgetSpaceId === spaceId)?.membershipId ?? null;
    },

    async resolve(code) {
      const answer = await trio("/invitations/resolve", { code: code.trim() });
      if (answer.status === 200 && typeof answer.json.ceremonyId === "string") return answer.json as unknown as WireCeremonyEntry;
      if (answer.status === 404) return { outcome: "unusable" };
      throw failure(answer);
    },
    async verifyChannel(ceremonyId, channelCode) {
      const answer = await trio(`${ceremony(ceremonyId)}/verify-channel`, { channelCode: channelCode.trim() });
      const remaining = typeof answer.json.attemptsRemaining === "number" ? answer.json.attemptsRemaining : 0;
      if (answer.status === 200 && answer.json.outcome === "proved") return { outcome: "proved", attemptsRemaining: remaining };
      if (answer.status === 400 && answer.json.error === "channel_challenge_invalid") return { outcome: "retry", attemptsRemaining: remaining };
      if (answer.status === 400 && answer.json.error === "channel_attempts_exhausted") return { outcome: "exhausted" };
      // The pre-counter gate's 403 for a ceremony that does not resolve, and the uniform 404, are both "this link cannot be used".
      if (answer.status === 404 || answer.status === 403) return { outcome: "unusable" };
      throw failure(answer);
    },
    async decline(ceremonyId) {
      // A successful decline answers the same uniform envelope as an unusable ceremony: the person learns only that the link is finished.
      const answer = await trio(`${ceremony(ceremonyId)}/decline`, {});
      if (answer.status === 404 || answer.status === 403 || answer.status === 200) return;
      throw failure(answer);
    },
    async attach(ceremonyId) {
      const answer = await send(`${ceremony(ceremonyId)}/attach`, "POST", {}, { csrf: true });
      if (answer.status === 200 && answer.json.attached === true) return "attached";
      if (answer.status === 404) return "unusable";
      throw failure(answer);
    },
    readCeremony: (ceremonyId, signal) => request<WireDisclosureView>(ceremony(ceremonyId), "GET", undefined, signal),
    async accept(ceremonyId, acknowledgedDisclosure) {
      const answer = await send(`${ceremony(ceremonyId)}/accept`, "POST", { acknowledgedDisclosure }, { csrf: true });
      if (answer.status === 200 && answer.json.state === "awaiting_confirmation") return answer.json as unknown as WireAcceptance;
      if (answer.status === 404) return { outcome: "unusable" };
      throw failure(answer);
    },
    async beginSignIn() {
      // A pre-authentication surface: no CSRF value exists yet, so it is sent same-origin without one, as the sign-in page does.
      // CBD-190 identity amendments proposal §3.2/§3.5: `invitation_ceremony` is a closed, server-validated
      // destination the API's post-result navigation resolves to `/invitation` directly -- no client-held
      // return marker is needed or kept.
      const answer = await trio("/identity/begin", { ceremony: "sign_in", postResultDestinationId: "invitation_ceremony" });
      if (answer.status === 200 && typeof answer.json.navigateTo === "string") return answer.json.navigateTo;
      throw failure(answer);
    },

    proposeTransfer: async (spaceId, recipientMembershipId) => {
      const answer = await send(`${space(spaceId)}/primary-transfers`, "POST", { recipientMembershipId }, { csrf: true });
      if (answer.status >= 200 && answer.status < 300) return transferAnswer(answer.json);
      throw failure(answer);
    },
    viewTransfer: (spaceId, transferId, signal) => request<WireTransferView>(`${space(spaceId)}/primary-transfers/${encodeURIComponent(transferId)}`, "GET", undefined, signal),
    async liveTransfer(spaceId, signal) {
      const answer = await send(`${space(spaceId)}/primary-transfers/live`, "GET", undefined, { csrf: false, signal });
      if (answer.status === 404 && answer.json.error === "transfer_not_found") return null;
      if (answer.status !== 200) throw failure(answer);
      return answer.json as unknown as WireTransferView;
    },
    acceptTransfer: (spaceId, transferId, acknowledgedDisclosure) => transferMutation(`${space(spaceId)}/primary-transfers/${encodeURIComponent(transferId)}/accept`, { acknowledgedDisclosure }),
    declineTransfer: (spaceId, transferId) => transferMutation(`${space(spaceId)}/primary-transfers/${encodeURIComponent(transferId)}/decline`),
    withdrawTransfer: (spaceId, transferId) => transferMutation(`${space(spaceId)}/primary-transfers/${encodeURIComponent(transferId)}/withdraw`),
    // CBD-190 identity amendments proposal §3.2/§3.3/§3.5: `budget_transfer` is a reserved destination key whose
    // path the API derives from the step-up challenge's own bound budget space, never from a client value; the
    // post-result navigation returns to this space's transfer page with no client-held return marker.
    beginStepUp: async (spaceId) => (await request<{ navigateTo: string }>("/identity/step-up/begin", "POST", { action: TRANSFER_ACTION, budgetSpaceId: spaceId, postResultDestinationId: "budget_transfer" })).navigateTo,
    async confirmTransfer(spaceId, transferId, acknowledgedDisclosure) {
      // The body carries the disclosure claim and nothing else: the assurance reference and the ledger are the store's, never the client's (SEC-PK7A-F2).
      const answer = await send(`${space(spaceId)}/primary-transfers/${encodeURIComponent(transferId)}/confirm`, "POST", { acknowledgedDisclosure }, { csrf: true });
      const body = answer.json;
      const transfer = body.transfer as WireTransfer | undefined;
      if (answer.status === 200 && body.outcome === "committed" && transfer) return { outcome: "committed", transfer };
      if (answer.status === 200 && (body.outcome === "primary_confirmed" || body.outcome === "ready") && transfer) return { outcome: body.outcome, transfer };
      if (answer.status === 403 && body.outcome === "deny") return { outcome: "denied" };
      if (body.freshAssurance === "consumed" || body.next === STEP_UP_REQUIRED) {
        return { outcome: "step_up_again", error: String(body.error ?? body.outcome ?? "not_committed"), messageCode: String(body.messageCode ?? "MSG-73-046"), ...(transfer ? { transfer } : {}) };
      }
      return { outcome: "refused", error: String(body.error ?? "request_failed"), status: answer.status };
    },

    listNotices: async (signal) => (await request<WireNoticeList>(NOTICES_ROUTE, "GET", undefined, signal)).notices ?? [],
    markNoticeRead: async (noticeId) => (await request<{ notice: WireNotice }>(`${NOTICES_ROUTE}/${encodeURIComponent(noticeId)}/read`, "POST", {})).notice,
    clear() { csrf = undefined; },
  };
}
