/**
 * PK-6 route tests through the real Fastify instance, the real
 * `ApiAuthorizationBoundary`, the real fact assembler and the released
 * policy, over the PK-5 in-memory repository wrapped in a snapshot
 * transaction so commit and rollback are observable.
 *
 *   PK6-01  the thirteen routes exist with their cells, the partial order is
 *           enforced server-side, and every unusable class answers with one
 *           status and one envelope, byte for byte;
 *   PK6-02  the transaction contract (`PK5FIX-F01`): a wrong channel guess
 *           COMMITS its attempt increment and its `AE-73-09` row, a returned
 *           `unusable` COMMITS the private cancel, and a thrown
 *           `InvitationError` rolls the effect back; permission (`R-03`,
 *           `SEC-PK5-F02`), the environment key (`SEC-PK5-F03`) and the
 *           conflict mapping (`R-07`) are carried as the PK-5 results require;
 *   PK6-04  the local delivery surface exists only under the local provider.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { CURRENT_POLICY_VERSION, expectedProvenance, ordinaryFixture } from "@cobudget/contracts/authorization";
import type { PolicyInput, Role } from "@cobudget/contracts/authorization";
import type { DataAccessClient } from "@cobudget/data-access";
import { subjectFixture } from "../../../../packages/contracts/src/authorization/fixtures/index.ts";
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { InvitationError, MAX_CHANNEL_ATTEMPTS } from "../../../../packages/budget-application/src/invitations/index.ts";
import type { InvitationRepository } from "../../../../packages/budget-application/src/invitations/index.ts";
import { createLocalDeliveryAdapter } from "../../../../packages/budget-application/src/invitations/delivery.ts";
import type { InMemoryInvitationRepository } from "../../../../packages/budget-application/src/invitations/in-memory.ts";
import {
  INVITEE_PROFILE, INVITEE_SESSION, INVITEE_SUBJECT, OWNER_MEMBERSHIP, OWNER_SUBJECT, SPACE, testWorld,
} from "../../../../packages/budget-application/src/invitations/support.ts";
import { AppModule } from "../app.module.js";
import { RouteFailure } from "../authorization/http.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { INVITATION_CEREMONY_COOKIE_NAME } from "./cookie.ts";
import { InvitationsAuthorizationStore, UNIFORM_INVITATION_BODY, UNIFORM_INVITATION_STATUS, invitationsHttp } from "./http.ts";
import type { InvitationsHttpDependencies } from "./http.ts";
import type { InvitationScope } from "./persistence.ts";
import { localDeliveriesHttp } from "../local/http.ts";

const ENVIRONMENT = "env-local-1";
const ORIGIN = "http://localhost:3000";
const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "invitations-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const ROUTES = [
  "/v1/budget-spaces/:budgetSpaceId/invitations",
  "/v1/budget-spaces/:budgetSpaceId/invitations/:invitationId/replace",
  "/v1/budget-spaces/:budgetSpaceId/invitations/:invitationId",
  "/v1/budget-spaces/:budgetSpaceId/invitations/:invitationId/confirm",
  "/v1/budget-spaces/:budgetSpaceId/invitations/:invitationId/reject",
  "/v1/invitations/resolve",
  "/v1/invitations/:ceremonyId/verify-channel",
  "/v1/invitations/:ceremonyId/decline",
  "/v1/invitations/:ceremonyId/attach",
  "/v1/invitations/:ceremonyId",
  "/v1/invitations/:ceremonyId/accept",
  "/v1/local/invitation-deliveries",
];

/** An owner input for the space and membership the in-memory world seeds. The resource type comes from the route's operation. */
function ownerInput(role: Role = "primary_owner"): PolicyInput {
  const base = ordinaryFixture("24.invite_nonowner", role, CURRENT_POLICY_VERSION);
  const input = {
    ...base,
    subject: { ...base.subject, accountSubjectId: OWNER_SUBJECT },
    space: { ...base.space, spaceId: SPACE, primaryOwnerMembershipId: OWNER_MEMBERSHIP },
    membership: { ...base.membership, membershipId: OWNER_MEMBERSHIP },
    resource: { ...base.resource, owningSpaceId: SPACE },
    assurance: { ...base.assurance, boundSpaceId: SPACE },
  };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

/** The invitee's subject-scoped input: the ceremony row's owner is the invitee and its environment is the runtime's. */
function inviteeInput(action: string): PolicyInput {
  const base = subjectFixture(action, CURRENT_POLICY_VERSION);
  const input = {
    ...base,
    subject: { ...base.subject, accountSubjectId: INVITEE_SUBJECT },
    ...(base.resource ? { resource: { ...base.resource, owningSubjectId: INVITEE_SUBJECT, lifecycle: "open" } } : {}),
  };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

/**
 * A snapshot transaction over the in-memory repository: the work's writes are
 * kept when it returns and discarded when it throws, exactly the CBD-246
 * seam's contract, so the route-level commit/rollback claims are observable.
 */
function snapshotClient(repository: InMemoryInvitationRepository): DataAccessClient & { attempts: number } {
  type Snapshot = ReturnType<typeof take>;
  const take = () => ({
    invitations: new Map(repository.invitations), codes: new Map(repository.codes), ceremonies: new Map(repository.ceremonies),
    confirmations: new Map(repository.confirmations), outbox: new Map(repository.outbox), memberships: [...repository.memberships],
    consents: [...repository.consents], audits: [...repository.audits], securityEvents: [...repository.securityEvents], notices: [...repository.notices],
  });
  const restore = (s: Snapshot) => {
    for (const [name, map] of [["invitations", s.invitations], ["codes", s.codes], ["ceremonies", s.ceremonies], ["confirmations", s.confirmations], ["outbox", s.outbox]] as const) {
      const target = repository[name] as Map<string, unknown>; target.clear(); for (const [k, v] of map) target.set(k, v);
    }
    for (const name of ["memberships", "consents", "audits", "securityEvents", "notices"] as const) {
      const target = repository[name] as unknown[]; target.length = 0; target.push(...(s[name] as unknown[]));
    }
  };
  const tenantSelect = async (query: { table: string; budgetSpaceId: string; conditions?: { column: string; value: unknown }[] }) => {
    const where = (row: Record<string, unknown>) => (query.conditions ?? []).every((c) => row[c.column] === c.value);
    if (query.table === "budget_space_invitation") {
      return { rows: [...repository.invitations.values()].filter((r) => r.budgetSpaceId === query.budgetSpaceId)
        .map((r) => ({ invitation_id: r.invitationId, budget_space_id: r.budgetSpaceId, required_permission: r.requiredPermission, state: r.state, state_version: r.stateVersion })).filter(where) };
    }
    if (query.table === "budget_space_membership") {
      return { rows: repository.memberships.filter((r) => r.budgetSpaceId === query.budgetSpaceId)
        .map((r) => ({ membership_id: r.membershipId, account_subject_id: r.accountSubjectId, status: r.status, role: r.role, created_at: "2026-09-15T12:00:00.000Z" })).filter(where) };
    }
    return { rows: [] };
  };
  const client = {
    attempts: 0,
    transaction: async <T>(_options: unknown, work: (scoped: DataAccessClient) => Promise<T>): Promise<T> => {
      client.attempts++;
      const snapshot = take();
      try { return await work(client as unknown as DataAccessClient); }
      catch (error) { restore(snapshot); throw error; }
    },
    tenantSelect,
    platformSelect: async (query: { table: string }) => ({ rows: query.table === "account_session" ? [{ session_id: INVITEE_SESSION }] : [] }),
  };
  return client as unknown as DataAccessClient & { attempts: number };
}

async function application(options: {
  readonly repositoryFault?: (repository: InvitationRepository) => InvitationRepository;
  /** `R-02`: a fault injected around the trio's own transaction seam (the store path is untouched). */
  readonly clientFault?: (client: DataAccessClient) => DataAccessClient;
} = {}) {
  const world = testWorld();
  const repository = options.repositoryFault ? options.repositoryFault(world.repository) : world.repository;
  const deps = { ...world.deps, repository };
  const client = snapshotClient(world.repository);
  const trioClient = options.clientFault ? options.clientFault(client) : client;
  const delivery = createLocalDeliveryAdapter({
    read: async (invitationId) => { const row = world.repository.renderDelivery(invitationId); return row ? { invitationId, fidelityLabel: "simulated", destination: row.destination, bearer: row.bearer, challenge: row.challenge, custodyDeadline: world.repository.outbox.get(invitationId)!.custodyDeadline } : null; },
    listLive: async () => [...world.repository.outbox.keys()].map((id) => { const row = world.repository.renderDelivery(id); return row ? { invitationId: id, fidelityLabel: "simulated" as const, destination: row.destination, bearer: row.bearer, challenge: row.challenge, custodyDeadline: world.repository.outbox.get(id)!.custodyDeadline } : null; }).filter((row): row is NonNullable<typeof row> => row !== null),
    markRendered: async () => undefined,
    tombstone: async (invitationId, reason, at) => world.repository.tombstoneOutbox(invitationId, reason, at),
  }, world.clock);
  const scope: InvitationScope = { deps, delivery, listInvitationIds: async (budgetSpaceId) => [...world.repository.invitations.values()].filter((r) => r.budgetSpaceId === budgetSpaceId).map((r) => r.invitationId) };
  const store = new InvitationsAuthorizationStore(client);

  // The boundary harness: constructed with a subject fixture so the runtime environment is stamped; `h.input` is swapped per actor below.
  const h = new Harness(inviteeInput("invitation.attach"));
  const discharge = h.store.discharge.bind(h.store);
  // The production ApiTransactionStore discharges bind_cache_key for the read cells (RC-05); the invitation store discharges the invitation cells' obligations.
  h.store.discharge = async (transaction, input, obligation) => obligation.kind === "bind_cache_key" || await store.discharge(transaction, input, obligation) || discharge(transaction, input, obligation);
  const harnessTransaction = h.store.transaction.bind(h.store);
  // The invitation store owns the transaction (snapshot commit/rollback, RouteFailure returned, conflict retried); the harness records the allow audit inside it.
  h.store.transaction = (work) => store.transaction(() => harnessTransaction(work));
  store.observe({ committed: () => undefined, rolledBack: () => undefined });

  const dependencies: InvitationsHttpDependencies = {
    within: () => scope, client: trioClient, environmentId: ENVIRONMENT, applicationOrigin: ORIGIN, now: () => new Date(world.clock.now()),
    membership: async (subject, budgetSpaceId) => world.repository.memberships.find((m) => m.accountSubjectId === subject && m.budgetSpaceId === budgetSpaceId && m.status === "active")?.membershipId ?? null,
    requiredPermission: async (budgetSpaceId, invitationId) => { const r = world.repository.invitations.get(invitationId); return r && r.budgetSpaceId === budgetSpaceId ? r.requiredPermission : null; },
    subjectForDestination: async () => null,
    sessionRowId: async () => INVITEE_SESSION,
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      modules: [invitationsHttp(dependencies).module, localDeliveriesHttp({ adapterKind: "local", within: () => scope, now: () => new Date(world.clock.now()) }).module],
      boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true,
      rateLimit: {
        evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"),
        enforce: async (request) => ROUTES.includes(request.routeOptions.url!) ? { outcome: "allow", provenance: "test-only", release: async () => undefined } : { outcome: "deny_unregistered" },
      },
      sessionLocator: (request) => request.headers.cookie,
      deny: (response) => { throw new HttpException(response, 403); },
    }, testHistory)],
  }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await app.init(); await app.getHttpAdapter().getInstance().ready();

  const asOwner = (role: Role = "primary_owner") => { h.input = ownerInput(role); };
  const asInvitee = (action: string) => { h.input = inviteeInput(action); };
  const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }), headers: { cookie: "opaque", ...headers } });
  const ceremonyHeaders = (secret: string | undefined, extra: Record<string, string> = {}) => ({ origin: ORIGIN, "sec-fetch-site": "same-origin", ...(secret ? { cookie: `opaque; ${INVITATION_CEREMONY_COOKIE_NAME}=${secret}` } : {}), ...extra });
  const cookieOf = (setCookie: unknown): string => {
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.equal(typeof raw, "string", "a set-cookie header");
    const [pair, ...attributes] = String(raw).split(";").map((part) => part.trim());
    assert.equal(pair!.split("=")[0], INVITATION_CEREMONY_COOKIE_NAME);
    for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict"]) assert.ok(attributes.includes(attribute), attribute);
    return pair!.split("=")[1]!;
  };

  /** The whole ceremony to the point named. */
  async function ceremony(upTo: "create" | "resolve" | "verify" | "attach" | "accept", role: "collaborator" | "co_owner" = "collaborator") {
    asOwner();
    const created = await call("POST", `/v1/budget-spaces/${SPACE}/invitations`, { channel: "email", destination: "Invitee@Example.com", proposedRole: role, idempotencyKey: "k-1" });
    assert.equal(created.statusCode, 201, created.body);
    const invitationId = created.json().invitation.invitationId as string;
    const delivery = world.delivery(invitationId);
    if (upTo === "create") return { invitationId, delivery, ceremonyId: "", secret: "" };
    const resolved = await call("POST", "/v1/invitations/resolve", { code: delivery.bearer }, ceremonyHeaders(undefined));
    assert.equal(resolved.statusCode, 200, resolved.body);
    const ceremonyId = resolved.json().ceremonyId as string;
    const secret = cookieOf(resolved.headers["set-cookie"]);
    if (upTo === "resolve") return { invitationId, delivery, ceremonyId, secret };
    const proved = await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: delivery.challenge }, ceremonyHeaders(secret));
    assert.equal(proved.statusCode, 200, proved.body);
    if (upTo === "verify") return { invitationId, delivery, ceremonyId, secret };
    asInvitee("invitation.attach");
    const attached = await call("POST", `/v1/invitations/${ceremonyId}/attach`, {}, ceremonyHeaders(secret));
    assert.equal(attached.statusCode, 200, attached.body);
    if (upTo === "attach") return { invitationId, delivery, ceremonyId, secret };
    asInvitee("invitation.accept");
    const accepted = await call("POST", `/v1/invitations/${ceremonyId}/accept`, { acknowledgedDisclosure: { kind: role === "co_owner" ? "invitation_co_owner" : "invitation_collaborator", version: 1 } }, ceremonyHeaders(secret));
    assert.equal(accepted.statusCode, 200, accepted.body);
    return { invitationId, delivery, ceremonyId, secret, confirmationId: accepted.json().confirmationId as string };
  }

  return { app, h, world, client, call, ceremony, asOwner, asInvitee, ceremonyHeaders, cookieOf };
}

describe("PK-6 invitation routes through the real Fastify instance", () => {
  it("PK6-01: the whole ceremony -- owner creates, link holder resolves, verifies, signs in and attaches, reads the disclosure, accepts, owner confirms -- and the membership and consent rows exist", async () => {
    const { app, world, call, ceremony, asOwner, asInvitee, ceremonyHeaders } = await application();
    try {
      const { invitationId, ceremonyId, secret, delivery, confirmationId } = await ceremony("attach");
      // The disclosure surface, on the subject-target cell through the real assembler.
      asInvitee("invitation.read_ceremony");
      const view = await call("GET", `/v1/invitations/${ceremonyId}`, undefined, ceremonyHeaders(secret));
      assert.equal(view.statusCode, 200, view.body);
      assert.equal(view.json().proposedRole, "collaborator");
      assert.equal(view.json().disclosure.kind, "invitation_collaborator");
      assert.equal(view.json().confirmationNoticeCode, "MSG-73-051");
      assert.deepEqual(view.json().choice, { accept: false, decline: false }, "CBD-73 section 7.2 item 8: no default");
      assert.equal(JSON.stringify(view.json()).includes("example.com"), false, "the invitee sees no destination");
      void confirmationId;
      asInvitee("invitation.accept");
      const accepted = await call("POST", `/v1/invitations/${ceremonyId}/accept`, { acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 } }, ceremonyHeaders(secret));
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().state, "awaiting_confirmation");
      assert.equal(world.repository.invitations.get(invitationId)?.state, "awaiting_confirmation");

      // The owner's projection list shows one pending chain and nothing private.
      asOwner();
      const listed = await call("GET", `/v1/budget-spaces/${SPACE}/invitations`);
      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(listed.json().invitations.length, 1);
      assert.deepEqual(Object.keys(listed.json().invitations[0]).sort(), ["destinationMasked", "inactiveAt", "invitationId", "issuedAt", "predecessorInvitationId", "proposedRole", "state"]);
      assert.equal(listed.json().invitations[0].destinationMasked, "i***@example.com");

      const confirmed = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${invitationId}/confirm`, { confirmationIdempotencyKey: "c-1" });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      const receipt = confirmed.json().receipt;
      assert.equal(receipt.role, "collaborator");
      assert.equal(world.repository.memberships.filter((m) => m.accountSubjectId === INVITEE_SUBJECT && m.status === "active").length, 1, "one active membership");
      assert.equal(world.repository.consents.length, 1, "one consent row");
      assert.equal(world.repository.consents[0]!.recordedBySubjectId, INVITEE_SUBJECT);
      assert.equal(world.repository.consents[0]!.sourceCeremonyId, ceremonyId);
      assert.equal(world.repository.invitations.get(invitationId)?.state, "accepted");
      // Idempotent on the key: the same request returns the stored receipt.
      const replayed = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${invitationId}/confirm`, { confirmationIdempotencyKey: "c-1" });
      assert.equal(replayed.statusCode, 200); assert.deepEqual(replayed.json(), confirmed.json());
      assert.equal(world.repository.memberships.filter((m) => m.accountSubjectId === INVITEE_SUBJECT).length, 1);
      // The consumed link is unusable, with the uniform answer.
      const again = await call("POST", "/v1/invitations/resolve", { code: delivery.bearer }, ceremonyHeaders(undefined));
      assert.equal(again.statusCode, UNIFORM_INVITATION_STATUS); assert.deepEqual(again.json(), UNIFORM_INVITATION_BODY);
    } finally { await app.close(); }
  });

  it("PK6-01: every unusable-link and ceremony class answers byte-identically, including an out-of-order step and a decline", async () => {
    const { app, world, call, ceremony, asInvitee, ceremonyHeaders } = await application();
    try {
      const expected = { status: UNIFORM_INVITATION_STATUS, body: JSON.stringify(UNIFORM_INVITATION_BODY) };
      const answers: Record<string, { status: number; body: string }> = {};
      const record = (name: string, response: { statusCode: number; body: string }) => { answers[name] = { status: response.statusCode, body: response.body }; };

      record("unknown code", await call("POST", "/v1/invitations/resolve", { code: "not-a-code" }, ceremonyHeaders(undefined)));
      record("empty code", await call("POST", "/v1/invitations/resolve", {}, ceremonyHeaders(undefined)));
      const fresh = await ceremony("resolve");
      record("wrong cookie on verify", await call("POST", `/v1/invitations/${fresh.ceremonyId}/verify-channel`, { channelCode: fresh.delivery.challenge }, ceremonyHeaders("0123456789abcdef0123456789abcdef")));
      record("missing cookie on decline", await call("POST", `/v1/invitations/${fresh.ceremonyId}/decline`, {}, ceremonyHeaders(undefined)));
      record("unknown ceremony", await call("POST", `/v1/invitations/${"00000000-0000-4000-8000-00000000ffff"}/decline`, {}, ceremonyHeaders(fresh.secret)));
      record("malformed ceremony id", await call("POST", "/v1/invitations/not-a-ceremony/decline", {}, ceremonyHeaders(fresh.secret)));
      // Out of order (section 5.2): decline and attach before the channel is proved.
      record("decline before proof", await call("POST", `/v1/invitations/${fresh.ceremonyId}/decline`, {}, ceremonyHeaders(fresh.secret)));
      asInvitee("invitation.attach");
      record("attach before proof", await call("POST", `/v1/invitations/${fresh.ceremonyId}/attach`, {}, ceremonyHeaders(fresh.secret)));
      assert.equal(world.repository.ceremonies.get(fresh.ceremonyId)?.state, "open", "an out-of-order request changes nothing");
      // A newer resolve invalidates the earlier ceremony (a leaked link cannot ride an in-progress ceremony).
      const newer = await call("POST", "/v1/invitations/resolve", { code: fresh.delivery.bearer }, ceremonyHeaders(undefined));
      assert.equal(newer.statusCode, 200);
      record("invalidated by a newer resolve", await call("POST", `/v1/invitations/${fresh.ceremonyId}/verify-channel`, { channelCode: fresh.delivery.challenge }, ceremonyHeaders(fresh.secret)));
      // A successful decline answers the same envelope.
      const declined = await ceremony("verify");
      record("decline (success)", await call("POST", `/v1/invitations/${declined.ceremonyId}/decline`, {}, ceremonyHeaders(declined.secret)));
      assert.equal(world.repository.invitations.get(declined.invitationId)?.state, "declined", "the decline committed");
      record("declined link", await call("POST", "/v1/invitations/resolve", { code: declined.delivery.bearer }, ceremonyHeaders(undefined)));
      // Cancelled and superseded links.
      const cancelled = await ceremony("create");
      assert.equal((await call("DELETE", `/v1/budget-spaces/${SPACE}/invitations/${cancelled.invitationId}`)).statusCode, 200);
      record("cancelled link", await call("POST", "/v1/invitations/resolve", { code: cancelled.delivery.bearer }, ceremonyHeaders(undefined)));
      const replaced = await ceremony("create");
      const successor = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${replaced.invitationId}/replace`, { mode: "resend" });
      assert.equal(successor.statusCode, 201, successor.body);
      assert.equal(successor.json().supersededInvitationId, replaced.invitationId);
      record("superseded link", await call("POST", "/v1/invitations/resolve", { code: replaced.delivery.bearer }, ceremonyHeaders(undefined)));
      // Expired by timestamp.
      const expired = await ceremony("create");
      world.clock.advanceSeconds(8 * 24 * 60 * 60);
      record("expired link", await call("POST", "/v1/invitations/resolve", { code: expired.delivery.bearer }, ceremonyHeaders(undefined)));
      assert.equal(world.repository.invitations.get(expired.invitationId)?.state, "expired", "TR-73-07 materialized on observation");

      for (const [name, answer] of Object.entries(answers)) assert.deepEqual(answer, expected, name);
      assert.ok(Object.keys(answers).length >= 14);
    } finally { await app.close(); }
  });

  it("PK6-02 (PK5FIX-F01, SEC-PK6-F2): a wrong channel guess COMMITS its attempt increment and its AE-73-09 row; exhaustion is permanent and terminal for the bearer", async () => {
    const { app, world, call, ceremony, ceremonyHeaders } = await application();
    try {
      const { invitationId, ceremonyId, secret, delivery } = await ceremony("resolve");
      const auditsBefore = world.repository.audits.filter((row) => row.eventCode === "AE-73-09").length;
      const wrong = await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: "000000" === delivery.challenge ? "000001" : "000000" }, ceremonyHeaders(secret));
      assert.equal(wrong.statusCode, 400, wrong.body);
      assert.deepEqual(wrong.json(), { error: "channel_challenge_invalid", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - 1 });
      assert.equal(world.repository.ceremonies.get(ceremonyId)?.channelAttempts, 1, "the increment survived the route's transaction");
      assert.equal(world.repository.audits.filter((row) => row.eventCode === "AE-73-09").length, auditsBefore + 1, "the AE-73-09 row survived");
      assert.equal(world.repository.audits.at(-1)?.reasonClass, "channel_challenge_invalid");
      for (let attempt = 2; attempt < MAX_CHANNEL_ATTEMPTS; attempt++) {
        assert.equal((await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: "999999" }, ceremonyHeaders(secret))).statusCode, 400);
      }
      const last = await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: "999999" }, ceremonyHeaders(secret));
      assert.deepEqual(last.json(), { error: "channel_attempts_exhausted", attemptsRemaining: 0 });
      assert.equal(world.repository.ceremonies.get(ceremonyId)?.channelProofState, "exhausted");
      // SEC-PK6-F2: exhaustion is terminal for the bearer. The exhausting guess COMMITTED the code's
      // invalidation with the ceremony's, so the correct code answers the uniform envelope on this
      // ceremony, and a re-resolve of the same link cannot open a fresh ceremony bound to the same digits.
      assert.equal(world.repository.ceremonies.get(ceremonyId)?.state, "invalidated");
      assert.equal(world.repository.codes.get(invitationId)?.disposition, "invalidated");
      assert.equal(world.repository.codes.get(invitationId)?.dispositionReasonClass, "channel_attempts_exhausted");
      const correct = await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: delivery.challenge }, ceremonyHeaders(secret));
      assert.equal(correct.statusCode, 404);
      assert.deepEqual(correct.json(), { error: "invitation_unusable", messageCode: "MSG-73-003" }, "the correct code no longer proves an exhausted ceremony");
      const reresolved = await call("POST", "/v1/invitations/resolve", { code: delivery.bearer }, ceremonyHeaders(undefined));
      assert.equal(reresolved.statusCode, 404);
      assert.deepEqual(reresolved.json(), { error: "invitation_unusable", messageCode: "MSG-73-003" }, "the exhausted link no longer resolves");
      assert.equal(world.repository.securityEvents.at(-1)?.outcomeClass, "terminal_record");
      assert.equal(world.repository.invitations.get(invitationId)?.state, "pending", "the inviter's record is untouched: the recovery is a resend");
    } finally { await app.close(); }
  });

  it("PK6-02 (PK5FIX-F01): a returned unusable outcome COMMITS the private already-member cancel, and a thrown InvitationError rolls the effect back", async () => {
    let failInsertConfirmation = false;
    const { app, world, call, ceremony, asInvitee, ceremonyHeaders } = await application({
      repositoryFault: (repository) => Object.assign(Object.create(repository) as InvitationRepository, { insertConfirmation: async (record: Parameters<InvitationRepository["insertConfirmation"]>[0]) => { if (failInsertConfirmation) throw new InvitationError("constraint_violation", "confirmation"); return repository.insertConfirmation(record); } }),
    });
    try {
      // Already a member: the invitee already holds an active membership, so attach cancels privately and answers the uniform envelope -- and the cancel commits.
      world.repository.seedMembership({ membershipId: "99999999-9999-4999-8999-999999999999", budgetSpaceId: SPACE, profileId: INVITEE_PROFILE, accountSubjectId: INVITEE_SUBJECT, role: "collaborator", status: "active", authorizationVersion: 1, createdBySubjectId: OWNER_SUBJECT, endedAt: null });
      const member = await ceremony("verify");
      asInvitee("invitation.attach");
      const attached = await call("POST", `/v1/invitations/${member.ceremonyId}/attach`, {}, ceremonyHeaders(member.secret));
      assert.equal(attached.statusCode, UNIFORM_INVITATION_STATUS); assert.deepEqual(attached.json(), UNIFORM_INVITATION_BODY);
      assert.equal(world.repository.invitations.get(member.invitationId)?.state, "cancelled", "the TR-73-06 cancel committed");
      assert.equal(world.repository.invitations.get(member.invitationId)?.privateTerminalCause, "already_member");
      assert.equal(world.repository.audits.at(-1)?.eventCode, "AE-73-06"); assert.equal(world.repository.audits.at(-1)?.audience, "restricted");
      world.repository.memberships.pop();

      // A thrown InvitationError inside accept rolls back the invitation and ceremony state changes that preceded it.
      const fresh = await ceremony("attach");
      failInsertConfirmation = true;
      asInvitee("invitation.accept");
      const failed = await call("POST", `/v1/invitations/${fresh.ceremonyId}/accept`, { acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 } }, ceremonyHeaders(fresh.secret));
      assert.equal(failed.statusCode, 409, failed.body); assert.deepEqual(failed.json(), { error: "constraint_violation" });
      assert.equal(world.repository.invitations.get(fresh.invitationId)?.state, "pending", "the state update before the throw was rolled back");
      assert.equal(world.repository.ceremonies.get(fresh.ceremonyId)?.state, "open");
      assert.equal(world.repository.confirmations.size, 0);
      failInsertConfirmation = false;
      // A stale disclosure claim denies with nothing written.
      const stale = await call("POST", `/v1/invitations/${fresh.ceremonyId}/accept`, { acknowledgedDisclosure: { kind: "invitation_collaborator", version: 2 } }, ceremonyHeaders(fresh.secret));
      assert.equal(stale.statusCode, 409); assert.deepEqual(stale.json(), { error: "stale_disclosure" });
      assert.equal(world.repository.invitations.get(fresh.invitationId)?.state, "pending");
    } finally { await app.close(); }
  });

  it("PK6-02 (R-03, SEC-PK5-F02): the confirm, reject and replace routes always carry the selected cell's permission, and the 26 cell is selected from the record", async () => {
    const { app, h, world, call, ceremony, asOwner } = await application();
    try {
      const coowner = await ceremony("accept", "co_owner");
      assert.equal(world.repository.invitations.get(coowner.invitationId)?.requiredPermission, "26");
      // A Co-owner holds 24.confirm_acceptance but not 26.confirm_acceptance: the route selects the 26 cell from the record and the policy denies uniformly.
      asOwner("co_owner");
      const denied = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${coowner.invitationId}/confirm`, { confirmationIdempotencyKey: "c-2" });
      assert.equal(denied.statusCode, 403); assert.deepEqual(denied.json(), { outcome: "deny", reason: "denied" });
      assert.equal(h.state.audits.at(-1)?.reasonClass, "role_not_permitted");
      assert.equal(world.repository.memberships.filter((m) => m.accountSubjectId === INVITEE_SUBJECT).length, 0);
      // The Primary Owner confirms on 26.confirm_acceptance; OwnerContext.permission is "26" and the section 8 step 4 equality holds.
      asOwner("primary_owner");
      const confirmed = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${coowner.invitationId}/confirm`, { confirmationIdempotencyKey: "c-2" });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      assert.equal(confirmed.json().receipt.role, "co_owner");
      assert.equal(h.state.audits.at(-1)?.actionCode, "26.confirm_acceptance");
      // The confirmed member leaves again so the next ceremony is not an already-member cancel.
      world.repository.memberships.pop();
      // Replace and reject on a Collaborator invitation select the row-24 cells, which a Co-owner holds in p5.
      const collaborator = await ceremony("accept", "collaborator");
      asOwner("co_owner");
      const rejected = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${collaborator.invitationId}/reject`, {});
      assert.equal(rejected.statusCode, 200, rejected.body);
      assert.equal(h.state.audits.at(-1)?.actionCode, "24.confirm_acceptance");
      assert.equal(world.repository.invitations.get(collaborator.invitationId)?.state, "cancelled");
      assert.equal(world.repository.notices.at(-1)?.messageCode, "MSG-73-052");
      const pending = await ceremony("create", "collaborator");
      const replaced = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${pending.invitationId}/replace`, {});
      assert.equal(replaced.statusCode, 201, replaced.body);
      assert.equal(h.state.audits.at(-1)?.actionCode, "24.replace_invitation");
      const resent = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${replaced.json().invitation.invitationId}/replace`, { mode: "resend" });
      assert.equal(resent.statusCode, 201, resent.body);
      assert.equal(h.state.audits.at(-1)?.actionCode, "24.resend_invitation", "OQ-IV-002: one route, the mode selects the cell");
    } finally { await app.close(); }
  });

  it("PK6-02 (R-01, SEC-PK6-F1): a Co-owner cannot supersede a Primary's co_owner invitation through create -- 403 permission_mismatch, the record stays pending and its code stays usable", async () => {
    const { app, world, call, ceremony, asOwner, ceremonyHeaders } = await application();
    try {
      const primary = await ceremony("create", "co_owner");
      assert.equal(world.repository.invitations.get(primary.invitationId)?.requiredPermission, "26");
      const outboxBefore = world.repository.outbox.size;
      // The Co-owner holds 24.invite_nonowner in p5 and the decision allows, but the implicit
      // TR-73-05 replacement is the same transition the replace route performs: the actor's
      // decided permission (24) must equal the record's (26). The module refuses and the
      // boundary rolls the transaction back.
      asOwner("co_owner");
      const denied = await call("POST", `/v1/budget-spaces/${SPACE}/invitations`, { channel: "email", destination: "Invitee@Example.com", proposedRole: "collaborator", idempotencyKey: "k-coowner" });
      assert.equal(denied.statusCode, 403, denied.body); assert.deepEqual(denied.json(), { error: "permission_mismatch" });
      const record = world.repository.invitations.get(primary.invitationId)!;
      assert.equal(record.state, "pending", "the Primary's record was not superseded");
      assert.equal(record.requiredPermission, "26");
      assert.equal([...world.repository.invitations.values()].filter((r) => r.budgetSpaceId === SPACE).length, 1, "no successor was created");
      assert.equal(world.repository.outbox.size, outboxBefore, "no successor delivery was written");
      // The original code is still usable by the link holder.
      const resolved = await call("POST", "/v1/invitations/resolve", { code: primary.delivery.bearer }, ceremonyHeaders(undefined));
      assert.equal(resolved.statusCode, 200, resolved.body);
      assert.equal(typeof resolved.json().ceremonyId, "string");
      // The Primary Owner, holding the record's exact permission, still replaces through create.
      asOwner("primary_owner");
      const replaced = await call("POST", `/v1/budget-spaces/${SPACE}/invitations`, { channel: "email", destination: "Invitee@Example.com", proposedRole: "co_owner", idempotencyKey: "k-primary-2" });
      assert.equal(replaced.statusCode, 201, replaced.body);
      assert.notEqual(replaced.json().invitation.invitationId, primary.invitationId);
      assert.equal(world.repository.invitations.get(primary.invitationId)?.state, "superseded");
    } finally { await app.close(); }
  });

  it("PK6-02 (SEC-PK5-F03): verify-channel and decline bind the server's environment key exactly as resolve does", async () => {
    const { app, world, call, ceremony, ceremonyHeaders } = await application();
    try {
      const { ceremonyId, secret, delivery } = await ceremony("resolve");
      assert.equal(world.repository.ceremonies.get(ceremonyId)?.environment, ENVIRONMENT);
      // A ceremony row from another environment (a foreign row with this id and secret) is unusable on both routes.
      const row = world.repository.ceremonies.get(ceremonyId)!;
      world.repository.ceremonies.set(ceremonyId, { ...row, environment: "env-other" });
      const verify = await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: delivery.challenge }, ceremonyHeaders(secret));
      assert.equal(verify.statusCode, UNIFORM_INVITATION_STATUS); assert.deepEqual(verify.json(), UNIFORM_INVITATION_BODY);
      const decline = await call("POST", `/v1/invitations/${ceremonyId}/decline`, {}, ceremonyHeaders(secret));
      assert.equal(decline.statusCode, UNIFORM_INVITATION_STATUS); assert.deepEqual(decline.json(), UNIFORM_INVITATION_BODY);
      assert.equal(world.repository.ceremonies.get(ceremonyId)?.channelProofState, "challenged", "nothing was written");
      world.repository.ceremonies.set(ceremonyId, row);
      assert.equal((await call("POST", `/v1/invitations/${ceremonyId}/verify-channel`, { channelCode: delivery.challenge }, ceremonyHeaders(secret))).statusCode, 200);
      // The trio refuses a cross-site or foreign-origin request before any transaction (CBD-191 section 5.1, as `/v1/identity/begin`).
      const foreign = await call("POST", "/v1/invitations/resolve", { code: delivery.bearer }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
      assert.equal(foreign.statusCode, 403); assert.deepEqual(foreign.json(), { error: "origin_rejected" });
    } finally { await app.close(); }
  });

  it("PK6-02 (R-07): conflict and retryable_conflict re-run the confirm effect and are one class on the wire", async () => {
    let remainingFaults = 0;
    const { app, world, client, call, ceremony, asOwner } = await application({
      repositoryFault: (repository) => Object.assign(Object.create(repository) as InvitationRepository, { insertMembership: async (record: Parameters<InvitationRepository["insertMembership"]>[0]) => { if (remainingFaults > 0) { remainingFaults--; throw new InvitationError("conflict", "membership"); } return repository.insertMembership(record); } }),
    });
    try {
      const first = await ceremony("accept");
      asOwner();
      remainingFaults = 1;
      const before = client.attempts;
      const confirmed = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${first.invitationId}/confirm`, { confirmationIdempotencyKey: "c-3" });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      assert.equal(client.attempts - before, 2, "the effect was re-run once after the conflict");
      assert.equal(world.repository.memberships.filter((m) => m.accountSubjectId === INVITEE_SUBJECT && m.status === "active").length, 1);
      // A conflict that never clears is answered as retryable_conflict after the retry budget, with nothing written.
      world.repository.memberships.pop();
      const second = await ceremony("accept");
      asOwner();
      remainingFaults = 10;
      const exhausted = await call("POST", `/v1/budget-spaces/${SPACE}/invitations/${second.invitationId}/confirm`, { confirmationIdempotencyKey: "c-4" });
      assert.equal(exhausted.statusCode, 409); assert.deepEqual(exhausted.json(), { error: "retryable_conflict" });
      assert.equal(world.repository.invitations.get(second.invitationId)?.state, "awaiting_confirmation");
      assert.equal(world.repository.consents.filter((c) => c.sourceRecordId === second.invitationId).length, 0);
    } finally { await app.close(); }
  });

  it("PK6-01: a non-owner, a wrong space and a missing session are denied uniformly before any effect", async () => {
    const { app, h, world, call, ceremony, asOwner } = await application();
    try {
      const { invitationId } = await ceremony("create");
      asOwner("collaborator");
      for (const [method, url, payload] of [
        ["POST", `/v1/budget-spaces/${SPACE}/invitations`, { channel: "email", destination: "x@example.com", proposedRole: "collaborator", idempotencyKey: "k" }],
        ["GET", `/v1/budget-spaces/${SPACE}/invitations`, undefined],
        ["DELETE", `/v1/budget-spaces/${SPACE}/invitations/${invitationId}`, undefined],
        ["POST", `/v1/budget-spaces/${SPACE}/invitations/${invitationId}/confirm`, { confirmationIdempotencyKey: "k" }],
      ] as const) {
        const response = await call(method, url, payload);
        assert.equal(response.statusCode, 403, `${method} ${url}`); assert.deepEqual(response.json(), { outcome: "deny", reason: "denied" });
        assert.equal(h.state.audits.at(-1)?.reasonClass, "role_not_permitted");
      }
      asOwner("primary_owner");
      const wrongSpace = await call("GET", `/v1/budget-spaces/${"11111111-1111-4111-8111-222222222222"}/invitations`);
      assert.equal(wrongSpace.statusCode, 403);
      const noSession = await app.inject({ method: "GET", url: `/v1/budget-spaces/${SPACE}/invitations` });
      assert.equal(noSession.statusCode, 403);
      assert.equal(world.repository.invitations.get(invitationId)?.state, "pending");
    } finally { await app.close(); }
  });

  it("PK6-04: the local delivery surface renders the simulated deliveries under the local provider and is refused for any other adapter", async () => {
    const { app, call, ceremony, asInvitee } = await application();
    try {
      const { invitationId, delivery } = await ceremony("create");
      asInvitee("profile.read");
      const listed = await call("GET", "/v1/local/invitation-deliveries");
      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(listed.json().fidelityLabel, "simulated");
      const item = (listed.json().deliveries as Record<string, unknown>[]).find((row) => row.invitationId === invitationId);
      assert.ok(item);
      assert.equal(item.code, delivery.bearer); assert.equal(item.channelChallenge, delivery.challenge); assert.equal(item.fidelityLabel, "simulated");
      // SEC-PK6-R8 condition 3: the raw address never leaves the adapter through this surface; only the owner-visible mask does.
      assert.deepEqual(Object.keys(item).sort(), ["channelChallenge", "code", "custodyDeadline", "destinationMasked", "fidelityLabel", "invitationId"]);
      assert.equal(item.destinationMasked, "i***@example.com");
      assert.ok(!listed.body.includes("invitee@example.com") && !listed.body.includes("Invitee@Example.com"), "the raw destination is not in the body");
    } finally { await app.close(); }
    assert.throws(() => localDeliveriesHttp({ adapterKind: "unavailable", within: () => { throw new Error("unreachable"); }, now: () => new Date() }), /local delivery surface refused/);
    assert.throws(() => localDeliveriesHttp({ adapterKind: "cognito", within: () => { throw new Error("unreachable"); }, now: () => new Date() }), /local delivery surface refused/);
  });

  it("PK6-02 (R-02): the trio retries a COMMIT-time serialization failure by sqlState and never answers a framework body", async () => {
    // A driver error shaped like StatementFailedError: no InvitationError, only a sqlState.
    const serialization = () => Object.assign(new Error("could not serialize access"), { sqlState: "40001" });
    let mode: "once" | "always" | "driver" | "none" = "none";
    let calls = 0;
    const { app, world, call, ceremony, ceremonyHeaders } = await application({
      clientFault: (client) => ({
        ...client,
        transaction: async (options: unknown, work: (scoped: unknown) => Promise<unknown>) => {
          calls++;
          if (mode === "driver") throw new Error("connection reset");
          if (mode === "always" || (mode === "once" && calls === 1)) throw serialization();
          return (client.transaction as (o: unknown, w: (scoped: unknown) => Promise<unknown>) => Promise<unknown>)(options, work);
        },
      } as unknown as DataAccessClient),
    });
    try {
      const { delivery } = await ceremony("create");
      // One 40001 at COMMIT, then success: the retry is invisible on the wire.
      mode = "once"; calls = 0;
      const resolved = await call("POST", "/v1/invitations/resolve", { code: delivery.bearer }, ceremonyHeaders(undefined));
      assert.equal(resolved.statusCode, 200, resolved.body);
      assert.equal(calls, 2, "retried once");
      assert.equal(typeof resolved.json().ceremonyId, "string");
      // Every attempt fails: three attempts, then the uniform external denial, not Nest's 500 body.
      mode = "always"; calls = 0;
      const exhausted = await call("POST", "/v1/invitations/resolve", { code: delivery.bearer }, ceremonyHeaders(undefined));
      assert.equal(exhausted.statusCode, 503, exhausted.body);
      assert.deepEqual(exhausted.json(), { outcome: "deny", reason: "denied" });
      assert.equal(calls, 3, "SERIALIZATION_ATTEMPTS");
      // Any other unexpected error on the trio: the same denial, once, and nothing framework-shaped leaks.
      mode = "driver"; calls = 0;
      for (const [url, payload] of [
        ["/v1/invitations/resolve", { code: delivery.bearer }],
        [`/v1/invitations/${"33333333-3333-4333-8333-333333333333"}/verify-channel`, { channelCode: "000000" }],
        [`/v1/invitations/${"33333333-3333-4333-8333-333333333333"}/decline`, {}],
      ] as const) {
        const answer = await call("POST", url, payload, ceremonyHeaders("not-a-secret"));
        assert.equal(answer.statusCode, 503, `${url}: ${answer.body}`);
        assert.deepEqual(answer.json(), { outcome: "deny", reason: "denied" }, url);
        assert.ok(!answer.body.includes("Internal server error"), url);
      }
      assert.equal(calls, 3, "one attempt per route for a non-retryable error");
      // The ceremony from the first resolve is unaffected: the failed attempts wrote nothing.
      mode = "none";
      assert.equal([...world.repository.ceremonies.values()].filter((c) => c.state === "open").length, 1);
    } finally { await app.close(); }
  });

  it("the invitation store returns a rolled-back RouteFailure as the result and retries only the retryable class", async () => {
    let calls = 0;
    const client = { transaction: async <T>(_o: unknown, work: (scoped: unknown) => Promise<T>) => { calls++; return work({}); } } as unknown as DataAccessClient;
    const store = new InvitationsAuthorizationStore(client);
    const fates: string[] = [];
    store.observe({ committed: () => fates.push("committed"), rolledBack: () => fates.push("rolled_back") });
    assert.equal(await store.transaction(async () => "ok"), "ok");
    const failure = new RouteFailure(409, "stale_version");
    assert.equal(await store.transaction(async () => { throw failure; }), failure);
    assert.equal(calls, 2);
    const retryable = new RouteFailure(409, "retryable_conflict");
    assert.equal(await store.transaction(async () => { throw retryable; }), retryable);
    assert.equal(calls, 5, "three attempts for the retryable class");
    assert.deepEqual(fates, ["committed", "rolled_back", "rolled_back", "rolled_back", "rolled_back"]);
    await assert.rejects(store.transaction(async () => { throw new Error("driver"); }), /driver/);
  });
});
