/** DEVELOPMENT ONLY. The mock's invitation, members, ceremony, Primary-transfer, step-up and notices routes (PK-8),
 * imported by `mock-server.ts` and the mock Next route, never by browser components.
 *
 * The state here is shared by every mock session (one per browser sign-in): an owner in one session invites, a
 * link holder in another resolves, verifies, signs in, attaches and accepts, and the owner confirms. The routes
 * speak the merged API's wire vocabulary (PR 361, PR 368, PR 355): the same uniform 404 envelope for every
 * unusable link or ceremony, the same `__Host-mp_invitation_ceremony` cookie (HttpOnly, Secure, SameSite=Strict,
 * Path=/), the same 403 pre-counter denial for a verify-channel naming no ceremony, the same bounded five
 * attempts with terminal exhaustion (SEC-PK6-F2), the same confirm vocabulary with `freshAssurance` and `next`,
 * and the same route-level party gate on the transfer rows (SEC-PK7B-F1). The step-up here issues its grant
 * without a chooser hop and navigates straight to `/budgets`, which is what the real callback also lands on.
 *
 * The approved disclosure texts are read from `docs/consent-disclosures/`, as the real registry serves them.
 */
import { randomUUID } from "node:crypto";
import invitationCollaborator from "../../../../docs/consent-disclosures/invitation-collaborator.v1.json" with { type: "json" };
import invitationCoOwner from "../../../../docs/consent-disclosures/invitation-co-owner.v1.json" with { type: "json" };
import type { ConsentDisclosure, InvitableRole, InvitationState, WireInvitation, WireMember, WireNotice, WireTransfer } from "./invitations.ts";
import { TRANSFER_ACTION } from "./invitations.ts";

export const CEREMONY_COOKIE = "__Host-mp_invitation_ceremony";
export const MAX_CHANNEL_ATTEMPTS = 5;
const NEUTRAL_DISPLAY_LABEL = "A MoneyPact member";
const UNIFORM = Object.freeze({ error: "invitation_unusable", messageCode: "MSG-73-003" });
const DENY = Object.freeze({ outcome: "deny", reason: "denied" });
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CEREMONY_LIFETIME_MS = 30 * 60 * 1000;
const TRANSFER_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const FRESH_ASSURANCE_WINDOW_MS = 300 * 1000;

interface MockMembership { membershipId: string; budgetSpaceId: string; accountSubjectId: string; role: "primary_owner" | "co_owner" | "collaborator"; status: "active" | "ended"; joinedAt: string; authorizationVersion: number }
interface MockInvitationRecord {
  invitationId: string; budgetSpaceId: string; destination: string; destinationMasked: string; proposedRole: InvitableRole; requiredPermission: "24" | "26";
  state: "pending" | "awaiting_confirmation" | "accepted" | "replaced" | "cancelled" | "declined" | "expired"; projection: InvitationState;
  issuedAt: string; inactiveAt: string; predecessorInvitationId: string | null; createdBySubjectId: string;
  code: string; challenge: string; codeDisposition: "active" | "consumed" | "invalidated";
  acceptedBySubjectId: string | null; confirmationId: string | null;
}
interface MockCeremony { ceremonyId: string; invitationId: string; secret: string; state: "open" | "invalidated" | "consumed"; proof: "challenged" | "proved" | "exhausted"; attempts: number; attachedSubjectId: string | null; expiresAt: string }
interface MockGrant { grantId: string; accountSubjectId: string; action: string; budgetSpaceId: string; expiresAt: string; consumed: boolean }
interface MockNoticeRow extends WireNotice { accountSubjectId: string }

/** Everything the invitation, members, transfer and notice routes share across mock sessions; `spaces` is the budget-space map every session reads. */
export interface MockDirectory<S = unknown> {
  readonly spaces: Map<string, S>;
  readonly names: Map<string, string>;
  readonly memberships: MockMembership[];
  readonly invitations: Map<string, MockInvitationRecord>;
  readonly ceremonies: Map<string, MockCeremony>;
  readonly transfers: Map<string, WireTransfer>;
  readonly receipts: Map<string, { invitationId: string; receipt: unknown }>;
  readonly grants: MockGrant[];
  readonly notices: MockNoticeRow[];
}
export function createMockDirectory<S = unknown>(): MockDirectory<S> {
  return { spaces: new Map(), names: new Map(), memberships: [], invitations: new Map(), ceremonies: new Map(), transfers: new Map(), receipts: new Map(), grants: [], notices: [] };
}
const shared = globalThis as typeof globalThis & { moneyPactMockDirectory?: MockDirectory };
/** The one directory every mock session in this Next server shares (the Next route keeps its sessions the same way). */
export function sharedMockDirectory<S = unknown>(): MockDirectory<S> {
  return (shared.moneyPactMockDirectory ??= createMockDirectory()) as MockDirectory<S>;
}

export function activeMembership(directory: MockDirectory, budgetSpaceId: string, accountSubjectId: string): MockMembership | undefined {
  return directory.memberships.find(row => row.budgetSpaceId === budgetSpaceId && row.accountSubjectId === accountSubjectId && row.status === "active");
}
/** Registers a freshly confirmed space with its Primary Owner membership, as the creation transaction does live. */
export function registerMockSpace(directory: MockDirectory, budgetSpaceId: string, name: string, accountSubjectId: string, membershipId: string, now: string): void {
  directory.names.set(budgetSpaceId, name);
  directory.memberships.push({ membershipId, budgetSpaceId, accountSubjectId, role: "primary_owner", status: "active", joinedAt: now, authorizationVersion: 1 });
}
/** `fresh` while an unconsumed, unexpired grant exists for the subject, as the fact source reports it; `session` otherwise. */
export function mockAssurance(directory: MockDirectory, accountSubjectId: string, now: number): "session" | "fresh" {
  return directory.grants.some(grant => grant.accountSubjectId === accountSubjectId && !grant.consumed && Date.parse(grant.expiresAt) > now) ? "fresh" : "session";
}

const DISCLOSURES: Readonly<Record<InvitableRole, ConsentDisclosure>> = Object.freeze({
  collaborator: { kind: invitationCollaborator.kind, version: invitationCollaborator.version, digest: "mock-invitation-collaborator-digest", text: { heading: invitationCollaborator.heading, items: invitationCollaborator.items, acknowledgement: invitationCollaborator.acknowledgement } },
  co_owner: { kind: invitationCoOwner.kind, version: invitationCoOwner.version, digest: "mock-invitation-co-owner-digest", text: { heading: invitationCoOwner.heading, items: invitationCoOwner.items, acknowledgement: invitationCoOwner.acknowledgement } },
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
function maskEmail(destination: string): string {
  const [local, domain] = destination.split("@");
  return `${local!.slice(0, 1)}***@${domain}`;
}
function projection(record: MockInvitationRecord): WireInvitation {
  return { invitationId: record.invitationId, destinationMasked: record.destinationMasked, proposedRole: record.proposedRole, state: record.projection, issuedAt: record.issuedAt, inactiveAt: record.inactiveAt, predecessorInvitationId: record.predecessorInvitationId };
}
function notice(directory: MockDirectory, accountSubjectId: string, budgetSpaceId: string | null, messageCode: string, at: string): void {
  directory.notices.push({ noticeId: randomUUID(), accountSubjectId, budgetSpaceId, messageCode, createdAt: at, readAt: null });
}
const noStore = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "content-type": "application/json", ...headers } });
}
function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("="); if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface MockSessionIdentity { accountSubjectId: string; csrf: string }

/**
 * The HTTP mapping of the PK-8 routes for one request. `session` is the resolved mock session or undefined (the
 * pre-authentication trio needs none) and `parsed` the JSON body the caller already read; the caller has applied the
 * origin and CSRF checks for an authenticated route exactly as `handleMockRequest` does, and this function applies
 * the trio's own origin rule.
 * Returns undefined for a path it does not own.
 */
export async function handleMockInvitationRequest(directory: MockDirectory, session: MockSessionIdentity | undefined, request: Request, path: string[], parsed: Record<string, unknown>, now: () => number = Date.now): Promise<Response | undefined> {
  const url = new URL(request.url);
  const at = () => new Date(now()).toISOString();
  const body = async () => parsed;
  const sameOrigin = () => request.headers.get("origin") === url.origin && request.headers.get("sec-fetch-site") !== "cross-site";
  const expireOnObservation = (record: MockInvitationRecord) => {
    if (record.state === "pending" && Date.parse(record.inactiveAt) <= now()) { record.state = "expired"; record.projection = "no_longer_active"; record.codeDisposition = "invalidated"; }
  };
  const loadCeremony = (ceremonyId: string): { ceremony: MockCeremony; invitation: MockInvitationRecord } | undefined => {
    const secret = cookieValue(request, CEREMONY_COOKIE);
    const ceremony = directory.ceremonies.get(ceremonyId);
    if (!ceremony || !secret || ceremony.secret !== secret || ceremony.state !== "open" || Date.parse(ceremony.expiresAt) <= now()) return undefined;
    const invitation = directory.invitations.get(ceremony.invitationId);
    if (!invitation) return undefined;
    expireOnObservation(invitation);
    if (invitation.state !== "pending" || invitation.codeDisposition !== "active") return undefined;
    return { ceremony, invitation };
  };

  // --- the pre-authentication trio ------------------------------------------------------------
  if (path[0] === "invitations" && request.method === "POST" && (path.length === 2 && path[1] === "resolve" || path.length === 3 && ["verify-channel", "decline"].includes(path[2]!))) {
    if (!sameOrigin()) return json({ error: "origin_rejected" }, 403);
    if (path[1] === "resolve") {
      const code = String((await body()).code ?? "").trim();
      const record = [...directory.invitations.values()].find(candidate => candidate.code === code);
      if (record) expireOnObservation(record);
      if (!record || record.state !== "pending" || record.codeDisposition !== "active") return json(UNIFORM, 404);
      for (const existing of directory.ceremonies.values()) if (existing.invitationId === record.invitationId && existing.state === "open") existing.state = "invalidated";
      const ceremony: MockCeremony = { ceremonyId: randomUUID(), invitationId: record.invitationId, secret: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""), state: "open", proof: "challenged", attempts: 0, attachedSubjectId: null, expiresAt: new Date(now() + CEREMONY_LIFETIME_MS).toISOString() };
      directory.ceremonies.set(ceremony.ceremonyId, ceremony);
      const seconds = Math.floor(CEREMONY_LIFETIME_MS / 1000);
      return json({ ceremonyId: ceremony.ceremonyId, ceremonyExpiresAt: ceremony.expiresAt, channelType: "email" }, 200, { "set-cookie": `${CEREMONY_COOKIE}=${ceremony.secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}` });
    }
    const ceremonyId = path[1]!;
    // The pre-counter gate (SEC-STAGES-F02 precedent): a ceremony id that names no row is denied before any counter.
    if (!UUID.test(ceremonyId) || !directory.ceremonies.has(ceremonyId.toLowerCase()) || !cookieValue(request, CEREMONY_COOKIE)) return json(DENY, 403);
    const loaded = loadCeremony(ceremonyId.toLowerCase());
    if (!loaded) return json(UNIFORM, 404);
    const { ceremony, invitation } = loaded;
    if (path[2] === "decline") {
      // TR-73-11: only the verified controller of the invited channel may decline; before proof the answer is the uniform envelope.
      if (ceremony.proof !== "proved") return json(UNIFORM, 404);
      invitation.state = "declined"; invitation.codeDisposition = "invalidated"; ceremony.state = "invalidated";
      return json(UNIFORM, 404);
    }
    if (ceremony.proof === "proved") return json({ outcome: "proved", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - ceremony.attempts });
    const presented = String((await body()).channelCode ?? "").trim();
    ceremony.attempts += 1;
    if (presented === invitation.challenge) { ceremony.proof = "proved"; return json({ outcome: "proved", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - ceremony.attempts }); }
    if (ceremony.attempts >= MAX_CHANNEL_ATTEMPTS) {
      // SEC-PK6-F2: exhaustion is terminal for the bearer. The code and the ceremony are gone; the inviter's record stays pending.
      ceremony.proof = "exhausted"; ceremony.state = "invalidated"; invitation.codeDisposition = "invalidated";
      return json({ error: "channel_attempts_exhausted", attemptsRemaining: 0 }, 400);
    }
    return json({ error: "channel_challenge_invalid", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - ceremony.attempts }, 400);
  }

  if (!session) return undefined;
  const subject = session.accountSubjectId;

  // --- the invitee's subject cells ------------------------------------------------------------
  if (path[0] === "invitations" && path.length >= 2) {
    const ceremonyId = path[1]!.toLowerCase();
    if (!UUID.test(ceremonyId)) return json(UNIFORM, 404);
    if (path.length === 3 && path[2] === "attach" && request.method === "POST") {
      const loaded = loadCeremony(ceremonyId);
      if (!loaded || loaded.ceremony.proof !== "proved") return json(UNIFORM, 404);
      if (loaded.ceremony.attachedSubjectId && loaded.ceremony.attachedSubjectId !== subject) return json(UNIFORM, 404);
      if (activeMembership(directory, loaded.invitation.budgetSpaceId, subject)) {
        // The private already-member cancel commits with the uniform outcome (R-01).
        loaded.invitation.state = "cancelled"; loaded.invitation.projection = "cancelled"; loaded.invitation.codeDisposition = "invalidated"; loaded.ceremony.state = "invalidated";
        return json(UNIFORM, 404);
      }
      loaded.ceremony.attachedSubjectId = subject;
      return json({ ceremonyId, attached: true });
    }
    const loaded = loadCeremony(ceremonyId);
    // An unattached or foreign ceremony is the boundary's uniform denial on these cells (PR 361).
    if (!loaded || loaded.ceremony.attachedSubjectId !== subject) return json(DENY, 403);
    if (path.length === 2 && request.method === "GET") {
      return json({ ceremonyId, proposedRole: loaded.invitation.proposedRole, resourceScope: "full", disclosure: structuredClone(DISCLOSURES[loaded.invitation.proposedRole]), twoWayNoticeCode: "MSG-73-016", confirmationNoticeCode: "MSG-73-051", expiresAt: loaded.ceremony.expiresAt, choice: { accept: false, decline: false } });
    }
    if (path.length === 3 && path[2] === "accept" && request.method === "POST") {
      if (loaded.ceremony.proof !== "proved") return json(UNIFORM, 404);
      const claim = (await body()).acknowledgedDisclosure as { kind?: unknown; version?: unknown } | undefined;
      const current = DISCLOSURES[loaded.invitation.proposedRole];
      if (claim?.kind !== current.kind || claim.version !== current.version) return json({ error: "stale_disclosure" }, 409);
      if (activeMembership(directory, loaded.invitation.budgetSpaceId, subject)) { loaded.invitation.state = "cancelled"; loaded.invitation.projection = "cancelled"; loaded.invitation.codeDisposition = "invalidated"; loaded.ceremony.state = "invalidated"; return json(UNIFORM, 404); }
      const confirmationId = randomUUID();
      loaded.invitation.state = "awaiting_confirmation"; loaded.invitation.acceptedBySubjectId = subject; loaded.invitation.confirmationId = confirmationId; loaded.invitation.codeDisposition = "consumed";
      loaded.ceremony.state = "consumed";
      notice(directory, loaded.invitation.createdBySubjectId, loaded.invitation.budgetSpaceId, "MSG-73-050", at());
      notice(directory, subject, null, "MSG-73-051", at());
      return json({ confirmationId, state: "awaiting_confirmation", confirmationExpiresAt: loaded.invitation.inactiveAt });
    }
    return json(UNIFORM, 404);
  }

  // --- the developer-only simulated delivery surface -------------------------------------------
  if (path.join("/") === "local/invitation-deliveries" && request.method === "GET") {
    const deliveries = [...directory.invitations.values()].filter(record => { expireOnObservation(record); return record.codeDisposition === "active"; })
      .map(record => ({ invitationId: record.invitationId, fidelityLabel: "simulated", destinationMasked: record.destinationMasked, code: record.code, channelChallenge: record.challenge, custodyDeadline: record.inactiveAt }));
    return json({ fidelityLabel: "simulated", deliveries });
  }

  // --- the step-up -------------------------------------------------------------------------------
  if (path.join("/") === "identity/step-up/begin" && request.method === "POST") {
    const fields = await body();
    if (fields.action !== TRANSFER_ACTION) return json({ error: "action_not_protected" }, 403);
    if (typeof fields.budgetSpaceId !== "string" || !activeMembership(directory, fields.budgetSpaceId, subject)) return json({ error: "space_not_permitted" }, 403);
    if (!["home", "budgets"].includes(String(fields.postResultDestinationId ?? "home"))) return json({ error: "destination_invalid" }, 400);
    for (const grant of directory.grants) if (grant.accountSubjectId === subject && grant.action === TRANSFER_ACTION && grant.budgetSpaceId === fields.budgetSpaceId && !grant.consumed) grant.consumed = true;
    const grant: MockGrant = { grantId: randomUUID(), accountSubjectId: subject, action: TRANSFER_ACTION, budgetSpaceId: fields.budgetSpaceId, expiresAt: new Date(now() + FRESH_ASSURANCE_WINDOW_MS).toISOString(), consumed: false };
    directory.grants.push(grant);
    return json({ navigateTo: fields.postResultDestinationId === "home" ? "/" : "/budgets", challengeId: randomUUID() });
  }

  // --- notices ------------------------------------------------------------------------------------
  if (path.join("/") === "notices" && request.method === "GET") {
    const rows = directory.notices.filter(row => row.accountSubjectId === subject).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(row => ({ noticeId: row.noticeId, budgetSpaceId: row.budgetSpaceId, messageCode: row.messageCode, createdAt: row.createdAt, readAt: row.readAt }));
    return json({ notices: rows });
  }

  if (path[0] !== "budget-spaces" || path.length < 3) return undefined;
  const budgetSpaceId = path[1]!;
  const acting = activeMembership(directory, budgetSpaceId, subject);

  // --- members --------------------------------------------------------------------------------------
  if (path[2] === "members" && path.length === 3 && request.method === "GET") {
    if (!acting) return json(DENY, 403);
    const members: WireMember[] = directory.memberships.filter(row => row.budgetSpaceId === budgetSpaceId && row.status === "active")
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.membershipId.localeCompare(b.membershipId))
      .map(row => ({ membershipId: row.membershipId, displayName: NEUTRAL_DISPLAY_LABEL, role: row.role, joinedAt: row.joinedAt }));
    return json({ budgetSpaceId, members });
  }

  // --- the owner's invitation routes ------------------------------------------------------------------
  if (path[2] === "invitations") {
    const owner = acting && (acting.role === "primary_owner" || acting.role === "co_owner") ? acting : undefined;
    if (!owner) return json(DENY, 403);
    const fields = await body();
    if (path.length === 3 && request.method === "GET") {
      const rows = [...directory.invitations.values()].filter(record => record.budgetSpaceId === budgetSpaceId);
      for (const record of rows) expireOnObservation(record);
      return json({ budgetSpaceId, invitations: rows.map(projection).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)) });
    }
    const issue = (destination: string, proposedRole: InvitableRole, predecessorInvitationId: string | null): MockInvitationRecord => {
      const issuedAt = at();
      const record: MockInvitationRecord = {
        invitationId: randomUUID(), budgetSpaceId, destination, destinationMasked: maskEmail(destination), proposedRole, requiredPermission: proposedRole === "co_owner" ? "26" : "24",
        state: "pending", projection: "pending", issuedAt, inactiveAt: new Date(now() + INVITATION_LIFETIME_MS).toISOString(), predecessorInvitationId, createdBySubjectId: subject,
        code: `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 11)}.${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
        challenge: String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"), codeDisposition: "active", acceptedBySubjectId: null, confirmationId: null,
      };
      directory.invitations.set(record.invitationId, record);
      return record;
    };
    if (path.length === 3 && request.method === "POST") {
      if (fields.channel !== "email") return json({ error: "invalid_request" }, 400);
      if (fields.proposedRole !== "collaborator" && fields.proposedRole !== "co_owner") return json({ error: "proposed_role_unsupported" }, 400);
      const destination = typeof fields.destination === "string" ? fields.destination.trim().toLowerCase() : "";
      if (!EMAIL.test(destination)) return json({ error: "destination_invalid" }, 400);
      if (typeof fields.idempotencyKey !== "string" || !fields.idempotencyKey) return json({ error: "invalid_request" }, 400);
      // The `26.*` cell is selected from the body's role before the decision: a Co-owner cannot invite a Co-owner.
      if (fields.proposedRole === "co_owner" && owner.role !== "primary_owner") return json(DENY, 403);
      return json({ invitation: projection(issue(destination, fields.proposedRole, null)) }, 201);
    }
    if (path.length < 4) return json({ error: "invitation_not_found" }, 404);
    const record = directory.invitations.get(path[3]!.toLowerCase());
    if (!record || record.budgetSpaceId !== budgetSpaceId) return json({ error: "invitation_not_found" }, 404);
    expireOnObservation(record);
    // TR-73-05 exact-permission rule: a Co-owner record needs permission 26, which only the Primary Owner holds.
    if (record.requiredPermission === "26" && owner.role !== "primary_owner") return json(DENY, 403);
    const invitee = () => record.acceptedBySubjectId;
    if (path.length === 5 && path[4] === "replace" && request.method === "POST") {
      if (record.state !== "pending") return json({ error: "invitation_not_current" }, 409);
      record.state = "replaced"; record.projection = "replaced"; record.codeDisposition = "invalidated";
      for (const ceremony of directory.ceremonies.values()) if (ceremony.invitationId === record.invitationId && ceremony.state === "open") ceremony.state = "invalidated";
      return json({ invitation: projection(issue(record.destination, record.proposedRole, record.invitationId)), supersededInvitationId: record.invitationId });
    }
    if (path.length === 4 && request.method === "DELETE") {
      if (record.state !== "pending" && record.state !== "awaiting_confirmation") return json({ error: "invitation_not_current" }, 409);
      record.state = "cancelled"; record.projection = "cancelled"; record.codeDisposition = "invalidated";
      return json({ invitation: projection(record) });
    }
    if (path.length === 5 && path[4] === "confirm" && request.method === "POST") {
      const key = typeof fields.confirmationIdempotencyKey === "string" ? fields.confirmationIdempotencyKey : "";
      if (!key) return json({ error: "invalid_request" }, 400);
      const replay = directory.receipts.get(key);
      if (replay) return replay.invitationId === record.invitationId ? json({ receipt: replay.receipt }) : json({ error: "idempotency_key_reused" }, 409);
      if (record.state !== "awaiting_confirmation" || !invitee()) return json({ error: "invitation_not_current" }, 409);
      const membershipId = randomUUID(); const committedAt = at();
      directory.memberships.push({ membershipId, budgetSpaceId, accountSubjectId: invitee()!, role: record.proposedRole, status: "active", joinedAt: committedAt, authorizationVersion: 1 });
      record.state = "accepted"; record.projection = "accepted";
      const receipt = { invitationId: record.invitationId, membershipId, consentId: randomUUID(), confirmationId: record.confirmationId, role: record.proposedRole, committedAt, projection: projection(record) };
      directory.receipts.set(key, { invitationId: record.invitationId, receipt });
      notice(directory, invitee()!, budgetSpaceId, "MSG-73-015", committedAt);
      for (const member of directory.memberships) if (member.budgetSpaceId === budgetSpaceId && member.status === "active" && member.accountSubjectId !== invitee() && member.accountSubjectId !== subject) notice(directory, member.accountSubjectId, budgetSpaceId, "MSG-73-019", committedAt);
      return json({ receipt });
    }
    if (path.length === 5 && path[4] === "reject" && request.method === "POST") {
      if (record.state !== "awaiting_confirmation" || !invitee()) return json({ error: "invitation_not_current" }, 409);
      record.state = "cancelled"; record.projection = "cancelled";
      notice(directory, invitee()!, null, "MSG-73-052", at());
      return json({ invitation: projection(record) });
    }
    return json({ error: "invitation_not_found" }, 404);
  }

  // --- the Primary-transfer routes ----------------------------------------------------------------------
  if (path[2] === "primary-transfers") {
    if (!acting) return json(DENY, 403);
    const fields = await body();
    const live = () => [...directory.transfers.values()].find(row => row.budgetSpaceId === budgetSpaceId && ["proposed", "recipient_accepted", "primary_confirmed", "ready"].includes(row.state));
    const expire = (row: WireTransfer) => { if (["proposed", "recipient_accepted", "primary_confirmed", "ready"].includes(row.state) && Date.parse(row.expiresAt) <= now()) { row.state = "expired"; row.stateVersion += 1; } };
    const denied = (reasonClass: string, status: number, extra: Record<string, unknown> = {}) => json({ error: reasonClass, messageCode: "MSG-73-046", ...extra }, status);
    if (path.length === 3 && request.method === "POST") {
      const recipient = typeof fields.recipientMembershipId === "string" && UUID.test(fields.recipientMembershipId) ? fields.recipientMembershipId.toLowerCase() : undefined;
      if (!recipient) return json({ error: "invalid_request" }, 400);
      if (acting.role !== "primary_owner") return json(DENY, 403);
      const target = directory.memberships.find(row => row.budgetSpaceId === budgetSpaceId && row.membershipId === recipient && row.status === "active");
      if (!target) return denied("recipient_ineligible", 409);
      if (target.membershipId === acting.membershipId) return denied("self_transfer", 409);
      const current = live(); if (current) expire(current);
      if (live()) return json({ error: "transfer_already_live", messageCode: "MSG-73-046" }, 409);
      const transfer: WireTransfer = {
        transferId: randomUUID(), budgetSpaceId, state: "proposed", stateVersion: 1, proposerMembershipId: acting.membershipId, recipientMembershipId: recipient,
        expiresAt: new Date(now() + TRANSFER_LIFETIME_MS).toISOString(), recipientAcceptedAt: null, primaryConfirmedAt: null, committedAt: null,
        recipientDisclosureKind: "primary_transfer_recipient", recipientDisclosureVersion: 1, outgoingDisclosureKind: "primary_transfer_outgoing", outgoingDisclosureVersion: 1,
      };
      directory.transfers.set(transfer.transferId, transfer);
      notice(directory, target.accountSubjectId, budgetSpaceId, "MSG-73-040", at());
      return json({ outcome: "proposed", messageCode: "MSG-73-040", transfer: structuredClone(transfer) }, 201);
    }
    if (path.length < 4 || !UUID.test(path[3]!)) return json({ error: "transfer_not_found" }, 404);
    const transfer = directory.transfers.get(path[3]!.toLowerCase());
    // SEC-PK7B-F1: a same-space member who is neither party is answered as an unknown identifier.
    if (!transfer || transfer.budgetSpaceId !== budgetSpaceId || (acting.membershipId !== transfer.proposerMembershipId && acting.membershipId !== transfer.recipientMembershipId)) return json({ error: "transfer_not_found" }, 404);
    expire(transfer);
    const isProposer = acting.membershipId === transfer.proposerMembershipId;
    const isLive = ["proposed", "recipient_accepted", "primary_confirmed", "ready"].includes(transfer.state);
    const partyOf = (membershipId: string) => directory.memberships.find(row => row.membershipId === membershipId)!;
    const commit = () => {
      const proposer = partyOf(transfer.proposerMembershipId); const recipient = partyOf(transfer.recipientMembershipId);
      proposer.role = "co_owner"; proposer.authorizationVersion += 1; recipient.role = "primary_owner"; recipient.authorizationVersion += 1;
      transfer.state = "committed"; transfer.stateVersion += 1; transfer.committedAt = at();
      // Every invitation the former Primary created under permission 26 is cancelled at commit (design section 10.3 step 6).
      for (const record of directory.invitations.values()) if (record.budgetSpaceId === budgetSpaceId && record.requiredPermission === "26" && record.state === "pending") { record.state = "cancelled"; record.projection = "cancelled"; record.codeDisposition = "invalidated"; }
      notice(directory, proposer.accountSubjectId, budgetSpaceId, "MSG-73-042", transfer.committedAt); notice(directory, recipient.accountSubjectId, budgetSpaceId, "MSG-73-042", transfer.committedAt);
      return { transferId: transfer.transferId, committedAt: transfer.committedAt, recipientConsentId: randomUUID(), outgoingConsentId: randomUUID() };
    };
    if (path.length === 4 && request.method === "GET") return json({ transfer: structuredClone(transfer) });
    if (path.length !== 5 || request.method !== "POST") return json({ error: "transfer_not_found" }, 404);
    const step = path[4]!;
    if (step === "confirm") {
      // The protected cell: the boundary spends the grant before the handler runs; without a fresh grant bound to this action and
      // space the decision is the uniform denial and nothing is consumed (PR 355, PR 368).
      const grant = directory.grants.find(row => row.accountSubjectId === subject && row.action === TRANSFER_ACTION && row.budgetSpaceId === budgetSpaceId && !row.consumed && Date.parse(row.expiresAt) > now());
      if (!isProposer || acting.role !== "primary_owner" || !grant) return json(DENY, 403);
      const current = live();
      // The store begins its ledger on the space's one live workflow whose recipient row is the decided target; otherwise the grant is returned.
      if (!current || current.recipientMembershipId !== transfer.recipientMembershipId) return json(DENY, 403);
      grant.consumed = true;
      const consumed = { freshAssurance: "consumed", next: "step_up_required" };
      // A confirm that reaches the module consumes the grant whatever it answers (SEC-PK7A-F6, finding 2 of PR 368).
      if (!isLive) return json({ error: "transfer_not_current", messageCode: "MSG-73-046", ...consumed }, 409);
      if (transfer.state === "recipient_accepted") { transfer.primaryConfirmedAt = at(); const receipt = commit(); return json({ outcome: "committed", messageCode: "MSG-73-042", transfer: structuredClone(transfer), receipt, freshAssurance: "consumed" }); }
      if (transfer.state === "proposed") { transfer.state = "primary_confirmed"; transfer.stateVersion += 1; transfer.primaryConfirmedAt = at(); return json({ outcome: "primary_confirmed", messageCode: "MSG-73-041", transfer: structuredClone(transfer), ...consumed }); }
      return json({ error: "transfer_not_current", messageCode: "MSG-73-046", ...consumed }, 409);
    }
    if (step === "accept" || step === "decline") {
      if (isProposer) return json(DENY, 403);
      if (!isLive) return denied("transfer_not_current", 409);
      if (step === "decline") { transfer.state = "declined"; transfer.stateVersion += 1; notice(directory, partyOf(transfer.proposerMembershipId).accountSubjectId, budgetSpaceId, "MSG-73-043", at()); return json({ outcome: "declined", messageCode: "MSG-73-043", transfer: structuredClone(transfer) }); }
      if (transfer.state === "primary_confirmed") { transfer.recipientAcceptedAt = at(); const receipt = commit(); return json({ outcome: "committed", messageCode: "MSG-73-042", transfer: structuredClone(transfer), receipt }); }
      if (transfer.state === "proposed") { transfer.state = "recipient_accepted"; transfer.stateVersion += 1; transfer.recipientAcceptedAt = at(); notice(directory, partyOf(transfer.proposerMembershipId).accountSubjectId, budgetSpaceId, "MSG-73-041", at()); return json({ outcome: "recipient_accepted", messageCode: "MSG-73-041", transfer: structuredClone(transfer) }); }
      return denied("transfer_not_current", 409);
    }
    if (step === "withdraw") {
      if (!isProposer) return json(DENY, 403);
      if (!isLive) return denied("transfer_not_current", 409);
      transfer.state = "withdrawn"; transfer.stateVersion += 1;
      notice(directory, partyOf(transfer.recipientMembershipId).accountSubjectId, budgetSpaceId, "MSG-73-044", at());
      return json({ outcome: "withdrawn", messageCode: "MSG-73-044", transfer: structuredClone(transfer) });
    }
    return json({ error: "transfer_not_found" }, 404);
  }
  return undefined;
}
