/**
 * PK-7B route tests through the real Fastify instance, the real
 * `ApiAuthorizationBoundary`, the real fact assembler and the released
 * policy, over the PK-7A in-memory repository wrapped in a snapshot
 * transaction so commit and rollback are observable.
 *
 *   PK7B-01  the six routes bind the section 10.2 cells; the confirm route
 *            allows only under a fresh assurance bound to
 *            `29.transfer_primary_ownership` and the space, consumes the
 *            grant, and the commit swaps roles and consent inside one
 *            transaction, in either leg order;
 *   PK7B-02  the evidence reference comes only from the store (`SEC-PK7A-F2`):
 *            a confirm whose reference is not the grant this transaction
 *            spent does not commit, and one with no ledger does not run; the
 *            `SEC-P5-F1` route negatives deny; `40001` at COMMIT is retried
 *            and then answered `retryable_conflict` (`R-04`); `transferId`
 *            and `recipientMembershipId` are validated (`SEC-PK7A-F5`); every
 *            confirm answer states the grant disposition (`SEC-PK7A-F6`);
 *            both memberships' `authorization_version` advance at commit
 *            (`SEC-PK6-R1`).
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
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { primaryTransferObligations } from "../../../../packages/budget-application/src/primary-transfer/index.ts";
import type { InMemoryPrimaryTransferRepository } from "../../../../packages/budget-application/src/primary-transfer/in-memory.ts";
import {
  OTHER_SUBJECT, PRIMARY_MEMBERSHIP, PRIMARY_SUBJECT, RECIPIENT_MEMBERSHIP, RECIPIENT_SUBJECT, SPACE, testWorld,
} from "../../../../packages/budget-application/src/primary-transfer/support.ts";
import { AppModule } from "../app.module.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { PrimaryTransferAuthorizationStore, STEP_UP_REQUIRED, TRANSFER_ACTIONS, UNIFORM_DENIAL_MESSAGE_CODE, primaryTransferHttp } from "./http.ts";
import type { PrimaryTransferHttpDependencies, TransferTransactionContext } from "./http.ts";
import type { PrimaryTransferScope } from "./persistence.ts";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "transfer-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const ROUTES = [
  "/v1/budget-spaces/:budgetSpaceId/primary-transfers",
  "/v1/budget-spaces/:budgetSpaceId/primary-transfers/:transferId/accept",
  "/v1/budget-spaces/:budgetSpaceId/primary-transfers/:transferId/decline",
  "/v1/budget-spaces/:budgetSpaceId/primary-transfers/:transferId/confirm",
  "/v1/budget-spaces/:budgetSpaceId/primary-transfers/:transferId/withdraw",
  "/v1/budget-spaces/:budgetSpaceId/primary-transfers/:transferId",
];
const THIRD_MEMBERSHIP = "56565656-5656-4656-8656-565656565656";
const THIRD_PROFILE = "57575757-5757-4757-8757-575757575757";
const BASE = `/v1/budget-spaces/${SPACE}/primary-transfers`;

interface Actor { readonly subject: string; readonly membership: string; readonly role: Role; readonly version?: number }
const PRIMARY: Actor = { subject: PRIMARY_SUBJECT, membership: PRIMARY_MEMBERSHIP, role: "primary_owner" };
const RECIPIENT = (role: Role = "co_owner"): Actor => ({ subject: RECIPIENT_SUBJECT, membership: RECIPIENT_MEMBERSHIP, role });
const THIRD: Actor = { subject: OTHER_SUBJECT, membership: THIRD_MEMBERSHIP, role: "co_owner" };

/** The acting party's input for the space the in-memory world seeds. The resource type comes from the route's operation. */
function actorInput(action: string, actor: Actor): PolicyInput {
  const base = ordinaryFixture(action, actor.role, CURRENT_POLICY_VERSION);
  const input = {
    ...base,
    subject: { ...base.subject, accountSubjectId: actor.subject },
    // The fact source answers the space's current Primary: the actor's own row when they hold the role, the seeded Primary otherwise.
    space: { ...base.space, spaceId: SPACE, primaryOwnerMembershipId: actor.role === "primary_owner" ? actor.membership : PRIMARY_MEMBERSHIP },
    membership: { ...base.membership, membershipId: actor.membership, authorizationVersion: actor.version ?? 1 },
    resource: { ...base.resource, owningSpaceId: SPACE },
    // The fresh assurance the fixture carries is bound to the fixture's action and, here, to this space (PK-4's shape).
    assurance: { ...base.assurance, boundSpaceId: SPACE },
  };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

type Snapshot = { transfers: Map<string, unknown>; memberships: Map<string, unknown>; spaces: Map<string, unknown>; consents: Map<string, unknown>; invitations: Map<string, unknown>; audit: unknown[]; notices: unknown[] };

/**
 * A snapshot transaction over the in-memory repository: the work's writes are
 * kept when it returns and discarded when it throws, exactly the CBD-246
 * seam's contract. `commitFailures` makes the next N COMMITs raise the
 * driver's serialization failure after the work ran (`R-04`: `40001` with no
 * statement to guard), rolling that attempt back.
 */
function snapshotClient(repository: InMemoryPrimaryTransferRepository): DataAccessClient & { attempts: number; commitFailures: number } {
  const take = (): Snapshot => ({
    transfers: new Map(repository.transfers), memberships: new Map(repository.memberships), spaces: new Map(repository.spaces),
    consents: new Map(repository.consents), invitations: new Map(repository.invitations), audit: [...repository.audit], notices: [...repository.notices],
  });
  const restore = (s: Snapshot) => {
    for (const name of ["transfers", "memberships", "spaces", "consents", "invitations"] as const) {
      const target = repository[name] as Map<string, unknown>; target.clear(); for (const [k, v] of s[name]) target.set(k, v);
    }
    for (const name of ["audit", "notices"] as const) { const target = repository[name] as unknown[]; target.length = 0; target.push(...s[name]); }
  };
  const client = {
    attempts: 0, commitFailures: 0,
    transaction: async <T>(_options: unknown, work: (scoped: DataAccessClient) => Promise<T>): Promise<T> => {
      client.attempts++;
      const snapshot = take();
      try {
        const result = await work(client as unknown as DataAccessClient);
        if (client.commitFailures > 0) { client.commitFailures--; throw Object.assign(new Error("could not serialize access"), { sqlState: "40001" }); }
        return result;
      } catch (error) { restore(snapshot); throw error; }
    },
  };
  return client as unknown as DataAccessClient & { attempts: number; commitFailures: number };
}

async function application(options: { readonly recipientRole?: "co_owner" | "collaborator" } = {}) {
  const world = testWorld({ recipientRole: options.recipientRole ?? "co_owner" });
  world.repository.seedMembership({
    membershipId: THIRD_MEMBERSHIP, budgetSpaceId: SPACE, profileId: THIRD_PROFILE, accountSubjectId: OTHER_SUBJECT,
    role: "co_owner", status: "active", authorizationVersion: 1, endedAt: null,
  });
  const client = snapshotClient(world.repository);
  const scope: PrimaryTransferScope = { deps: world.deps, discharges: primaryTransferObligations(world.deps) };

  // The grant spend, per transaction handle, as ApiTransactionStore performs it: one reference per spend, exposed
  // to the transfer store and to nobody else. `tamper` is the SEC-PK7A-F2 negative's knob: what the route is handed.
  const spent = new WeakMap<object, string>();
  let grants = 0;
  const spender = {
    discharge: async (transaction: unknown, _input: PolicyInput, obligation: { kind: string }) => {
      if (obligation.kind !== "fresh_assurance" || transaction === null || typeof transaction !== "object") return false;
      grants += 1; spent.set(transaction, `0f0f0f0f-0f0f-4f0f-8f0f-${String(grants).padStart(12, "0")}`); return true;
    },
    spentFreshAssuranceRef: (transaction: unknown) => transaction !== null && typeof transaction === "object" ? spent.get(transaction) : undefined,
  };
  const store = new PrimaryTransferAuthorizationStore(client, spender, () => scope);
  const tamper: { context?: ((real: TransferTransactionContext) => TransferTransactionContext) | undefined } = {};
  /** What the pre-policy recipient resolution was asked and answered (R-03 / SEC-PK7B-F3). */
  const existenceAnswers: [string, boolean][] = [];

  // The boundary harness: the transfer store discharges the six cells' obligations and owns the transaction; the harness records the allow audit inside it.
  const h = new Harness(actorInput(TRANSFER_ACTIONS.propose, PRIMARY));
  h.store.discharge = (transaction, input, obligation) => store.discharge(transaction, input, obligation);
  h.store.verify = (transaction, input, obligations) => store.verify(transaction, input, obligations);
  const harnessTransaction = h.store.transaction.bind(h.store);
  h.store.transaction = (work) => store.transaction(() => harnessTransaction(work));
  store.observe({ committed: () => undefined, rolledBack: () => undefined });

  const dependencies: PrimaryTransferHttpDependencies = {
    within: () => scope,
    membership: async (subject, budgetSpaceId) => [...world.repository.memberships.values()].find((m) => m.accountSubjectId === subject && m.budgetSpaceId === budgetSpaceId && m.status === "active")?.membershipId ?? null,
    // As the production dependency: an active row of the space, or nothing (R-03 / SEC-PK7B-F3).
    membershipExists: async (budgetSpaceId, membershipId) => { const answer = world.repository.memberships.get(`${budgetSpaceId}/${membershipId}`)?.status === "active"; existenceAnswers.push([membershipId, answer]); return answer; },
    transferParties: async (budgetSpaceId, transferId) => { const r = world.repository.transfers.get(transferId); return r && r.budgetSpaceId === budgetSpaceId ? { proposerMembershipId: r.proposerMembershipId, recipientMembershipId: r.recipientMembershipId } : null; },
    context: (transaction) => { const real = store.context(transaction); return tamper.context ? tamper.context(real) : real; },
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      modules: [primaryTransferHttp(dependencies).module],
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

  const as = (action: string, actor: Actor) => { h.input = actorInput(action, actor); };
  const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }), headers: { cookie: "opaque" } });
  const membership = (id: string) => world.repository.memberships.get(`${SPACE}/${id}`)!;
  const propose = async (recipient = RECIPIENT_MEMBERSHIP) => {
    as(TRANSFER_ACTIONS.propose, PRIMARY);
    const proposed = await call("POST", BASE, { recipientMembershipId: recipient });
    assert.equal(proposed.statusCode, 201, proposed.body);
    assert.equal(proposed.json().outcome, "proposed");
    return proposed.json().transfer.transferId as string;
  };
  const accept = async (transferId: string, actor: Actor = RECIPIENT()) => { as(TRANSFER_ACTIONS.accept, actor); return call("POST", `${BASE}/${transferId}/accept`, {}); };
  const confirm = async (transferId: string, actor: Actor = PRIMARY) => { as(TRANSFER_ACTIONS.confirm, actor); return call("POST", `${BASE}/${transferId}/confirm`, {}); };
  const grantsSpent = () => grants;
  return { app, h, world, client, call, as, propose, accept, confirm, membership, tamper, grantsSpent, existenceAnswers };
}

describe("PK-7B Primary-transfer routes through the real Fastify instance", () => {
  it("PK7B-01: propose, accept, step-up-bound confirm; the commit swaps roles and consent rows, advances both versions, cancels the former Primary's permission-26 invitation and consumes the grant", async () => {
    const { app, world, client, call, as, propose, accept, confirm, membership, grantsSpent } = await application();
    try {
      const transferId = await propose();
      assert.equal(world.repository.transfers.get(transferId)?.state, "proposed");
      // Either party reads the status; the view carries no assurance reference and no digest.
      as(TRANSFER_ACTIONS.view, RECIPIENT());
      const view = await call("GET", `${BASE}/${transferId}`);
      assert.equal(view.statusCode, 200, view.body);
      assert.equal(view.json().transfer.state, "proposed");
      assert.ok(!JSON.stringify(view.json()).includes("ssurance"), "no assurance material on the wire");

      const accepted = await accept(transferId);
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().outcome, "recipient_accepted");
      assert.equal(accepted.json().messageCode, "MSG-73-025");
      assert.equal(grantsSpent(), 0, "the accept cell is not protected: no grant is spent");

      const attemptsBefore = client.attempts;
      const confirmed = await confirm(transferId);
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      assert.equal(confirmed.json().outcome, "committed");
      assert.equal(confirmed.json().messageCode, "MSG-73-042");
      assert.equal(confirmed.json().freshAssurance, "consumed");
      assert.equal(client.attempts, attemptsBefore + 1, "one transaction: spend, four discharges, leg, re-discharge and commit");
      assert.equal(grantsSpent(), 1, "exactly one grant was spent");
      const receipt = confirmed.json().receipt;
      assert.equal(receipt.newPrimaryMembershipId, RECIPIENT_MEMBERSHIP);
      assert.equal(receipt.formerPrimaryMembershipId, PRIMARY_MEMBERSHIP);
      // The commit: roles swapped, both authorization versions advanced (SEC-PK6-R1: the OQ-IV-004 alias), the space moved.
      assert.equal(membership(PRIMARY_MEMBERSHIP).role, "co_owner");
      assert.equal(membership(RECIPIENT_MEMBERSHIP).role, "primary_owner");
      assert.equal(membership(PRIMARY_MEMBERSHIP).authorizationVersion, 2);
      assert.equal(membership(RECIPIENT_MEMBERSHIP).authorizationVersion, 2);
      assert.equal(world.repository.spaces.get(SPACE)?.primaryOwnerMembershipId, RECIPIENT_MEMBERSHIP);
      assert.equal(world.repository.spaces.get(SPACE)?.primaryOwnershipVersion, 2);
      // Consent: both prior rows superseded, two new current rows, the outgoing one carrying the store's reference and nothing else's.
      const current = [...world.repository.consents.values()].filter((c) => c.state === "current");
      assert.deepEqual(current.map((c) => [c.membershipId, c.role, c.disclosureKind]).sort(), [
        [PRIMARY_MEMBERSHIP, "co_owner", "primary_transfer_outgoing"], [RECIPIENT_MEMBERSHIP, "primary_owner", "primary_transfer_recipient"],
      ].sort());
      const outgoing = current.find((c) => c.membershipId === PRIMARY_MEMBERSHIP)!;
      assert.equal(outgoing.assuranceRef, "0f0f0f0f-0f0f-4f0f-8f0f-000000000001", "the consumed grant's identifier, from the store");
      assert.equal(world.repository.transfers.get(transferId)?.primaryAssuranceRef, "0f0f0f0f-0f0f-4f0f-8f0f-000000000001");
      assert.equal([...world.repository.consents.values()].filter((c) => c.state === "superseded").length, 2);
      // The former Primary's permission-26 invitation was cancelled through the captured set (R-05).
      assert.deepEqual(world.cancelled, ["12121212-1212-4212-8212-121212121212"]);
      assert.equal(world.repository.transfers.get(transferId)?.state, "committed");
      // The former Primary is now a Co-owner: the protected cell has no Co-owner column, so a repeat is denied by policy before any write.
      const auditRows = world.repository.audit.length;
      const retried = await confirm(transferId, { ...PRIMARY, role: "co_owner", version: 2 });
      assert.equal(retried.statusCode, 403, retried.body);
      assert.equal(world.repository.audit.length, auditRows, "nothing written by a policy denial");
      // The new Primary can now propose a transfer of their own.
      as(TRANSFER_ACTIONS.propose, { ...RECIPIENT("primary_owner"), version: 2 });
      const next = await call("POST", BASE, { recipientMembershipId: THIRD_MEMBERSHIP });
      assert.equal(next.statusCode, 201, next.body);
    } finally { await app.close(); }
  });

  it("PK7B-01: the Primary-first order -- confirm records the leg under the grant, the recipient's accept completes the pair and commits on the stored reference", async () => {
    const { app, world, accept, confirm, membership, propose, grantsSpent } = await application({ recipientRole: "collaborator" });
    try {
      const transferId = await propose();
      const confirmed = await confirm(transferId);
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      assert.equal(confirmed.json().outcome, "primary_confirmed");
      assert.deepEqual({ freshAssurance: confirmed.json().freshAssurance, next: confirmed.json().next }, { freshAssurance: "consumed", next: STEP_UP_REQUIRED });
      assert.equal(world.repository.transfers.get(transferId)?.state, "primary_confirmed");
      assert.equal(grantsSpent(), 1);
      const accepted = await accept(transferId, RECIPIENT("collaborator"));
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().outcome, "committed");
      assert.ok(accepted.json().receipt);
      assert.equal(grantsSpent(), 1, "the completing accept spends nothing: it binds to the reference the confirm stored");
      assert.equal(membership(RECIPIENT_MEMBERSHIP).role, "primary_owner");
      assert.equal(membership(PRIMARY_MEMBERSHIP).role, "co_owner");
    } finally { await app.close(); }
  });

  it("PK7B-02 (SEC-PK7A-F2): a confirm whose reference is not the grant this transaction spent does not commit, and one with no ledger does not run", async () => {
    const { app, world, accept, confirm, propose, tamper, membership } = await application();
    try {
      const transferId = await propose();
      assert.equal((await accept(transferId)).statusCode, 200);
      const before = JSON.stringify([...world.repository.transfers.values()]);
      // A reference that is not the spend's: the ledger was begun on the store's reference, so the handler refuses to bind it.
      tamper.context = (real) => ({ ...real, freshAssuranceRef: "0f0f0f0f-0f0f-4f0f-8f0f-ffffffffffff" });
      const foreign = await confirm(transferId);
      assert.equal(foreign.statusCode, 403, foreign.body);
      assert.deepEqual(foreign.json(), { error: "obligation_undischarged", messageCode: UNIFORM_DENIAL_MESSAGE_CODE, freshAssurance: "consumed", next: STEP_UP_REQUIRED });
      assert.equal(JSON.stringify([...world.repository.transfers.values()]), before, "the workflow did not move");
      assert.equal(membership(PRIMARY_MEMBERSHIP).role, "primary_owner");
      assert.equal(world.repository.audit.filter((row) => row.eventSubtype === "transfer_denied").length, 1, "the TR-73-47 denial committed its one audit row");
      // No ledger at all: the route never reaches the module and nothing is written, not even the denial row.
      tamper.context = (real) => ({ ...real, ledger: undefined });
      const rows = world.repository.audit.length;
      const unledgered = await confirm(transferId);
      assert.equal(unledgered.statusCode, 403, unledgered.body);
      assert.deepEqual(unledgered.json(), { error: "obligation_undischarged", freshAssurance: "unspent" });
      assert.equal(world.repository.audit.length, rows);
      assert.equal(JSON.stringify([...world.repository.transfers.values()]), before);
      // Reference from nowhere: with the channel emptied the actor carries none and the route fails closed the same way.
      tamper.context = () => ({ freshAssuranceRef: undefined, ledger: undefined, correlationId: undefined });
      assert.equal((await confirm(transferId)).statusCode, 403);
      // The untampered channel commits.
      tamper.context = undefined;
      const committed = await confirm(transferId);
      assert.equal(committed.statusCode, 200, committed.body);
      assert.equal(committed.json().outcome, "committed");
    } finally { await app.close(); }
  });

  it("PK7B-02 (SEC-P5-F1): a Co-owner accepting another member's transfer, a former Primary confirming after the role change, and accept or decline with no pending transfer all deny", async () => {
    const { app, world, call, as, accept, confirm, propose } = await application();
    try {
      const transferId = await propose();
      // SEC-PK7B-F1: another Co-owner of the space is neither party, so the route answers the unknown-identifier 404 before
      // the policy runs, with nothing written -- see the dedicated party-gate test below for the three workflow states.
      const intruder = await accept(transferId, THIRD);
      assert.equal(intruder.statusCode, 404, intruder.body);
      assert.deepEqual(intruder.json(), { error: "transfer_not_found" });
      assert.equal(world.repository.transfers.get(transferId)?.state, "proposed");
      as(TRANSFER_ACTIONS.decline, THIRD);
      const intruderDecline = await call("POST", `${BASE}/${transferId}/decline`, {});
      assert.equal(intruderDecline.statusCode, 404); assert.deepEqual(intruderDecline.json(), { error: "transfer_not_found" });
      // Accept or decline naming no pending transfer: a workflow that does not exist (404, rolled back, no audit row) ...
      const rows = world.repository.audit.length;
      const missing = await accept("00000000-0000-4000-8000-00000000ffff");
      assert.equal(missing.statusCode, 404); assert.deepEqual(missing.json(), { error: "transfer_not_found" });
      assert.equal(world.repository.audit.length, rows);
      // ... and one that is no longer pending (409, the denial committed).
      as(TRANSFER_ACTIONS.withdraw, PRIMARY);
      const withdrawn = await call("POST", `${BASE}/${transferId}/withdraw`, {});
      assert.equal(withdrawn.statusCode, 200, withdrawn.body); assert.equal(withdrawn.json().outcome, "withdrawn");
      const stale = await accept(transferId);
      assert.equal(stale.statusCode, 409); assert.equal(stale.json().error, "transfer_not_current");
      as(TRANSFER_ACTIONS.decline, RECIPIENT());
      const staleDecline = await call("POST", `${BASE}/${transferId}/decline`, {});
      assert.equal(staleDecline.statusCode, 409); assert.equal(staleDecline.json().error, "transfer_not_current");
      // A former Primary confirming after the role change: complete a transfer, then the demoted member (a Co-owner now) tries the protected cell.
      const second = await propose();
      assert.equal((await accept(second)).statusCode, 200);
      assert.equal((await confirm(second)).json().outcome, "committed");
      as(TRANSFER_ACTIONS.propose, { ...RECIPIENT("primary_owner"), version: 2 });
      // The new Primary proposes back to the former one, who is therefore a party (the recipient) and passes the route's party gate.
      const third = await call("POST", BASE, { recipientMembershipId: PRIMARY_MEMBERSHIP });
      assert.equal(third.statusCode, 201, third.body);
      const former = await confirm(third.json().transfer.transferId, { ...PRIMARY, role: "co_owner", version: 2 });
      assert.equal(former.statusCode, 403, former.body);
      assert.deepEqual(former.json(), { outcome: "deny", reason: "denied" }, "the released policy has no Co-owner column on the protected cell");
      // And a Collaborator has no propose cell at all.
      as(TRANSFER_ACTIONS.propose, { ...THIRD, role: "collaborator" });
      assert.equal((await call("POST", BASE, { recipientMembershipId: RECIPIENT_MEMBERSHIP })).statusCode, 403);
    } finally { await app.close(); }
  });

  it("PK7BF-01 (SEC-PK7B-F1): a same-space member who is neither party is answered 404 transfer_not_found on accept, decline and view before the policy runs, over a live, a withdrawn and a stale workflow, with nothing written; the parties still reach the module", async () => {
    const { app, world, call, as, accept, propose } = await application();
    try {
      const snapshot = () => JSON.stringify({ transfers: [...world.repository.transfers.values()], audit: world.repository.audit.length, notices: world.repository.notices.length, memberships: [...world.repository.memberships.values()] });
      const nonParty = async (transferId: string, label: string) => {
        const before = snapshot();
        const answers = [
          await accept(transferId, THIRD),
          await (async () => { as(TRANSFER_ACTIONS.decline, THIRD); return call("POST", `${BASE}/${transferId}/decline`, {}); })(),
          await (async () => { as(TRANSFER_ACTIONS.view, THIRD); return call("GET", `${BASE}/${transferId}`); })(),
        ];
        for (const answer of answers) {
          assert.equal(answer.statusCode, 404, `${label}: ${answer.body}`);
          assert.deepEqual(answer.json(), { error: "transfer_not_found" }, label);
        }
        assert.equal(snapshot(), before, `${label}: the row, the audit rows and the notices are untouched`);
      };
      // A live workflow.
      const live = await propose();
      await nonParty(live, "live");
      // The parties are unaffected: the recipient reads and accepts, the Primary reads.
      as(TRANSFER_ACTIONS.view, RECIPIENT());
      assert.equal((await call("GET", `${BASE}/${live}`)).statusCode, 200);
      as(TRANSFER_ACTIONS.view, PRIMARY);
      assert.equal((await call("GET", `${BASE}/${live}`)).statusCode, 200);
      assert.equal((await accept(live)).json().outcome, "recipient_accepted");
      // A withdrawn workflow: the non-party learns nothing of its terminal state.
      as(TRANSFER_ACTIONS.withdraw, PRIMARY);
      assert.equal((await call("POST", `${BASE}/${live}/withdraw`, {})).json().outcome, "withdrawn");
      await nonParty(live, "withdrawn");
      const stillWithdrawn = await accept(live);
      assert.equal(stillWithdrawn.statusCode, 409); assert.equal(stillWithdrawn.json().error, "transfer_not_current", "a party still reaches the module's answer");
      // A stale live workflow (the recipient's version moved after the proposal): the TR-73-46 closure must not be triggered by a non-party.
      const stale = await propose();
      const recipient = world.repository.memberships.get(`${SPACE}/${RECIPIENT_MEMBERSHIP}`)!;
      world.repository.memberships.set(`${SPACE}/${RECIPIENT_MEMBERSHIP}`, { ...recipient, authorizationVersion: recipient.authorizationVersion + 1 });
      await nonParty(stale, "stale");
      assert.equal(world.repository.transfers.get(stale)?.state, "proposed", "the closure did not run for the non-party");
      // The party's next request runs the closure as before.
      const closed = await accept(stale, { ...RECIPIENT(), version: 2 });
      assert.equal(closed.statusCode, 409, closed.body); assert.equal(closed.json().error, "transfer_invalidated");
      assert.equal(world.repository.transfers.get(stale)?.state, "invalidated");
    } finally { await app.close(); }
  });

  it("PK7BF-02 (R-03, SEC-PK7B-F3): an ended member named as the propose recipient is never the policy target; the Primary's own row is, and the module denies recipient_ineligible without a workflow row", async () => {
    const { app, world, call, as, existenceAnswers } = await application();
    try {
      const third = world.repository.memberships.get(`${SPACE}/${THIRD_MEMBERSHIP}`)!;
      world.repository.memberships.set(`${SPACE}/${THIRD_MEMBERSHIP}`, { ...third, status: "revoked", endedAt: "2026-09-15T11:00:00.000Z" });
      as(TRANSFER_ACTIONS.propose, PRIMARY);
      const denied = await call("POST", BASE, { recipientMembershipId: THIRD_MEMBERSHIP });
      assert.equal(denied.statusCode, 409, denied.body);
      assert.deepEqual(denied.json(), { error: "recipient_ineligible", messageCode: UNIFORM_DENIAL_MESSAGE_CODE });
      assert.equal(world.repository.transfers.size, 0, "no workflow row");
      // The pre-policy resolution answered false for the ended row, so the policy target was the Primary's own row.
      assert.deepEqual(existenceAnswers, [[THIRD_MEMBERSHIP, false]]);
      // An active recipient still resolves to its own row.
      const accepted = await call("POST", BASE, { recipientMembershipId: RECIPIENT_MEMBERSHIP });
      assert.equal(accepted.statusCode, 201, accepted.body);
      assert.deepEqual(existenceAnswers.at(-1), [RECIPIENT_MEMBERSHIP, true]);
    } finally { await app.close(); }
  });

  it("PK7B-02 (R-04, SEC-PK7A-F5): a serialization failure at COMMIT is retried and then answered retryable_conflict; malformed identifiers never reach a statement", async () => {
    const { app, world, call, as, client, propose, accept } = await application();
    try {
      const transferId = await propose();
      // Two COMMIT-time 40001s, then success: the whole effect re-ran and the outcome is the accept's.
      client.commitFailures = 2;
      const attempts = client.attempts;
      const accepted = await accept(transferId);
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().outcome, "recipient_accepted");
      assert.equal(client.attempts, attempts + 3, "three attempts");
      assert.equal(world.repository.audit.filter((row) => row.eventSubtype === "recipient_accepted").length, 1, "the rolled-back attempts left no row");
      // Every attempt fails: answered as the one conflict class, rolled back.
      client.commitFailures = 3;
      as(TRANSFER_ACTIONS.withdraw, PRIMARY);
      const conflicted = await call("POST", `${BASE}/${transferId}/withdraw`, {});
      assert.equal(conflicted.statusCode, 409, conflicted.body);
      assert.deepEqual(conflicted.json(), { error: "retryable_conflict" });
      assert.equal(world.repository.transfers.get(transferId)?.state, "recipient_accepted");
      client.commitFailures = 0;
      // SEC-PK7A-F5: the UUID shape is validated at the route.
      as(TRANSFER_ACTIONS.accept, RECIPIENT());
      const malformed = await call("POST", `${BASE}/not-a-transfer/accept`, {});
      assert.equal(malformed.statusCode, 404); assert.deepEqual(malformed.json(), { error: "transfer_not_found" });
      as(TRANSFER_ACTIONS.propose, PRIMARY);
      const badBody = await call("POST", BASE, { recipientMembershipId: "not-a-membership" });
      assert.equal(badBody.statusCode, 400); assert.deepEqual(badBody.json(), { error: "invalid_request" });
      const spaceMalformed = await call("POST", "/v1/budget-spaces/not-a-space/primary-transfers", { recipientMembershipId: RECIPIENT_MEMBERSHIP });
      assert.equal(spaceMalformed.statusCode, 404);
    } finally { await app.close(); }
  });

  it("PK7B-02 (SEC-PK7A-F6): a denied confirm consumed the grant and says so; a rolled-back confirm did not", async () => {
    const { app, world, confirm, propose, grantsSpent } = await application();
    try {
      const transferId = await propose();
      world.repository.transfers.set(transferId, { ...world.repository.transfers.get(transferId)!, state: "withdrawn", stateVersion: 2 });
      // A terminal workflow is not live, so the store's ledger cannot begin and the boundary denies before the handler: policy denial, grant returned by the rollback.
      const terminal = await confirm(transferId);
      assert.equal(terminal.statusCode, 403, terminal.body);
      assert.deepEqual(terminal.json(), { outcome: "deny", reason: "denied" });
      // A live workflow whose Primary is stale at the decision: the module denies stale_version as a committed outcome.
      const live = await propose();
      const stale = await confirm(live, { ...PRIMARY, version: 7 });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.deepEqual(stale.json(), { error: "stale_version", messageCode: UNIFORM_DENIAL_MESSAGE_CODE, freshAssurance: "consumed", next: STEP_UP_REQUIRED });
      assert.equal(world.repository.audit.filter((row) => row.eventSubtype === "transfer_denied").length, 1, "the denial committed");
      assert.equal(grantsSpent(), 2, "both protected requests spent a grant; the rolled-back one was returned by the rollback in production");
      // A confirm naming a transfer that does not exist: the route hands the policy the caller's own row (no workflow
      // names a recipient), the store refuses to begin a ledger on the live workflow for a decision taken on another
      // target, and the boundary denies before the handler -- rolled back, nothing written, the grant returned.
      const rows = world.repository.audit.length;
      const missing = await confirm("00000000-0000-4000-8000-00000000ffff");
      assert.equal(missing.statusCode, 403, missing.body);
      assert.deepEqual(missing.json(), { outcome: "deny", reason: "denied" });
      assert.equal(world.repository.audit.length, rows);
    } finally { await app.close(); }
  });
});
