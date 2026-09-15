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
import { PERIOD_A_OPEN, SPACE_A, SPACE_B, SUBJECT_1, testWorld } from "../../../../packages/budget-application/src/targets/support.ts";
import { parseBaseTargetRequest, parseCategoryUpsertRequest, setBaseTargets, upsertCategories } from "../../../../packages/budget-application/src/targets/index.ts";
import { InMemoryTransactionsRepository } from "../../../../packages/budget-application/src/transactions/index.ts";
import { testAccount } from "../../../../packages/budget-application/src/transactions/support.ts";
import { StatementFailedError } from "@cobudget/data-access";
import type { DataAccessClient } from "@cobudget/data-access";
import { AppModule } from "../app.module.js";
import { RouteFailure } from "../authorization/http.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { TransactionsAuthorizationStore, commitConflict, transactionsHttp } from "./http.js";
import type { TransactionsHttpDependencies } from "./http.js";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "transactions-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const ROUTES = [
  "/v1/budget-spaces/:budgetSpaceId/transactions",
  "/v1/budget-spaces/:budgetSpaceId/transactions/:transactionId",
  "/v1/budget-spaces/:budgetSpaceId/transactions/:transactionId/remove",
  "/v1/budget-spaces/:budgetSpaceId/transactions/:transactionId/history",
  "/v1/budget-spaces/:budgetSpaceId/periods/:periodId/progress",
  "/v1/budget-spaces/:budgetSpaceId/periods/:periodId/progress/:categoryId",
];
const MEMBER = SUBJECT_1;
const ACCOUNT = "77777777-7777-4777-8777-777777777771";
const ACCOUNT_ARCHIVED = "77777777-7777-4777-8777-777777777772";
const FOREIGN_CATEGORY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function factsFor(spaceId: string): PolicyInput {
  const base = ordinaryFixture("9.add_manual_transaction");
  const input = { ...base, subject: { ...base.subject, accountSubjectId: MEMBER }, space: { ...base.space, spaceId }, resource: { ...base.resource, owningSpaceId: spaceId }, assurance: { ...base.assurance, boundSpaceId: spaceId } };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

/**
 * One budget space with a September period, two categories carrying base
 * targets, one live account and one archived one. The plan world owns the
 * category identifiers; the transaction world is seeded with the same ones, so
 * the aggregate and the plan are measuring the same cells.
 */
async function application() {
  const plan = testWorld();
  const categories = await upsertCategories(plan.deps, SPACE_A, parseCategoryUpsertRequest({ categories: [{ label: "Groceries" }, { label: "Transport" }] }));
  const groceries = categories[0]!.categoryId;
  const transport = categories[1]!.categoryId;
  await setBaseTargets(plan.deps, SPACE_A, MEMBER, parseBaseTargetRequest({ targets: [{ categoryId: groceries, amountMinorUnits: 50_000 }, { categoryId: transport, amountMinorUnits: 20_000 }] }));

  const ledger = new InMemoryTransactionsRepository();
  ledger.seedPeriod({ periodId: PERIOD_A_OPEN, budgetSpaceId: SPACE_A, status: "active", periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  ledger.seedAccount(testAccount({ accountId: ACCOUNT, budgetSpaceId: SPACE_A }));
  ledger.seedAccount(testAccount({ accountId: ACCOUNT_ARCHIVED, budgetSpaceId: SPACE_A, label: "retired", archivedAt: plan.now, version: 2 }));
  ledger.seedCategory({ categoryId: groceries, budgetSpaceId: SPACE_A, archivedAt: null });
  ledger.seedCategory({ categoryId: transport, budgetSpaceId: SPACE_A, archivedAt: null });

  const h = new Harness(factsFor(SPACE_A));
  const discharge = h.store.discharge.bind(h.store);
  h.store.discharge = async (transaction, input, obligation) =>
    ["preserve", "invalidate", "confirm", "mask", "bind_cache_key"].includes(obligation.kind) || discharge(transaction, input, obligation);
  const transaction = h.store.transaction.bind(h.store);
  h.store.transaction = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    try { return await transaction(work); } catch (error) { if (error instanceof RouteFailure) return error as T; throw error; }
  };
  const memberships: Record<string, { membershipId: string; authorizationVersion: number } | undefined> = {
    [`${MEMBER}:${SPACE_A}`]: { membershipId: "membership-1", authorizationVersion: 1 },
    [`${MEMBER}:${SPACE_B}`]: { membershipId: "membership-1", authorizationVersion: 1 },
  };
  let repositoryCalls = 0;
  const dependencies: TransactionsHttpDependencies = {
    repository: () => { repositoryCalls++; return ledger; },
    targets: () => plan.repository,
    membership: async (subject, spaceId) => memberships[`${subject}:${spaceId}`] ?? null,
    replay: (scope) => ledger.readIdempotency(scope),
    clock: { now: () => plan.now }, ids: { uuid: () => plan.ids.uuid() },
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      modules: [transactionsHttp(dependencies).module],
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
  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, cookie: string | undefined = "opaque", headers: Record<string, string> = {}) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }), headers: { ...(cookie === undefined ? {} : { cookie }), ...headers } });
  const space = `/v1/budget-spaces/${SPACE_A}`;
  return { app, h, call, space, groceries, transport, repositoryCalls: () => repositoryCalls, memberships, ledger };
}

const split = (groceries: string, transport: string) => ({
  accountId: ACCOUNT, amountMinorUnits: -1_250, budgetDate: "2026-09-15", description: "Corner shop",
  allocations: [{ categoryId: groceries, amountMinorUnits: -800 }, { categoryId: transport, amountMinorUnits: -450 }],
});

describe("CBD-199/200/201/209/211 transaction and progress routes through the real Fastify instance", () => {
  it("INCB-02: record, edit and remove one expense; history reads in revision order", async () => {
    const { app, call, space, groceries, transport } = await application();
    try {
      const created = await call("POST", `${space}/transactions`, split(groceries, transport));
      assert.equal(created.statusCode, 201, created.body);
      const current = created.json().current as { version: { transactionId: string; revision: number; periodId: string; settlementState: string; origin: string }; allocations: unknown[] };
      assert.equal(created.json().previous, null);
      assert.equal(current.version.revision, 1);
      assert.equal(current.version.periodId, PERIOD_A_OPEN, "CBD-199-AC04: the period is assigned from the stored bounds");
      assert.equal(current.version.settlementState, "settled");
      assert.equal(current.version.origin, "manual");
      assert.equal(current.allocations.length, 2);
      const transactionId = current.version.transactionId;

      const edited = await call("PATCH", `${space}/transactions/${transactionId}`, { ...split(groceries, transport), amountMinorUnits: -2_000, description: "Corner shop, corrected", allocations: [{ categoryId: groceries, amountMinorUnits: -2_000 }] });
      assert.equal(edited.statusCode, 200, edited.body);
      assert.equal(edited.json().previous.version.revision, 1);
      assert.equal(edited.json().previous.version.supersededAt, null, "`previous` is the state as it was read, before the stamp");
      assert.equal(edited.json().current.version.revision, 2);

      const history = await call("GET", `${space}/transactions/${transactionId}/history`);
      assert.equal(history.statusCode, 200, history.body);
      const versions = history.json().history as { version: { revision: number; supersededAt: string | null }; allocations: unknown[] }[];
      assert.deepEqual(versions.map((entry) => entry.version.revision), [1, 2]);
      assert.notEqual(versions[0]!.version.supersededAt, null, "CBD-201-AC04: the replaced version is retained, stamped");
      assert.equal(versions[1]!.version.supersededAt, null, "exactly one current version");
      assert.deepEqual(versions.map((entry) => entry.allocations.length), [2, 1], "each version keeps its own allocation set");

      const removed = await call("POST", `${space}/transactions/${transactionId}/remove`);
      assert.equal(removed.statusCode, 201, removed.body);
      assert.deepEqual(removed.json().current.allocations, [], "CBD-200-AC03: a tombstone carries no allocations");
      assert.notEqual(removed.json().current.version.removedAt, null);

      const afterRemoval = await call("GET", `${space}/transactions/${transactionId}/history`);
      assert.deepEqual((afterRemoval.json().history as { version: { revision: number } }[]).map((entry) => entry.version.revision), [1, 2, 3]);
    } finally { await app.close(); }
  });

  it("INCB-02: canonical field errors, including the exact-sum rule and an archived account", async () => {
    const { app, call, space, groceries, transport } = await application();
    try {
      for (const [body, status, error] of [
        [{ ...split(groceries, transport), allocations: [{ categoryId: groceries, amountMinorUnits: -800 }] }, 400, "allocation_sum_mismatch"],
        [{ ...split(groceries, transport), allocations: [] }, 400, "allocations_empty"],
        [{ ...split(groceries, transport), allocations: [{ categoryId: groceries, amountMinorUnits: -600 }, { categoryId: groceries, amountMinorUnits: -650 }] }, 400, "allocation_duplicate_category"],
        [{ ...split(groceries, transport), allocations: [{ categoryId: FOREIGN_CATEGORY, amountMinorUnits: -1_250 }] }, 400, "allocation_category_invalid"],
        [{ ...split(groceries, transport), budgetDate: "2026-02-30" }, 400, "date_invalid"],
        [{ ...split(groceries, transport), amountMinorUnits: -12.5 }, 400, "amount_not_integer"],
        [{ ...split(groceries, transport), budgetDate: "2026-11-15" }, 404, "period_not_found"],
        [{ ...split(groceries, transport), accountId: ACCOUNT_ARCHIVED }, 409, "account_archived"],
        [{ ...split(groceries, transport), accountId: "77777777-7777-4777-8777-777777779999" }, 404, "account_not_found"],
      ] as const) {
        const refused = await call("POST", `${space}/transactions`, body);
        assert.equal(refused.statusCode, status, `${error}: ${refused.body}`);
        assert.deepEqual(refused.json(), { error });
      }
      // SEC-P3-F1, the transaction half: an archived account refuses a transaction, and the policy never saw the account state.
      const editMissing = await call("PATCH", `${space}/transactions/00000000-0000-4000-8000-000000009999`, split(groceries, transport));
      assert.equal(editMissing.statusCode, 404, editMissing.body);
      assert.deepEqual(editMissing.json(), { error: "transaction_not_found" });
    } finally { await app.close(); }
  });

  it("INCB-03: the aggregate reports settled spent and remaining per category, and the detail itemizes one category", async () => {
    const { app, call, space, groceries, transport } = await application();
    try {
      await call("POST", `${space}/transactions`, split(groceries, transport));
      const progress = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress`);
      assert.equal(progress.statusCode, 200, progress.body);
      const body = progress.json();
      assert.equal(body.calculationVersion, "budget-domain/progress/1");
      assert.equal(body.currencyCode, "USD");
      const cell = (categoryId: string) => (body.cells as { categoryId: string; targetMinorUnits: number; settledActualMinorUnits: number; remainingAfterSettledMinorUnits: number; settledRecordIds: string[] }[]).find((entry) => entry.categoryId === categoryId)!;
      assert.equal(cell(groceries).targetMinorUnits, 50_000);
      assert.equal(cell(groceries).settledActualMinorUnits, -800, "signed: an expense is negative");
      assert.equal(cell(groceries).remainingAfterSettledMinorUnits, 49_200, "remaining = target + actual, unclamped");
      assert.equal(cell(transport).settledActualMinorUnits, -450);
      assert.equal(cell(transport).remainingAfterSettledMinorUnits, 19_550);
      assert.equal(body.labels[groceries], "Groceries");

      const detail = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${groceries}`);
      assert.equal(detail.statusCode, 200, detail.body);
      assert.equal(detail.json().categoryId, groceries);
      assert.equal(detail.json().label, "Groceries");
      assert.equal(detail.json().cell.settledActualMinorUnits, -800, "CBD-209: aggregate and detail agree for the same cell");
      const items = detail.json().items as { amountMinorUnits: number; description: string; budgetDate: string; allocationCount: number }[];
      assert.equal(items.length, 1);
      assert.equal(items[0]!.amountMinorUnits, -800);
      assert.equal(items[0]!.description, "Corner shop");
      assert.equal(items[0]!.budgetDate, "2026-09-15");
      // F-REVB-01: the row shows this category's share, and says the whole expense carries two.
      // Without this the client cannot tell a whole expense from a share of a split one.
      assert.equal(items[0]!.allocationCount, 2, "the whole transaction is split across two categories");
      assert.deepEqual(cell(groceries).settledRecordIds, [(detail.json().items as { allocationId: string }[])[0]!.allocationId]);

      // An excluded item appears in neither: the tombstone removes it from both at once.
      const transactionId = (detail.json().items as { transactionId: string }[])[0]!.transactionId;
      await call("POST", `${space}/transactions/${transactionId}/remove`);
      const after = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress`);
      assert.equal((after.json().cells as { categoryId: string; settledActualMinorUnits: number }[]).find((entry) => entry.categoryId === groceries)!.settledActualMinorUnits, 0);
      const detailAfter = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${groceries}`);
      assert.deepEqual(detailAfter.json().items, []);
    } finally { await app.close(); }
  });

  /**
   * BFIX-01 (F-REVB-01). A detail row is one allocation, and the client cannot
   * tell a whole expense from a share of a split one without being told. The
   * count is the whole version's, so a split expense reports two on either
   * category's page and a single-category expense reports one.
   */
  it("BFIX-01: every detail item states how many categories the whole expense is split across", async () => {
    const { app, call, space, groceries, transport } = await application();
    try {
      await call("POST", `${space}/transactions`, split(groceries, transport));
      await call("POST", `${space}/transactions`, { ...split(groceries, transport), amountMinorUnits: -300, description: "Milk", allocations: [{ categoryId: groceries, amountMinorUnits: -300 }] });

      const counted = async (categoryId: string) => {
        const detail = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${categoryId}`);
        assert.equal(detail.statusCode, 200, detail.body);
        // Both expenses carry the same budget date, so the route's tie-break is the allocation id;
        // this test is about the counts, so it compares a description-ordered projection.
        return (detail.json().items as { description: string; amountMinorUnits: number; allocationCount: number }[])
          .map((item) => [item.description, item.amountMinorUnits, item.allocationCount] as const)
          .sort((a, b) => a[0].localeCompare(b[0]));
      };
      assert.deepEqual(await counted(groceries), [["Corner shop", -800, 2], ["Milk", -300, 1]]);
      // The count is the transaction's, not this category's share of it, so the same expense
      // reports two from the other side of the split as well.
      assert.deepEqual(await counted(transport), [["Corner shop", -450, 2]]);
    } finally { await app.close(); }
  });

  /**
   * BFIX-02 (F-REVB-02). The datastore fact reader treats `resourceId ===
   * spaceId` as the whole-set case, so a row-targeted route handed the acting
   * space's own id would be authorized against the whole set -- for the
   * drill-down, a SPACE target, which `HO-236-09` excludes by name. Each route
   * refuses it with its own 404 in the replay hook, before authorization and
   * before any repository call.
   */
  it("BFIX-02: the acting space's own id is refused as a row id, before authorization", async () => {
    const { app, call, space, groceries, transport, repositoryCalls } = await application();
    try {
      await call("POST", `${space}/transactions`, split(groceries, transport));
      const before = repositoryCalls();
      for (const [method, path, payload, error] of [
        ["PATCH", `transactions/${SPACE_A}`, split(groceries, transport), "transaction_not_found"],
        ["POST", `transactions/${SPACE_A}/remove`, undefined, "transaction_not_found"],
        // The drill-down is the one that mattered: it used to answer an empty 200 after a space
        // target had been evaluated for it.
        ["GET", `periods/${PERIOD_A_OPEN}/progress/${SPACE_A}`, undefined, "allocation_category_invalid"],
      ] as const) {
        const refused = await call(method, `${space}/${path}`, payload);
        assert.equal(refused.statusCode, 404, `${method} ${path}: ${refused.body}`);
        assert.deepEqual(refused.json(), { error });
      }
      assert.equal(repositoryCalls(), before, "no refusal reached a handler, so none ran a query");
      // The real category still reads, so the refusal is of an identifier and not of the route.
      assert.equal((await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${groceries}`)).statusCode, 200);
    } finally { await app.close(); }
  });

  it("INCB-03: a category owned by another space is a policy denial, not a query miss", async () => {
    const { app, h, call, space, groceries, repositoryCalls } = await application();
    try {
      await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${groceries}`);
      const before = repositoryCalls();

      // What the production reader does with a foreign category: the tenant-scoped read of
      // `budget_category` returns nothing, so no `resource.*` leaf is produced at all and the
      // assembler refuses the input before the handler runs.
      h.corrupt = (source, facts) => {
        if (source !== "datastore") return;
        for (const path of Object.keys(facts)) if (path.startsWith("resource.")) delete facts[path];
      };
      const absentRow = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${FOREIGN_CATEGORY}`);
      assert.equal(absentRow.statusCode, 403, absentRow.body);
      assert.deepEqual(absentRow.json(), { outcome: "deny", reason: "denied" });

      // And if the row were visible, its own owning space is compared by `decide`: another space denies.
      h.corrupt = (source, facts) => { if (source === "datastore" && "resource.owningSpaceId" in facts) facts["resource.owningSpaceId"] = SPACE_B; };
      const foreignOwner = await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${FOREIGN_CATEGORY}`);
      assert.equal(foreignOwner.statusCode, 403, foreignOwner.body);

      h.corrupt = undefined;
      assert.equal(repositoryCalls(), before, "neither denial reached the handler, so neither ran a query");
      assert.equal((await call("GET", `${space}/periods/${PERIOD_A_OPEN}/progress/${groceries}`)).statusCode, 200, "the space's own category still reads");
    } finally { await app.close(); }
  });

  it("CBD-200-AC04 (QA-F01): a stated basis that is no longer current is refused 409 stale_version with the current version and nothing written", async () => {
    const { app, call, space, groceries, transport, ledger } = await application();
    try {
      const created = await call("POST", `${space}/transactions`, split(groceries, transport));
      assert.equal(created.statusCode, 201, created.body);
      const transactionId = created.json().current.version.transactionId as string;
      const basis = created.json().current.version.transactionVersionId as string;
      // Client A moves the transaction on, stating its basis in the body: admitted.
      const editA = await call("PATCH", `${space}/transactions/${transactionId}`, { ...split(groceries, transport), amountMinorUnits: -900, allocations: [{ categoryId: groceries, amountMinorUnits: -900 }], expectedTransactionVersionId: basis });
      assert.equal(editA.statusCode, 200, editA.body);
      const current = editA.json().current.version as { transactionVersionId: string; revision: number };
      assert.equal(current.revision, 2);
      // Client B, still holding revision 1, states the same basis in the body and in If-Match: refused, told what is current.
      const stale = { ...split(groceries, transport), amountMinorUnits: -700, allocations: [{ categoryId: transport, amountMinorUnits: -700 }], expectedTransactionVersionId: basis };
      for (const [payload, headers] of [
        [stale, {}],
        [split(groceries, transport), { "if-match": `"${basis}"` }],
        [stale, { "if-match": `"${basis}"` }],
      ] as const) {
        const editB = await call("PATCH", `${space}/transactions/${transactionId}`, payload, "opaque", headers);
        assert.equal(editB.statusCode, 409, editB.body);
        assert.deepEqual(editB.json(), { error: "stale_version", current: { transactionVersionId: current.transactionVersionId, revision: 2 } });
      }
      const removeB = await call("POST", `${space}/transactions/${transactionId}/remove`, { expectedTransactionVersionId: basis });
      assert.equal(removeB.statusCode, 409, removeB.body);
      assert.equal(removeB.json().error, "stale_version");
      assert.equal(ledger.versions.size, 2, "the stale mutations wrote no version");
      assert.equal([...ledger.versions.values()].filter((v) => v.supersededAt === null)[0]?.amountMinorUnits, -900, "A's edit stands");
      // The split proposal's older field name is refused, not silently ignored.
      const older = await call("PATCH", `${space}/transactions/${transactionId}`, { ...split(groceries, transport), expectedRevision: 1 });
      assert.equal(older.statusCode, 400, older.body);
      assert.deepEqual(older.json(), { error: "invalid_request" });
      // A weak or malformed tag is a 400, not a silently absent precondition.
      const weak = await call("PATCH", `${space}/transactions/${transactionId}`, split(groceries, transport), "opaque", { "if-match": `W/"${basis}"` });
      assert.equal(weak.statusCode, 400, weak.body);
      // Without a basis the route behaves as before; with the current basis it is admitted.
      const blind = await call("PATCH", `${space}/transactions/${transactionId}`, split(groceries, transport));
      assert.equal(blind.statusCode, 200, blind.body);
      const removed = await call("POST", `${space}/transactions/${transactionId}/remove`, undefined, "opaque", { "if-match": blind.json().current.version.transactionVersionId as string });
      assert.equal(removed.statusCode, 201, removed.body);
      assert.equal(ledger.versions.size, 4);
    } finally { await app.close(); }
  });

  it("CBD-200-AC05 (QA-F03): one Idempotency-Key yields one transaction, one effect, one revision; a different command under the same key is refused", async () => {
    const { app, call, space, groceries, transport, ledger, repositoryCalls } = await application();
    try {
      const key = "create-7c1d";
      const first = await call("POST", `${space}/transactions`, split(groceries, transport), "opaque", { "idempotency-key": key });
      assert.equal(first.statusCode, 201, first.body);
      const effects = repositoryCalls();
      const replay = await call("POST", `${space}/transactions`, split(groceries, transport), "opaque", { "idempotency-key": key });
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json(), first.json(), "the replay answers the stored response");
      assert.equal(repositoryCalls(), effects, "the replay ran no effect");
      assert.equal(ledger.versions.size, 1, "one transaction");
      assert.equal(ledger.allocations.size, 2, "one allocation set");
      assert.equal(ledger.idempotency.size, 1);
      const mismatch = await call("POST", `${space}/transactions`, { ...split(groceries, transport), description: "Different shop" }, "opaque", { "idempotency-key": key });
      assert.equal(mismatch.statusCode, 409, mismatch.body);
      assert.deepEqual(mismatch.json(), { error: "idempotency_mismatch" });
      assert.equal(ledger.versions.size, 1, "the mismatch wrote nothing");
      // A whitespace-only reordering of the same body is the same command.
      const reordered = Object.fromEntries(Object.entries(split(groceries, transport)).reverse());
      assert.equal((await call("POST", `${space}/transactions`, reordered, "opaque", { "idempotency-key": key })).statusCode, 201);
      assert.equal(ledger.versions.size, 1);

      const transactionId = first.json().current.version.transactionId as string;
      const editKey = "edit-9a2f";
      const edit = { ...split(groceries, transport), amountMinorUnits: -444, allocations: [{ categoryId: transport, amountMinorUnits: -444 }] };
      const edit1 = await call("PATCH", `${space}/transactions/${transactionId}`, edit, "opaque", { "idempotency-key": editKey });
      assert.equal(edit1.statusCode, 200, edit1.body);
      assert.equal(edit1.json().current.version.revision, 2);
      const edit2 = await call("PATCH", `${space}/transactions/${transactionId}`, edit, "opaque", { "idempotency-key": editKey });
      assert.equal(edit2.statusCode, 200, edit2.body);
      assert.deepEqual(edit2.json(), edit1.json());
      assert.equal(ledger.versions.size, 2, "one revision from the replayed edit");
      // The same key on a different action, or on a different target, is a different scope.
      const removeKey = editKey;
      const remove1 = await call("POST", `${space}/transactions/${transactionId}/remove`, {}, "opaque", { "idempotency-key": removeKey });
      assert.equal(remove1.statusCode, 201, remove1.body);
      const remove2 = await call("POST", `${space}/transactions/${transactionId}/remove`, {}, "opaque", { "idempotency-key": removeKey });
      assert.equal(remove2.statusCode, 201, remove2.body);
      assert.deepEqual(remove2.json(), remove1.json());
      assert.equal(ledger.versions.size, 3, "one tombstone from the replayed removal");
      assert.equal(ledger.idempotency.size, 3);
      // A malformed key is a 400; a request that does not parse is the handler's own 400, with no identity recorded.
      assert.equal((await call("POST", `${space}/transactions`, split(groceries, transport), "opaque", { "idempotency-key": "has space" })).statusCode, 400);
      const bad = await call("POST", `${space}/transactions`, { ...split(groceries, transport), amountMinorUnits: "x" }, "opaque", { "idempotency-key": "bad-1" });
      assert.equal(bad.statusCode, 400, bad.body);
      assert.equal(ledger.idempotency.size, 3);
    } finally { await app.close(); }
  });

  it("CBD-200-AC04 (QA-F02): the commit-time one-current-version refusal and the serialization failures are a 409 conflict, once; every other commit failure stays the denial", async () => {
    const conflicts = [
      new StatementFailedError("transaction", "commit", "23514", "manual_transaction_assert_one_current"),
      new StatementFailedError("transaction", "commit", "40001"),
      new StatementFailedError("transaction", "commit", "40P01"),
      new StatementFailedError("transaction", "commit", "23505", "manual_transaction_one_current"),
    ];
    const denials = [
      new StatementFailedError("transaction", "commit", "23514"),
      new StatementFailedError("transaction", "commit", "23514", "transaction_allocation_exact_sum"),
      new StatementFailedError("transaction", "commit", "23503", "manual_transaction_period_id_fkey"),
      new StatementFailedError("transaction", "work", "40001"),
      new StatementFailedError("manual_transaction", "update", "23514", "manual_transaction_assert_one_current"),
      new Error("anything else"),
    ];
    for (const error of conflicts) { const mapped = commitConflict(error); assert.ok(mapped instanceof RouteFailure); assert.equal(mapped.status, 409); assert.deepEqual(mapped.response, { error: "conflict" }); }
    for (const error of denials) assert.equal(commitConflict(error), null);
    // Through the store: the transaction seam rejects at commit; the store answers the route failure the boundary transports, and reports the rollback.
    const outcomes: string[] = [];
    for (const error of [...conflicts, ...denials]) {
      const client = { transaction: async (_options: unknown, work: (client: unknown) => Promise<unknown>) => { await work({ handle: true }); throw error; } } as unknown as DataAccessClient;
      const store = new TransactionsAuthorizationStore(client);
      store.observe({ committed: () => outcomes.push("committed"), rolledBack: () => outcomes.push("rolledBack") });
      const expectedConflict = commitConflict(error) !== null;
      if (expectedConflict) {
        const result: unknown = await store.transaction(async () => "unreached");
        assert.ok(result instanceof RouteFailure); assert.equal(result.status, 409);
      } else await assert.rejects(() => store.transaction(async () => "unreached"), (thrown: unknown) => thrown === error);
    }
    assert.deepEqual(outcomes, new Array(conflicts.length + denials.length).fill("rolledBack"));
  });

  it("INCB-03: a period that is not this budget's is a canonical 404, and every route denies a subject without membership", async () => {
    const { app, call, space, groceries, transport, memberships } = await application();
    try {
      const missing = await call("GET", `${space}/periods/99999999-9999-4999-8999-999999999999/progress`);
      assert.equal(missing.statusCode, 404, missing.body);
      assert.deepEqual(missing.json(), { error: "period_not_found" });

      delete memberships[`${MEMBER}:${SPACE_A}`];
      for (const [method, path, payload] of [
        ["POST", "transactions", split(groceries, transport)],
        ["PATCH", "transactions/00000000-0000-4000-8000-000000000001", split(groceries, transport)],
        ["POST", "transactions/00000000-0000-4000-8000-000000000001/remove", undefined],
        ["GET", "transactions/00000000-0000-4000-8000-000000000001/history", undefined],
        ["GET", `periods/${PERIOD_A_OPEN}/progress`, undefined],
        ["GET", `periods/${PERIOD_A_OPEN}/progress/${groceries}`, undefined],
      ] as const) {
        const denied = await call(method, `${space}/${path}`, payload);
        assert.equal(denied.statusCode, 403, `${method} ${path}: ${denied.body}`);
      }
    } finally { await app.close(); }
  });
});
