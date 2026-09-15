/**
 * PK-8 unit tests (PK8-02): the client's transport rules against a recording fetcher, and the whole invitation
 * ceremony and Primary transfer over the mock routes with two mock sessions sharing one directory, driven exactly
 * as two browsers on the same origin would drive them (a cookie jar per browser, the trio without a session).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvitationsClient, InvitationApiError, MESSAGE_SENTENCES, sentenceFor, TRANSFER_ACTION } from "./invitations.ts";
import type { WireCeremonyEntry, WireDisclosureView } from "./invitations.ts";
import { createMockDirectory, handleMockInvitationRequest, CEREMONY_COOKIE, MAX_CHANNEL_ATTEMPTS } from "./mock-invitations.ts";
import { createServerMock, handleMockRequest } from "./mock-server.ts";
import type { MockWire } from "./mock-server.ts";

const bootstrap = { accountSubjectId: "s", profileId: "p", identityBindingId: "b", sessionRef: "r", sessionVersion: 1, environmentId: "development", assurance: "session", csrfValue: "bootstrap-fixture" };

function recording(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = createInvitationsClient("/v1", (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return answer(url, init); }) as typeof fetch);
  const last = () => calls.at(-1)!;
  const headers = (call = last()) => call.init!.headers as Record<string, string>;
  const body = (call = last()) => JSON.parse(String(call.init!.body ?? "null"));
  return { api, calls, last, headers, body };
}

test("the ceremony trio is sent same-origin with the cookie and no CSRF header, and every answer class maps to one outcome", async () => {
  let answer: Response = Response.json({ ceremonyId: "c1", ceremonyExpiresAt: "2026-09-16T00:00:00Z", channelType: "email" });
  const { api, headers, body, last } = recording(() => answer);
  const entry = await api.resolve("  code-value  ");
  assert.deepEqual(entry, { ceremonyId: "c1", ceremonyExpiresAt: "2026-09-16T00:00:00Z", channelType: "email" });
  assert.equal(last().url, "/v1/invitations/resolve");
  assert.equal(last().init!.credentials, "same-origin", "the browser carries the first-party ceremony cookie and adds Origin and Sec-Fetch-Site");
  assert.equal(headers()["X-CoBudget-CSRF"], undefined, "no session, no CSRF header");
  assert.deepEqual(body(), { code: "code-value" });
  answer = Response.json({ error: "invitation_unusable", messageCode: "MSG-73-003" }, { status: 404 });
  assert.deepEqual(await api.resolve("x"), { outcome: "unusable" });
  answer = Response.json({ outcome: "proved", attemptsRemaining: 4 });
  assert.deepEqual(await api.verifyChannel("c1", " 123456 "), { outcome: "proved", attemptsRemaining: 4 });
  assert.deepEqual(body(), { channelCode: "123456" });
  assert.equal(headers()["X-CoBudget-CSRF"], undefined);
  answer = Response.json({ error: "channel_challenge_invalid", attemptsRemaining: 2 }, { status: 400 });
  assert.deepEqual(await api.verifyChannel("c1", "000000"), { outcome: "retry", attemptsRemaining: 2 });
  answer = Response.json({ error: "channel_attempts_exhausted", attemptsRemaining: 0 }, { status: 400 });
  assert.deepEqual(await api.verifyChannel("c1", "000000"), { outcome: "exhausted" }, "SEC-PK6-F2: exhaustion is its own terminal outcome");
  answer = Response.json({ outcome: "deny", reason: "denied" }, { status: 403 });
  assert.deepEqual(await api.verifyChannel("nope", "000000"), { outcome: "unusable" }, "the pre-counter gate's denial is 'this link cannot be used'");
  answer = Response.json({ error: "invitation_unusable", messageCode: "MSG-73-003" }, { status: 404 });
  await api.decline("c1");
  assert.equal(last().url, "/v1/invitations/c1/decline");
  assert.equal(headers()["X-CoBudget-CSRF"], undefined);
});

test("attach, read and accept carry the bootstrap CSRF value, accept sends only the disclosure claim, and the choice arrives with no default", async () => {
  const { api, headers, body, calls } = recording(url => {
    if (url.endsWith("/identity/me")) return Response.json(bootstrap);
    if (url.endsWith("/attach")) return Response.json({ ceremonyId: "c1", attached: true });
    if (url.endsWith("/accept")) return Response.json({ confirmationId: "k", state: "awaiting_confirmation", confirmationExpiresAt: "2026-09-16T00:00:00Z" });
    return Response.json({ ceremonyId: "c1", proposedRole: "collaborator", resourceScope: "full", disclosure: { kind: "invitation_collaborator", version: 1, digest: "d", text: { heading: "h", items: [], acknowledgement: "a" } }, twoWayNoticeCode: "MSG-73-016", confirmationNoticeCode: "MSG-73-051", expiresAt: "2026-09-16T00:00:00Z", choice: { accept: false, decline: false } });
  });
  assert.equal(await api.attach("c1"), "attached");
  assert.equal(calls[0].url, "/v1/identity/me", "the CSRF value is bootstrapped before the first mutation");
  assert.equal(headers(calls[1])["X-CoBudget-CSRF"], "bootstrap-fixture");
  assert.deepEqual(body(calls[1]), {});
  const view: WireDisclosureView = await api.readCeremony("c1");
  assert.deepEqual(view.choice, { accept: false, decline: false });
  const accepted = await api.accept("c1", { kind: view.disclosure.kind, version: view.disclosure.version });
  assert.equal("state" in accepted && accepted.state, "awaiting_confirmation");
  assert.deepEqual(body(), { acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 } });
  assert.equal(headers()["X-CoBudget-CSRF"], "bootstrap-fixture");
  assert.ok(!calls.some(call => JSON.stringify(call.init?.headers ?? {}).includes("Cookie")), "script never reads or sets the ceremony cookie");
});

test("the transfer confirm names only the transfer id, carries no reference, ledger or digest field, and every answer class is one outcome", async () => {
  let answer: Response = Response.json(bootstrap);
  const transfer = { transferId: "t1", budgetSpaceId: "sp", state: "committed", stateVersion: 3, proposerMembershipId: "m1", recipientMembershipId: "m2", expiresAt: "x", recipientAcceptedAt: "x", primaryConfirmedAt: "x", committedAt: "x", recipientDisclosureKind: "primary_transfer_recipient", recipientDisclosureVersion: 1, outgoingDisclosureKind: "primary_transfer_outgoing", outgoingDisclosureVersion: 1 };
  const { api, body, last, headers } = recording(() => answer);
  await api.session();
  answer = Response.json({ navigateTo: "/v1/identity/local/authorize?step-up" , challengeId: "ch" });
  assert.equal(await api.beginStepUp("sp"), "/v1/identity/local/authorize?step-up");
  assert.deepEqual(body(), { action: TRANSFER_ACTION, budgetSpaceId: "sp", postResultDestinationId: "budgets" }, "bound to the protected action and the space");
  assert.equal(headers()["X-CoBudget-CSRF"], "bootstrap-fixture", "the step-up begin is CSRF-checked like logout");
  answer = Response.json({ outcome: "committed", messageCode: "MSG-73-042", transfer, receipt: {}, freshAssurance: "consumed" });
  assert.deepEqual(await api.confirmTransfer("sp", "t1"), { outcome: "committed", transfer });
  assert.equal(last().url, "/v1/budget-spaces/sp/primary-transfers/t1/confirm");
  assert.deepEqual(body(), {}, "SEC-PK7A-F2: the body is empty; the reference and the ledger are the store's");
  for (const key of Object.keys(body())) assert.ok(!/reference|ledger|digest|assurance/iu.test(key));
  answer = Response.json({ error: "transfer_not_current", messageCode: "MSG-73-046", freshAssurance: "consumed", next: "step_up_required" }, { status: 409 });
  assert.deepEqual(await api.confirmTransfer("sp", "t1"), { outcome: "step_up_again", error: "transfer_not_current", messageCode: "MSG-73-046" }, "consumed plus step_up_required is 'step up again'");
  answer = Response.json({ outcome: "primary_confirmed", messageCode: "MSG-73-041", transfer: { ...transfer, state: "primary_confirmed" }, freshAssurance: "consumed", next: "step_up_required" });
  assert.equal((await api.confirmTransfer("sp", "t1")).outcome, "primary_confirmed");
  answer = Response.json({ outcome: "deny", reason: "denied" }, { status: 403 });
  assert.deepEqual(await api.confirmTransfer("sp", "t1"), { outcome: "denied" }, "the uniform 403 returned the grant");
  answer = Response.json({ error: "transfer_not_found", freshAssurance: "unspent" }, { status: 404 });
  assert.deepEqual(await api.confirmTransfer("sp", "t1"), { outcome: "refused", error: "transfer_not_found", status: 404 });
  answer = Response.json({ error: "transfer_not_found" }, { status: 404 });
  await assert.rejects(api.viewTransfer("sp", "t1"), (error: unknown) => error instanceof InvitationApiError && error.code === "transfer_not_found", "a non-party sees exactly what an unknown id answers");
});

test("every message code the routes and notices carry has a sentence", () => {
  for (const code of ["MSG-73-003", "MSG-73-011", "MSG-73-015", "MSG-73-016", "MSG-73-017", "MSG-73-019", "MSG-73-040", "MSG-73-041", "MSG-73-042", "MSG-73-043", "MSG-73-044", "MSG-73-045", "MSG-73-046", "MSG-73-050", "MSG-73-051", "MSG-73-052"]) assert.ok(MESSAGE_SENTENCES[code], code);
  assert.ok(sentenceFor("MSG-73-999").length > 0, "an unknown code still reads as a sentence, never as a code");
  for (const sentence of Object.values(MESSAGE_SENTENCES)) assert.ok(!/\b(?:partner|admin|monitor|guardian|real[- ]time)\b/iu.test(sentence), sentence);
});

// --- the whole ceremony and the transfer over the mock routes ------------------------------------------------------

/** One browser on the mock origin: its own cookie jar, its own mock session once signed in, the trio dispatched without one. */
function browser(directory: ReturnType<typeof createMockDirectory>, clock: () => number, origin = "http://localhost") {
  const jar = new Map<string, string>();
  let session: MockWire | undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input), origin);
    const headers = new Headers(init?.headers);
    headers.set("origin", origin); headers.set("sec-fetch-site", "same-origin");
    if (jar.size) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
    const request = new Request(target, { method: init?.method ?? "GET", headers, ...(init?.body === undefined ? {} : { body: init.body }) });
    const path = target.pathname.replace(/^\/v1\//, "").split("/");
    let response: Response;
    if (request.method === "POST" && path[0] === "invitations" && (path[1] === "resolve" || ["verify-channel", "decline"].includes(path[2] ?? ""))) {
      response = (await handleMockInvitationRequest(directory, undefined, request, path, await request.clone().json().catch(() => ({})), clock))!;
    } else if (request.method === "POST" && path.join("/") === "identity/begin") {
      // The directory type parameter is the mock's private space shape; the test shares the directory, not the shape.
      session = createServerMock(clock, directory as never);
      response = Response.json({ navigateTo: "/budgets" });
    } else if (!session) {
      response = Response.json({ outcome: "deny", reason: "denied" }, { status: 403 });
    } else response = await handleMockRequest(session, request, path);
    const cookie = response.headers.get("set-cookie");
    if (cookie) { const [pair] = cookie.split(";"); const index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
    return response;
  }) as typeof fetch;
  const api = createInvitationsClient("/v1", fetcher);
  return { api, jar, fetch: fetcher, subject: () => session?.subject() ?? null };
}

test("PK8-02 over the mock: invite, resolve with the cookie, exhaust a link terminally, resolve another, verify, sign in, attach, read the no-default choice, accept, confirm; the members list shows both", async () => {
  let now = Date.parse("2026-09-15T12:00:00Z");
  const clock = () => now;
  const directory = createMockDirectory();
  const owner = browser(directory, clock);
  await owner.api.beginSignIn();
  // A space with the owner as Primary Owner, through the mock's ordinary creation.
  const create = await owner.fetch("/v1/budget-creation-proposals", { method: "POST", headers: { "content-type": "application/json", "X-CoBudget-CSRF": await csrfOf(owner), "Idempotency-Key": "proposal-key-0000000001" }, body: JSON.stringify({ name: "Shared", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } }) });
  const proposal = await create.json();
  const confirmed = await (await owner.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { method: "POST", headers: { "content-type": "application/json", "X-CoBudget-CSRF": await csrfOf(owner), "Idempotency-Key": "confirm-key-00000000001" }, body: JSON.stringify({ confirmationBinding: proposal.confirmationBinding, acknowledgedDisclosure: { kind: "primary_owner_self", version: 1 } }) })).json();
  const spaceId: string = confirmed.budgetSpaceId;

  const first = await owner.api.createInvitation(spaceId, { destination: "Invitee@Example.com", proposedRole: "collaborator" }, "idem-1");
  assert.equal(first.destinationMasked, "i***@example.com"); assert.equal(first.state, "pending");
  assert.deepEqual(Object.keys(first).sort(), ["destinationMasked", "inactiveAt", "invitationId", "issuedAt", "predecessorInvitationId", "proposedRole", "state"]);
  const deliveries = await (await owner.fetch("/v1/local/invitation-deliveries")).json();
  const delivered = deliveries.deliveries.find((row: { invitationId: string }) => row.invitationId === first.invitationId);
  assert.match(delivered.channelChallenge, /^\d{6}$/u);

  // Exhaustion is terminal for the bearer: five wrong guesses, then the right code and a fresh resolve both answer the uniform outcome.
  const holder = browser(directory, clock);
  const entry = await holder.api.resolve(delivered.code) as WireCeremonyEntry;
  assert.ok(entry.ceremonyId);
  assert.ok(holder.jar.get(CEREMONY_COOKIE), "the ceremony cookie was delivered");
  const wrong = delivered.channelChallenge === "000000" ? "000001" : "000000";
  for (let attempt = 1; attempt < MAX_CHANNEL_ATTEMPTS; attempt++) assert.deepEqual(await holder.api.verifyChannel(entry.ceremonyId, wrong), { outcome: "retry", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - attempt });
  assert.deepEqual(await holder.api.verifyChannel(entry.ceremonyId, wrong), { outcome: "exhausted" });
  assert.deepEqual(await holder.api.verifyChannel(entry.ceremonyId, delivered.channelChallenge), { outcome: "unusable" }, "the correct code on the exhausted ceremony is uniform");
  assert.deepEqual(await holder.api.resolve(delivered.code), { outcome: "unusable" }, "a re-resolve of the same link opens no fresh ceremony");
  assert.equal((await owner.api.listInvitations(spaceId))[0]!.state, "pending", "the inviter's record stays pending; the recovery is a resend");

  // The resend issues a new link; the holder proves the channel, signs in, attaches, reads and accepts.
  const resent = await owner.api.replaceInvitation(spaceId, first.invitationId, "resend");
  assert.equal(resent.predecessorInvitationId, first.invitationId);
  const redelivered = (await (await owner.fetch("/v1/local/invitation-deliveries")).json()).deliveries.find((row: { invitationId: string }) => row.invitationId === resent.invitationId);
  const invitee = browser(directory, clock);
  const second = await invitee.api.resolve(redelivered.code) as WireCeremonyEntry;
  assert.deepEqual(await invitee.api.verifyChannel(second.ceremonyId, redelivered.channelChallenge), { outcome: "proved", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - 1 });
  assert.equal(await invitee.api.session(), null);
  await assert.rejects(invitee.api.readCeremony(second.ceremonyId), (error: unknown) => error instanceof InvitationApiError && error.denied, "no session: the subject cells deny");
  assert.equal(await invitee.api.beginSignIn(), "/budgets");
  assert.ok(invitee.jar.get(CEREMONY_COOKIE), "the ceremony cookie survives the sign-in");
  assert.equal(await invitee.api.attach(second.ceremonyId), "attached");
  const view = await invitee.api.readCeremony(second.ceremonyId);
  assert.equal(view.disclosure.kind, "invitation_collaborator");
  assert.ok(view.disclosure.text.items.length >= 5, "the approved text");
  assert.deepEqual(view.choice, { accept: false, decline: false });
  await assert.rejects(invitee.api.accept(second.ceremonyId, { kind: view.disclosure.kind, version: 2 }), (error: unknown) => error instanceof InvitationApiError && error.code === "stale_disclosure");
  const accepted = await invitee.api.accept(second.ceremonyId, { kind: view.disclosure.kind, version: view.disclosure.version });
  assert.equal("state" in accepted && accepted.state, "awaiting_confirmation");
  assert.equal((await invitee.api.listNotices()) !== "unavailable" && (await invitee.api.listNotices() as unknown as { messageCode: string }[]).some(row => row.messageCode === "MSG-73-051"), true);
  await assert.rejects(invitee.api.listMembers(spaceId), (error: unknown) => error instanceof InvitationApiError && error.denied, "not a member before the confirm");

  // The owner confirms; the receipt replays on the same key; both see the members list.
  const receipt = await owner.api.confirmAcceptance(spaceId, resent.invitationId, "confirm-1");
  assert.equal(receipt.role, "collaborator");
  assert.deepEqual(await owner.api.confirmAcceptance(spaceId, resent.invitationId, "confirm-1"), receipt);
  await assert.rejects(owner.api.confirmAcceptance(spaceId, resent.invitationId, "confirm-2"), (error: unknown) => error instanceof InvitationApiError && error.code === "invitation_not_current");
  assert.deepEqual((await owner.api.listMembers(spaceId)).map(member => member.role), ["primary_owner", "collaborator"]);
  assert.equal((await invitee.api.listMembers(spaceId)).length, 2);
  for (const member of await invitee.api.listMembers(spaceId)) assert.deepEqual(Object.keys(member).sort(), ["displayName", "joinedAt", "membershipId", "role"]);
  assert.equal((await invitee.api.listNotices() as unknown as { messageCode: string }[]).some(row => row.messageCode === "MSG-73-015"), true);
  assert.deepEqual(await invitee.api.resolve(redelivered.code), { outcome: "unusable" }, "the consumed link");
  now += 1000;

  // --- the Primary transfer with the step-up ------------------------------------------------------------------
  const ownMembership = await owner.api.ownMembership(spaceId); const inviteeMembership = await invitee.api.ownMembership(spaceId);
  assert.ok(ownMembership && inviteeMembership);
  await assert.rejects(invitee.api.proposeTransfer(spaceId, ownMembership!), (error: unknown) => error instanceof InvitationApiError && error.denied, "only the Primary proposes");
  const proposed = await owner.api.proposeTransfer(spaceId, inviteeMembership!);
  assert.equal(proposed.outcome, "proposed");
  const transferId = proposed.transfer.transferId;
  assert.deepEqual(await owner.api.confirmTransfer(spaceId, transferId), { outcome: "denied" }, "a confirm without a fresh grant is the uniform denial and consumes nothing");
  const stranger = browser(directory, clock); await stranger.api.beginSignIn();
  await assert.rejects(stranger.api.viewTransfer(spaceId, transferId), (error: unknown) => error instanceof InvitationApiError && error.denied, "a non-member is denied");
  assert.equal((await invitee.api.acceptTransfer(spaceId, transferId)).outcome, "recipient_accepted");
  assert.equal(await owner.api.beginStepUp(spaceId), "/budgets");
  assert.equal((await owner.api.session())!.assurance, "fresh");
  const live = await owner.api.viewTransfer(spaceId, transferId);
  const outcome = await owner.api.confirmTransfer(spaceId, live.transferId);
  assert.equal(outcome.outcome, "committed");
  assert.equal((await owner.api.session())!.assurance, "session", "one step-up, one committed effect");
  assert.deepEqual((await owner.api.listMembers(spaceId)).map(member => member.role).sort(), ["co_owner", "primary_owner"]);
  assert.deepEqual(await owner.api.confirmTransfer(spaceId, transferId), { outcome: "denied" }, "a former Primary confirming after the role change is denied");
  // A repeated confirm under a new grant on a terminal workflow whose recipient matches the live one: here there is no live one, so the grant is returned.
  await invitee.api.beginStepUp(spaceId);
  assert.deepEqual(await invitee.api.confirmTransfer(spaceId, transferId), { outcome: "denied" });
  assert.equal((await invitee.api.listNotices() as unknown as { messageCode: string }[]).filter(row => row.messageCode === "MSG-73-042").length, 1);
});

async function csrfOf(client: ReturnType<typeof browser>): Promise<string> {
  const me = await (await client.fetch("/v1/identity/me")).json();
  return me.csrfValue;
}
