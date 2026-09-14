import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { expectedProvenance, ordinaryFixture } from "@cobudget/contracts/authorization";
import type { PolicyInput } from "@cobudget/contracts/authorization";
import { fullPeriodTargets } from "../../../../packages/budget-domain/src/targets/index.ts";
import { toISODate } from "../../../../packages/budget-domain/src/shared/index.ts";
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { PERIOD_A_OPEN, PERIOD_B_OPEN, SPACE_A, SPACE_B, testWorld } from "../../../../packages/budget-application/src/targets/support.ts";
import { AppModule } from "../app.module.js";
import { RouteFailure } from "../authorization/http.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { targetsHttp } from "./http.js";
import type { TargetsHttpDependencies } from "./http.js";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "targets-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const ROUTES = ["/v1/budget-spaces/:budgetSpaceId/categories", "/v1/budget-spaces/:budgetSpaceId/targets", "/v1/budget-spaces/:budgetSpaceId/plan"];
const MEMBER = "subject-1";

/** The p1 ordinary fixture, re-pointed at one of the test budget spaces. Facts for every action are the same; the resource type comes from the route's operation. */
function factsFor(spaceId: string): PolicyInput {
  const base = ordinaryFixture("1.view_space");
  const input = { ...base, space: { ...base.space, spaceId }, resource: { ...base.resource, owningSpaceId: spaceId }, assurance: { ...base.assurance, boundSpaceId: spaceId } };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

async function application() {
  const world = testWorld();
  const h = new Harness(factsFor(SPACE_A));
  // The Harness store knows only bootstrap obligations; the targets store discharges p1's `preserve` structurally.
  const discharge = h.store.discharge.bind(h.store);
  h.store.discharge = async (transaction, input, obligation) => obligation.kind === "preserve" || discharge(transaction, input, obligation);
  // And, like the production TargetsAuthorizationStore, returns a rolled-back RouteFailure instead of throwing it.
  const transaction = h.store.transaction.bind(h.store);
  h.store.transaction = async <T>(work: (transaction: unknown) => Promise<T>): Promise<T> => {
    try { return await transaction(work); } catch (error) { if (error instanceof RouteFailure) return error as T; throw error; }
  };
  const memberships: Record<string, string | undefined> = { [`${MEMBER}:${SPACE_A}`]: "membership-1", [`${MEMBER}:${SPACE_B}`]: "membership-1" };
  let repositoryCalls = 0;
  const dependencies: TargetsHttpDependencies = {
    repository: () => { repositoryCalls++; return world.repository; },
    membership: async (subject, spaceId) => memberships[`${subject}:${spaceId}`] ?? null,
    clock: { now: () => world.now }, ids: world.ids,
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      modules: [targetsHttp(dependencies).module],
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
  const call = (method: "GET" | "PUT" | "HEAD", url: string, payload?: unknown, cookie: string | undefined = "opaque") =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }), ...(cookie === undefined ? {} : { headers: { cookie } }) });
  return { app, h, world, call, repositoryCalls: () => repositoryCalls, memberships };
}

describe("CBD-153 category and target routes through the real Fastify instance", () => {
  it("PROTO-PLAN-01: categories, base targets and the active period's plan, matching budget-domain for the same inputs", async () => {
    const { app, h, call, world } = await application();
    try {
      const created = await call("PUT", `/v1/budget-spaces/${SPACE_A}/categories`, { categories: [{ label: "Groceries" }, { label: "Rent" }, { label: "Fun" }] });
      assert.equal(created.statusCode, 200, created.body);
      const categories = created.json().categories as { categoryId: string; label: string; position: number }[];
      assert.deepEqual(categories.map((c) => [c.label, c.position]), [["Groceries", 0], ["Rent", 1], ["Fun", 2]]);
      assert.deepEqual(h.order, ["begin", "allow-audit", "commit"]);
      const [groceries, rent, fun] = categories;

      const listed = await call("GET", `/v1/budget-spaces/${SPACE_A}/categories`);
      assert.equal(listed.statusCode, 200); assert.deepEqual(listed.json(), { budgetSpaceId: SPACE_A, categories });

      const targets = await call("PUT", `/v1/budget-spaces/${SPACE_A}/targets`, { targets: [{ categoryId: groceries!.categoryId, amountMinorUnits: 40000 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }] });
      assert.equal(targets.statusCode, 200, targets.body);
      assert.equal(targets.json().cadence, "monthly"); assert.equal(targets.json().currencyCode, "USD"); assert.equal(targets.json().minorUnitPrecision, 2);
      assert.deepEqual((targets.json().targets as { categoryId: string; amountMinorUnits: number; setBySubjectId: string; source: string }[]).map((t) => [t.categoryId, t.amountMinorUnits, t.setBySubjectId, t.source]),
        [[groceries!.categoryId, 40000, MEMBER, "user"], [rent!.categoryId, 150000, MEMBER, "user"]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

      const plan = await call("GET", `/v1/budget-spaces/${SPACE_A}/plan`);
      assert.equal(plan.statusCode, 200, plan.body);
      const body = plan.json();
      assert.equal(body.period.periodId, PERIOD_A_OPEN); assert.equal(body.period.completed, false); assert.equal(body.formulaVersion, "budget-domain/targets/1");
      const direct = fullPeriodTargets({ cadence: "monthly", currency: "USD", targets: [
        { categoryId: groceries!.categoryId, amountMinorUnits: 40000 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }, { categoryId: fun!.categoryId, amountMinorUnits: 0 } ] },
        "monthly", { start: toISODate("2026-09-01"), end: toISODate("2026-09-30") });
      assert.equal(body.categories.length, 3);
      for (const expected of direct) {
        const category = body.categories.find((c: { categoryId: string }) => c.categoryId === expected.categoryId);
        assert.equal(category.periodTarget.amountMinorUnits, expected.amountMinorUnits);
        assert.equal(category.periodTarget.origin, "full-period"); assert.equal(category.periodTarget.calculation, null);
        assert.equal(category.periodTarget.provenance.formulaVersion, "budget-domain/targets/1");
        assert.equal(category.periodTarget.provenance.persisted, true);
        assert.equal(category.periodTarget.provenance.computedBySubjectId, MEMBER);
        assert.deepEqual(category.periodTarget.provenance.inputs.period, { start: "2026-09-01", end: "2026-09-30" });
        assert.equal(category.periodTarget.provenance.inputs.baseAmountMinorUnits, expected.amountMinorUnits);
      }
      assert.equal(body.categories.find((c: { categoryId: string }) => c.categoryId === fun!.categoryId).baseTarget, null);
      assert.equal((await world.repository.listPeriodTargets(SPACE_A, PERIOD_A_OPEN)).length, 3);
      const explicit = await call("GET", `/v1/budget-spaces/${SPACE_A}/plan?periodId=${PERIOD_A_OPEN}`);
      assert.deepEqual(explicit.json(), body);
    } finally { await app.close(); }
  });

  it("PROTO-PLAN-02: a subject without membership is denied before any repository call, and an unauthenticated request likewise", async () => {
    const { app, h, call, repositoryCalls, memberships } = await application();
    try {
      await call("PUT", `/v1/budget-spaces/${SPACE_A}/categories`, { categories: [{ label: "Groceries" }] });
      const before = repositoryCalls();
      delete memberships[`${MEMBER}:${SPACE_A}`];
      for (const [method, url, payload] of [["GET", "categories"], ["PUT", "categories", { categories: [] }], ["PUT", "targets", { targets: [] }], ["GET", "plan"]] as const) {
        const response = await call(method, `/v1/budget-spaces/${SPACE_A}/${url}`, payload);
        assert.equal(response.statusCode, 403, `${method} ${url}`); assert.deepEqual(response.json(), { outcome: "deny", reason: "denied" });
      }
      assert.equal(repositoryCalls(), before);
      assert.equal(h.state.audits.at(-1)?.outcome, "deny");
      const anonymous = await call("GET", `/v1/budget-spaces/${SPACE_A}/categories`, undefined, undefined);
      assert.equal(anonymous.statusCode, 403);
      assert.equal(repositoryCalls(), before);
    } finally { await app.close(); }
  });

  it("PROTO-PLAN-02: one space's categories and targets are invisible through another space's identifier", async () => {
    const { app, h, call } = await application();
    try {
      const created = await call("PUT", `/v1/budget-spaces/${SPACE_A}/categories`, { categories: [{ label: "Groceries" }] });
      const groceries = created.json().categories[0].categoryId as string;
      await call("PUT", `/v1/budget-spaces/${SPACE_A}/targets`, { targets: [{ categoryId: groceries, amountMinorUnits: 100 }] });
      h.input = factsFor(SPACE_B);
      const listed = await call("GET", `/v1/budget-spaces/${SPACE_B}/categories`);
      assert.equal(listed.statusCode, 200); assert.deepEqual(listed.json(), { budgetSpaceId: SPACE_B, categories: [] });
      const foreignPeriod = await call("GET", `/v1/budget-spaces/${SPACE_B}/plan?periodId=${PERIOD_A_OPEN}`);
      assert.equal(foreignPeriod.statusCode, 404); assert.deepEqual(foreignPeriod.json(), { error: "period_not_found" });
      const foreignCategory = await call("PUT", `/v1/budget-spaces/${SPACE_B}/targets`, { targets: [{ categoryId: groceries, amountMinorUnits: 5 }] });
      assert.equal(foreignCategory.statusCode, 404); assert.deepEqual(foreignCategory.json(), { error: "category_not_found" });
      const relabel = await call("PUT", `/v1/budget-spaces/${SPACE_B}/categories`, { categories: [{ categoryId: groceries, label: "Stolen" }] });
      assert.equal(relabel.statusCode, 404); assert.deepEqual(relabel.json(), { error: "category_not_found" });
      const ownPlan = await call("GET", `/v1/budget-spaces/${SPACE_B}/plan?periodId=${PERIOD_B_OPEN}`);
      assert.equal(ownPlan.statusCode, 200); assert.deepEqual(ownPlan.json().categories, []);
      // A membership in B says nothing about A: the facts are B's, so A's identifier is refused outright.
      const crossed = await call("GET", `/v1/budget-spaces/${SPACE_A}/categories`);
      assert.equal(crossed.statusCode, 403);
    } finally { await app.close(); }
  });

  it("CBD-153-AC04 and request shape: stable statuses for negative amounts, bad precision, malformed ids and an unknown category", async () => {
    const { app, call, world } = await application();
    try {
      const created = await call("PUT", `/v1/budget-spaces/${SPACE_A}/categories`, { categories: [{ label: "Groceries" }] });
      const groceries = created.json().categories[0].categoryId as string;
      const cases: [string, unknown, number, string][] = [
        ["targets", { targets: [{ categoryId: groceries, amountMinorUnits: -1 }] }, 400, "amount_negative"],
        ["targets", { targets: [{ categoryId: groceries, amountMinorUnits: 1.5 }] }, 400, "amount_invalid"],
        ["targets", { targets: [{ categoryId: "99999999-9999-4999-8999-999999999999", amountMinorUnits: 1 }] }, 404, "category_not_found"],
        ["targets", { nope: true }, 400, "invalid_request"],
        ["categories", { categories: [{ label: "" }] }, 400, "label_invalid"],
        ["categories", { categories: [{ label: "groceries" }] }, 409, "label_taken"],
      ];
      for (const [url, payload, status, error] of cases) {
        const response = await call("PUT", `/v1/budget-spaces/${SPACE_A}/${url}`, payload);
        assert.equal(response.statusCode, status, `${url} ${error}: ${response.body}`); assert.deepEqual(response.json(), { error });
      }
      world.repository.seedPlanContext({ ...(await world.repository.readPlanContext(SPACE_A, null))!, currencyCode: "CLF" });
      const precision = await call("PUT", `/v1/budget-spaces/${SPACE_A}/targets`, { targets: [{ categoryId: groceries, amountMinorUnits: 1 }] });
      assert.equal(precision.statusCode, 400); assert.deepEqual(precision.json(), { error: "currency_precision_unsupported" });
      const malformed = await call("GET", "/v1/budget-spaces/not-a-uuid/plan");
      assert.equal(malformed.statusCode, 404); assert.deepEqual(malformed.json(), { error: "budget_space_not_found" });
      const badPeriod = await call("GET", `/v1/budget-spaces/${SPACE_A}/plan?periodId=nope`);
      assert.equal(badPeriod.statusCode, 400); assert.deepEqual(badPeriod.json(), { error: "invalid_request" });
      assert.equal((await call("HEAD", `/v1/budget-spaces/${SPACE_A}/plan`)).statusCode, 403, "derived HEAD routes carry no decision and are denied");
    } finally { await app.close(); }
  });
});
