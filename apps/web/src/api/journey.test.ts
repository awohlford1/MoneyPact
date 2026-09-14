import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpClient, ApiError } from "./client.ts";
import { createServerMock } from "./mock-server.ts";
import { CreationController } from "./creation-controller.ts";
import type { Draft, Proposal } from "./proposals.ts";

const draft: Draft = { name: "Our plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };
const clock = () => Date.parse("2026-09-13T12:00:00Z");
test("Identity revision 2: POST begin, signed-out 403, and fresh CSRF cookie on logout", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let cookie = "";
  const api = createHttpClient("/v1", (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/begin")) return Response.json({ navigateTo: "/v1/identity/authorize" });
    if (url.endsWith("/me")) return Response.json({}, { status: 403 });
    return new Response(null, { status: 204 });
  }) as typeof fetch, () => cookie);
  assert.equal(await api.begin(), "/v1/identity/authorize");
  assert.equal(calls[0].init!.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), { ceremony: "sign_in", postResultDestinationId: "home" });
  assert.equal(await api.me(), null);
  await assert.rejects(api.logout(), ApiError);
  cookie = "unrelated=value; __Host-cobudget_csrf=rotated-fixture";
  await api.logout();
  assert.equal((calls.at(-1)!.init!.headers as Record<string, string>)["x-csrf-token"], "rotated-fixture");
});
async function reviewed() {
  const api = createServerMock(clock);
  const controller = new CreationController(api, structuredClone(draft), "subject", clock);
  await controller.preview();
  const proposal = controller.snapshot().proposal!;
  controller.rendered(proposal.proposalId, "subject");
  return { api, controller, proposal };
}
test("CBD-242-AC01: canonical errors preserve unrelated raw input", async () => {
  const { controller } = await reviewed();
  controller.edit({ ...draft, name: "", timeZone: "Europe/Paris" });
  await controller.preview();
  assert.equal(controller.snapshot().draft.timeZone, "Europe/Paris");
  assert.deepEqual(controller.snapshot().errors[0], { code: "name.required", path: "name", message: "Enter a budget name." });
  assert.equal(controller.canConfirm(), false);
});
test("CBD-242-AC02: HTTP confirms using only binding body, proposal route, idempotency header", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(url.endsWith("/me") ? { accountSubjectId: "s", sessionRef: "r", sessionVersion: 1, csrf: "test-csrf" } : {});
  }) as typeof fetch;
  const api = createHttpClient("/v1", fetcher, () => "__Host-cobudget_csrf=test-csrf");
  await api.me(); await api.confirmProposal("proposal", "binding", "confirmation-request-id");
  assert.equal(calls[1].url, "/v1/budget-creation-proposals/proposal/confirm");
  assert.deepEqual(JSON.parse(calls[1].init!.body as string), { confirmationBinding: "binding" });
  assert.equal((calls[1].init!.headers as Record<string, string>)["x-csrf-token"], "test-csrf");
  assert.equal((calls[1].init!.headers as Record<string, string>)["Idempotency-Key"], "confirmation-request-id");
  assert.equal(calls[1].init!.credentials, "same-origin");
  assert.equal(calls[1].init!.cache, "no-store");
});
test("CBD-242-AC03: complete current period and three following periods are server results", async () => {
  const { proposal } = await reviewed();
  assert.deepEqual(proposal.preview.periods.map(period => [period.start, period.end, period.lengthInDays]), [["2026-09-01", "2026-09-30", 30], ["2026-10-01", "2026-10-31", 31], ["2026-11-01", "2026-11-30", 30], ["2026-12-01", "2026-12-31", 31]]);
  assert.equal(proposal.normalizedInputs.name, draft.name);
  assert.equal(proposal.preview.cadenceSummary, "Monthly on day 1");
});
test("CBD-242-AC04: confirmation requires rendering for the same subject and proposal", async () => {
  const api = createServerMock(clock); const controller = new CreationController(api, draft, "subject", clock);
  assert.equal(controller.canConfirm(), false); await controller.preview();
  const proposal = controller.snapshot().proposal!;
  assert.equal(controller.canConfirm(), false);
  controller.rendered("other", "subject"); assert.equal(controller.canConfirm(), false);
  controller.rendered(proposal.proposalId, "other"); assert.equal(controller.canConfirm(), false);
  controller.rendered(proposal.proposalId, "subject"); assert.equal(controller.canConfirm(), true);
  assert.equal(await controller.confirm("other"), undefined);
});
test("CBD-242-AC04: changed reviewed content is immutable and cannot confirm", async () => {
  const { controller, proposal } = await reviewed();
  assert.throws(() => { proposal.preview.periods[0].start = "2020-01-01"; }, TypeError);
  controller.edit({ ...draft, name: "Updated" }); assert.equal(controller.canConfirm(), false);
});
test("CBD-242-AC05: expiry and budget midnight invalidate without client date calculation", async () => {
  let now = Date.parse("2026-09-14T03:59:50Z");
  const api = createServerMock(() => now); const controller = new CreationController(api, draft, "subject", () => now);
  await controller.preview(); const old = controller.snapshot().proposal!;
  assert.equal(old.expiresAt, "2026-09-14T04:00:00.000Z");
  controller.rendered(old.proposalId, "subject"); assert.equal(controller.canConfirm(), true);
  now += 10000; assert.equal(controller.canConfirm(), false); await controller.revalidate();
  assert.notEqual(controller.snapshot().proposal?.proposalId, old.proposalId);
  assert.equal(controller.snapshot().proposal?.preview.budgetDate, "2026-09-14");
});
test("CBD-242-AC05: governing version change regenerates instead of confirming", async () => {
  const { api } = await reviewed();
  const original = api.readProposal;
  let changed = false;
  api.readProposal = async (...args) => { const read = await original(...args); if (changed) read.proposal.governingVersions.periodContractVersion = "changed"; return read; };
  const controller = new CreationController(api, draft, "subject", clock); await controller.preview();
  const id = controller.snapshot().proposal!.proposalId; controller.rendered(id, "subject"); changed = true;
  assert.equal(await controller.confirm("subject"), undefined);
  assert.notEqual(controller.snapshot().proposal?.proposalId, id);
  assert.equal((await api.listBudgets()).length, 0);
});
test("CBD-242-AC06: out-of-order preview cannot replace a newer edit", async () => {
  const api = createServerMock(clock); const original = api.createProposal;
  const release: (() => void)[] = [];
  api.createProposal = async (...args) => { const proposal = await original(...args); await new Promise<void>(resolve => release.push(resolve)); return proposal; };
  const controller = new CreationController(api, draft, "subject", clock);
  const first = controller.preview(); await Promise.resolve();
  controller.edit({ ...draft, name: "Latest" }); const second = controller.preview(); await Promise.resolve();
  release[1](); await second; release[0](); await first;
  assert.equal(controller.snapshot().proposal?.normalizedInputs.name, "Latest");
});
test("CBD-242-AC06: disposed navigation response is discarded; resumed draft gets a new identity", async () => {
  const api = createServerMock(clock); const controller = new CreationController(api, draft, "subject", clock);
  const pending = controller.preview(); controller.dispose(); await pending;
  assert.equal(controller.snapshot().proposal, undefined);
  const one = new CreationController(api, draft, "subject", clock); const two = new CreationController(api, draft, "subject", clock);
  await Promise.all([one.preview(), two.preview()]);
  assert.notEqual(one.snapshot().proposal!.proposalId, two.snapshot().proposal!.proposalId);
  assert.equal(one.canConfirm(), false); assert.equal(two.canConfirm(), false);
});
test("CBD-218-AC01: created budget and plan use exact committed server identities", async () => {
  const { api, controller } = await reviewed(); const result = (await controller.confirm("subject"))!;
  const budget = await api.budget(result.budgetSpaceId);
  assert.equal(budget.activePeriod!.id, result.currentPeriodId);
  assert.equal(budget.activePeriod!.scheduleVersionId, result.currentScheduleVersionId);
  const category = await api.addCategory(budget.id, "Groceries");
  await api.saveTarget(budget.id, category.id, "450.00", 0);
  const plan = await api.plan(budget.id, result.currentPeriodId);
  assert.equal(plan.budgetSpaceId, result.budgetSpaceId); assert.equal(plan.periodId, result.currentPeriodId);
  assert.equal(plan.targets[0].periodAmount, "450.00");
  await assert.rejects(api.saveTarget(budget.id, category.id, "500", 0), (error: unknown) => error instanceof ApiError && error.status === 409);
});
test("PROTO-SIGNIN-01: logout denies subsequent protected mock reads", async () => {
  const { api } = await reviewed(); assert.ok(await api.me()); await api.logout(); assert.equal(await api.me(), null);
  await assert.rejects(api.listBudgets(), (error: unknown) => error instanceof ApiError && error.status === 401);
});
test("Mock confirmation consumes once under a same-proposal race", async () => {
  const { api, proposal } = await reviewed();
  const outcomes = await Promise.allSettled([api.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "first-confirmation"), api.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "second-confirmation")]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal((await api.listBudgets()).length, 1);
});
test("Client sends no session authority in Authorization or durable storage", async () => {
  const api = createHttpClient("/v1", (async () => Response.json({ error: "unauthenticated" }, { status: 401 })) as typeof fetch);
  assert.equal(await api.me(), null);
  await assert.rejects(api.addCategory("id", "Name"), ApiError);
});
test("Incomplete server preview never enables confirmation", async () => {
  const { api, proposal } = await reviewed();
  api.createProposal = async () => ({ ...structuredClone(proposal), preview: { ...proposal.preview, periods: [] } } as Proposal);
  const controller = new CreationController(api, draft, "subject", clock); await controller.preview();
  assert.equal(controller.snapshot().stage, "error"); assert.equal(controller.canConfirm(), false);
});
test("CBD-242-AC05: fake-timer 30-minute expiry disables the rendered preview", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: clock() });
  const api = createServerMock(); const controller = new CreationController(api, draft, "subject");
  await controller.preview(); controller.rendered(controller.snapshot().proposal!.proposalId, "subject");
  assert.equal(controller.canConfirm(), true); t.mock.timers.tick(30 * 60 * 1000);
  assert.equal(controller.canConfirm(), false); await controller.revalidate();
  assert.equal(controller.snapshot().stage, "review");
});
for (const schedule of [
  { cadence: "weekly", anchor: "monday" },
  { cadence: "monthly", anchor: { kind: "last-day" } },
  { cadence: "custom-fixed-length", startBoundary: "2026-09-01", lengthInDays: 14 },
  ...[
    { kind: "weekly", weekday: "friday" },
    { kind: "twice-per-week", weekdays: ["tuesday", "friday"] },
    { kind: "every-two-weeks", weekday: "friday", recurrenceOrigin: "2026-09-04" },
    { kind: "monthly", anchor: { kind: "last-day" } },
    { kind: "twice-per-month", anchors: [{ kind: "day-of-month", day: 1 }, { kind: "day-of-month", day: 15 }] },
    { kind: "custom-weekly-interval", weekday: "friday", everyWeeks: 3, recurrenceOrigin: "2026-09-04" },
  ].map(pattern => ({ cadence: "paycheck", pattern, businessDayPolicy: "previous-business-day" })),
]) test(`Server mock supports schedule ${JSON.stringify(schedule)}`, async () => {
  const api = createServerMock(clock);
  const proposal = await api.createProposal({ ...draft, schedule }, crypto.randomUUID());
  assert.equal(proposal.preview.periods.length, 4);
  assert.deepEqual(proposal.normalizedInputs.schedule, schedule);
  assert.ok(proposal.preview.periods.every(period => period.lengthInDays > 0));
});
