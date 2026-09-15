import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { expectedProvenance, ordinaryFixture } from "@cobudget/contracts/authorization";
import type { PolicyInput } from "@cobudget/contracts/authorization";
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { ACCOUNT_SPACE_A, ACCOUNT_SPACE_B, ACCOUNT_SUBJECT_1, accountWorld } from "../../../../packages/budget-application/src/accounts/support.ts";
import { AppModule } from "../app.module.js";
import { RouteFailure } from "../authorization/http.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { accountsHttp } from "./http.js";
import type { AccountsHttpDependencies } from "./http.js";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "accounts-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const ROUTES = [
  "/v1/budget-spaces/:budgetSpaceId/accounts",
  "/v1/budget-spaces/:budgetSpaceId/accounts/:accountId",
  "/v1/budget-spaces/:budgetSpaceId/accounts/:accountId/archive",
  "/v1/budget-spaces/:budgetSpaceId/accounts/:accountId/restore",
];
const MEMBER = ACCOUNT_SUBJECT_1;

/** The released p3 account fixture, re-pointed at a UUID budget space. The resource type comes from the route's operation. */
function factsFor(spaceId: string): PolicyInput {
  const base = ordinaryFixture("manual_account.create_manual_account");
  const input = { ...base, subject: { ...base.subject, accountSubjectId: MEMBER }, space: { ...base.space, spaceId }, resource: { ...base.resource, owningSpaceId: spaceId }, assurance: { ...base.assurance, boundSpaceId: spaceId } };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

async function application() {
  const world = accountWorld();
  const h = new Harness(factsFor(ACCOUNT_SPACE_A));
  // The Harness store knows only bootstrap obligations; the production AccountsAuthorizationStore discharges the p3 obligations structurally.
  const discharge = h.store.discharge.bind(h.store);
  h.store.discharge = async (transaction, input, obligation) =>
    ["preserve", "invalidate", "confirm", "mask", "bind_cache_key"].includes(obligation.kind) || discharge(transaction, input, obligation);
  const transaction = h.store.transaction.bind(h.store);
  h.store.transaction = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    try { return await transaction(work); } catch (error) { if (error instanceof RouteFailure) return error as T; throw error; }
  };
  const memberships: Record<string, string | undefined> = { [`${MEMBER}:${ACCOUNT_SPACE_A}`]: "membership-1", [`${MEMBER}:${ACCOUNT_SPACE_B}`]: "membership-1" };
  let repositoryCalls = 0;
  const dependencies: AccountsHttpDependencies = {
    repository: () => { repositoryCalls++; return world.repository; },
    membership: async (subject, spaceId) => memberships[`${subject}:${spaceId}`] ?? null,
    clock: { now: () => world.now }, ids: world.ids,
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      modules: [accountsHttp(dependencies).module],
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
  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, cookie: string | undefined = "opaque") =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }), ...(cookie === undefined ? {} : { headers: { cookie } }) });
  return { app, h, world, call, repositoryCalls: () => repositoryCalls, memberships };
}

const NEW_ACCOUNT = { accountType: "checking", label: "Everyday", currencyCode: "USD", openingBalanceMinorUnits: 125_000 };

describe("CBD-196 / CBD-200 manual account routes through the real Fastify instance", () => {
  it("INCB-01: a Primary Owner creates, lists, edits, archives and restores an account over HTTP", async () => {
    const { app, h, call } = await application();
    try {
      const created = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, NEW_ACCOUNT);
      assert.equal(created.statusCode, 201, created.body);
      const account = created.json().account as { accountId: string; version: number; origin: string; archivedAt: string | null };
      assert.equal(created.json().previousVersion, null);
      assert.equal(account.version, 1);
      assert.equal(account.origin, "manual");
      assert.deepEqual(h.order, ["begin", "allow-audit", "commit"], "the effect committed exactly once, after the allow was recorded");

      const listed = await call("GET", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`);
      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual(listed.json(), { budgetSpaceId: ACCOUNT_SPACE_A, accounts: [account] });

      const edited = await call("PATCH", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${account.accountId}`, { label: "Everyday checking" });
      assert.equal(edited.statusCode, 200, edited.body);
      assert.equal(edited.json().previousVersion, 1);
      assert.equal(edited.json().account.version, 2, "CBD-196-AC03: the previous and resulting versions are both reported");
      assert.equal(edited.json().account.label, "Everyday checking");

      const archived = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${account.accountId}/archive`);
      assert.equal(archived.statusCode, 201, archived.body);
      assert.notEqual(archived.json().account.archivedAt, null);
      const stillListed = await call("GET", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`);
      assert.equal((stillListed.json().accounts as unknown[]).length, 1, "CBD-196-AC04: archival is lifecycle, not disappearance");

      const restored = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${account.accountId}/restore`);
      assert.equal(restored.statusCode, 201, restored.body);
      assert.equal(restored.json().account.archivedAt, null);
      assert.equal(restored.json().account.openingBalanceMinorUnits, 125_000, "the balance survived the round trip");
    } finally { await app.close(); }
  });

  it("INCB-01 (SEC-P3-F1): the handler owns account-state admissibility, one refusal per transition", async () => {
    const { app, call } = await application();
    try {
      const created = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, NEW_ACCOUNT);
      const accountId = (created.json().account as { accountId: string }).accountId;

      // decide allows restore on a live account (resource.lifecycle is not a predicate). The handler refuses.
      const restoreLive = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${accountId}/restore`);
      assert.equal(restoreLive.statusCode, 409, restoreLive.body);
      assert.deepEqual(restoreLive.json(), { error: "account_not_archived" });

      assert.equal((await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${accountId}/archive`)).statusCode, 201);

      // Archive of an already archived account.
      const archiveArchived = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${accountId}/archive`);
      assert.equal(archiveArchived.statusCode, 409, archiveArchived.body);
      assert.deepEqual(archiveArchived.json(), { error: "account_archived" });

      // Edit of an archived account.
      const editArchived = await call("PATCH", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${accountId}`, { label: "renamed" });
      assert.equal(editArchived.statusCode, 409, editArchived.body);
      assert.deepEqual(editArchived.json(), { error: "account_archived" });

      // And the legal transition still works, so the guard refuses a state and not the operation.
      assert.equal((await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${accountId}/restore`)).statusCode, 201);
    } finally { await app.close(); }
  });

  it("INCB-01: canonical field errors, and a 404 for an account of another budget", async () => {
    const { app, call } = await application();
    try {
      for (const [body, error] of [
        [{ ...NEW_ACCOUNT, label: "  " }, "label_invalid"],
        [{ ...NEW_ACCOUNT, accountType: "brokerage" }, "account_type_unsupported"],
        [{ ...NEW_ACCOUNT, currencyCode: "ZZZ" }, "currency_unsupported"],
        [{ ...NEW_ACCOUNT, openingBalanceMinorUnits: 1.5 }, "amount_not_integer"],
      ] as const) {
        const refused = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, body);
        assert.equal(refused.statusCode, 400, `${error}: ${refused.body}`);
        assert.deepEqual(refused.json(), { error });
      }
      const created = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, NEW_ACCOUNT);
      // The edit body is closed: only the four editable fields are readable from it.
      const unknownField = await call("PATCH", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${(created.json().account as { accountId: string }).accountId}`, { label: "fine", currencyCode: "EUR" });
      assert.equal(unknownField.statusCode, 400, unknownField.body);
      assert.deepEqual(unknownField.json(), { error: "invalid_request" });

      const duplicate = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, { ...NEW_ACCOUNT, label: "everyday" });
      assert.equal(duplicate.statusCode, 409, duplicate.body);
      assert.deepEqual(duplicate.json(), { error: "label_taken" });

      const accountId = (created.json().account as { accountId: string }).accountId;
      // An account identifier that names nothing in this budget is a 404 from the command.
      const absent = await call("PATCH", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/aaaa0000-0000-4000-8000-000000009999`, { label: "nothing" });
      assert.equal(absent.statusCode, 404, absent.body);
      assert.deepEqual(absent.json(), { error: "account_not_found" });

      // The same account reached through another budget space is denied by the boundary, not answered by the
      // command: the acting space in the path does not match the space the trusted facts name, so the input is
      // refused before any handler runs. The isolation is the policy's (XSP-02), not the repository's.
      const elsewhere = await call("PATCH", `/v1/budget-spaces/${ACCOUNT_SPACE_B}/accounts/${accountId}`, { label: "stolen" });
      assert.equal(elsewhere.statusCode, 403, elsewhere.body);
      assert.deepEqual(elsewhere.json(), { outcome: "deny", reason: "denied" });
    } finally { await app.close(); }
  });

  /**
   * BFIX-02 (F-REVB-02). The datastore fact reader treats `resourceId ===
   * spaceId` as the whole-set case, so a row-targeted account route handed the
   * acting space's own id would be authorized against the whole account set
   * and only then answer 404 from the command. The replay hook refuses it
   * first, with this route's own 404, before authorization and before any
   * repository call.
   */
  it("BFIX-02: the acting space's own id is refused as an account id, before authorization", async () => {
    const { app, call, repositoryCalls } = await application();
    try {
      const created = await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, NEW_ACCOUNT);
      const accountId = (created.json().account as { accountId: string }).accountId;
      const before = repositoryCalls();
      for (const [method, path, payload] of [
        ["PATCH", `accounts/${ACCOUNT_SPACE_A}`, { label: "renamed" }],
        ["POST", `accounts/${ACCOUNT_SPACE_A}/archive`, undefined],
        ["POST", `accounts/${ACCOUNT_SPACE_A}/restore`, undefined],
      ] as const) {
        const refused = await call(method, `/v1/budget-spaces/${ACCOUNT_SPACE_A}/${path}`, payload);
        assert.equal(refused.statusCode, 404, `${method} ${path}: ${refused.body}`);
        assert.deepEqual(refused.json(), { error: "account_not_found" });
      }
      assert.equal(repositoryCalls(), before, "no refusal reached a handler, so none ran a query");
      // The real account still edits, so the refusal is of an identifier and not of the route.
      assert.equal((await call("PATCH", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts/${accountId}`, { label: "renamed" })).statusCode, 200);
    } finally { await app.close(); }
  });

  it("INCB-01: a subject without membership and an unauthenticated request are denied inertly, before any repository call", async () => {
    const { app, h, call, repositoryCalls, memberships } = await application();
    try {
      await call("POST", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, NEW_ACCOUNT);
      const before = repositoryCalls();
      delete memberships[`${MEMBER}:${ACCOUNT_SPACE_A}`];
      for (const [method, path, payload] of [
        ["POST", "accounts", NEW_ACCOUNT],
        ["GET", "accounts", undefined],
        ["PATCH", `accounts/${"aaaa0000-0000-4000-8000-000000000001"}`, { label: "x" }],
        ["POST", `accounts/${"aaaa0000-0000-4000-8000-000000000001"}/archive`, undefined],
        ["POST", `accounts/${"aaaa0000-0000-4000-8000-000000000001"}/restore`, undefined],
      ] as const) {
        const denied = await call(method, `/v1/budget-spaces/${ACCOUNT_SPACE_A}/${path}`, payload);
        assert.equal(denied.statusCode, 403, `${method} ${path}: ${denied.body}`);
      }
      assert.equal(repositoryCalls(), before, "no handler ran, so no repository was touched");
      assert.equal(h.order.filter((entry) => entry === "commit").length, 1, "only the first, authorized request committed");

      const anonymous = await call("GET", `/v1/budget-spaces/${ACCOUNT_SPACE_A}/accounts`, undefined, undefined);
      assert.equal(anonymous.statusCode, 403);
      assert.equal(repositoryCalls(), before);
    } finally { await app.close(); }
  });
});
