import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpClient, ApiError, formatMinorUnits, parseMajorUnits, toBudgetDetail, toPlan } from "./client.ts";
import type { WirePlan, WireSpaceDetail } from "./client.ts";
import { createMockClient } from "./mock-server.ts";
import { CreationController, sameProposal } from "./creation-controller.ts";
import type { Draft, Proposal } from "./proposals.ts";

const draft: Draft = { name: "Our plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };
const clock = () => Date.parse("2026-09-13T12:00:00Z");
const bootstrap = { accountSubjectId: "s", profileId: "p", identityBindingId: "b", sessionRef: "r", sessionVersion: 1, environmentId: "development", assurance: "session" };

test("CBD-191 section 5.1: POST begin needs no CSRF, signed-out 403 is null, and the bootstrap value is captured in memory and echoed in X-CoBudget-CSRF without any cookie read", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let signedIn = false;
  const api = createHttpClient("/v1", (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/begin")) return Response.json({ navigateTo: "/v1/identity/local/authorize?x=1" });
    if (url.endsWith("/me")) {
      if (!signedIn) return Response.json({ outcome: "deny", reason: "denied" }, { status: 403 });
      return Response.json({ ...bootstrap, csrfValue: "bootstrap-fixture" });
    }
    return Response.json({ signedOut: true });
  }) as typeof fetch);
  assert.equal(await api.begin(), "/v1/identity/local/authorize?x=1");
  assert.equal(calls[0].init!.method, "POST");
  assert.equal((calls[0].init!.headers as Record<string, string>)["X-CoBudget-CSRF"], undefined);
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), { ceremony: "sign_in", postResultDestinationId: "budgets" });
  assert.equal(await api.me(), null);
  await assert.rejects(api.logout(), (error: unknown) => error instanceof ApiError && error.status === 401, "no bootstrap value: no mutation is attempted");
  signedIn = true;
  assert.deepEqual(await api.me(), { accountSubjectId: "s", sessionRef: "r", sessionVersion: 1 });
  assert.deepEqual(await api.me(), { accountSubjectId: "s", sessionRef: "r", sessionVersion: 1 });
  await api.logout();
  const logout = calls.at(-1)!;
  assert.equal(logout.url, "/v1/identity/logout");
  assert.equal((logout.init!.headers as Record<string, string>)["X-CoBudget-CSRF"], "bootstrap-fixture");
  assert.equal(logout.init!.credentials, "same-origin");
  await assert.rejects(api.logout(), (error: unknown) => error instanceof ApiError && error.status === 401, "logout drops the held value");
  assert.ok(!calls.some(call => JSON.stringify(call.init?.headers ?? {}).includes("x-csrf-token")), "the legacy cookie-backed header is gone");
});
async function reviewed() {
  const api = createMockClient(clock);
  assert.ok(await api.me());
  const controller = new CreationController(api, structuredClone(draft), "subject", clock);
  await controller.preview();
  const proposal = controller.snapshot().proposal!;
  controller.rendered(proposal.proposalId, "subject");
  // CBD-236: the review is not confirmable until the disclosure is explicitly acknowledged.
  controller.acknowledge(true);
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
    return Response.json(url.endsWith("/me") ? { ...bootstrap, csrfValue: "test-csrf" } : {});
  }) as typeof fetch;
  const api = createHttpClient("/v1", fetcher);
  await api.me(); await api.confirmProposal("proposal", "binding", "confirmation-request-id", { kind: "primary_owner_self", version: 1 });
  assert.equal(calls[1].url, "/v1/budget-creation-proposals/proposal/confirm");
  // CBD-236: the body is still closed -- the binding plus the acknowledged disclosure, and nothing else.
  assert.deepEqual(JSON.parse(calls[1].init!.body as string), { confirmationBinding: "binding", acknowledgedDisclosure: { kind: "primary_owner_self", version: 1 } });
  assert.equal((calls[1].init!.headers as Record<string, string>)["X-CoBudget-CSRF"], "test-csrf");
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
  const api = createMockClient(clock); await api.me(); const controller = new CreationController(api, draft, "subject", clock);
  assert.equal(controller.canConfirm(), false); await controller.preview();
  const proposal = controller.snapshot().proposal!;
  assert.equal(controller.canConfirm(), false);
  controller.rendered("other", "subject"); assert.equal(controller.canConfirm(), false);
  controller.rendered(proposal.proposalId, "other"); assert.equal(controller.canConfirm(), false);
  controller.rendered(proposal.proposalId, "subject");
  // CBD-236: rendering is not enough; the disclosure must be explicitly acknowledged.
  assert.equal(controller.canConfirm(), false, "the acknowledgement is required");
  controller.acknowledge(true); assert.equal(controller.canConfirm(), true);
  controller.acknowledge(false); assert.equal(controller.canConfirm(), false, "withdrawing it disables confirmation again");
  controller.acknowledge(true);
  assert.equal(await controller.confirm("other"), undefined);
});
test("CBD-242-AC04: changed reviewed content is immutable and cannot confirm", async () => {
  const { controller, proposal } = await reviewed();
  assert.throws(() => { proposal.preview.periods[0].start = "2020-01-01"; }, TypeError);
  controller.edit({ ...draft, name: "Updated" }); assert.equal(controller.canConfirm(), false);
});
test("PROTO-ACTIVATION-001: a re-read proposal with a different JSON key order (jsonb storage) is the same proposal; a changed value is not", async () => {
  const { proposal } = await reviewed();
  const reordered = JSON.parse(JSON.stringify({ ...proposal, normalizedInputs: { schedule: proposal.normalizedInputs.schedule, currencyCode: proposal.normalizedInputs.currencyCode, timeZone: proposal.normalizedInputs.timeZone, name: proposal.normalizedInputs.name } })) as Proposal;
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(proposal));
  assert.equal(sameProposal(reordered, proposal), true);
  assert.equal(sameProposal({ ...reordered, previewDigest: "other" }, proposal), false);
});
test("CBD-242-AC05: expiry and budget midnight invalidate without client date calculation", async () => {
  let now = Date.parse("2026-09-14T03:59:50Z");
  const api = createMockClient(() => now); await api.me(); const controller = new CreationController(api, draft, "subject", () => now);
  await controller.preview(); const old = controller.snapshot().proposal!;
  assert.equal(old.expiresAt, "2026-09-14T04:00:00.000Z");
  controller.rendered(old.proposalId, "subject"); controller.acknowledge(true); assert.equal(controller.canConfirm(), true);
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
  const id = controller.snapshot().proposal!.proposalId; controller.rendered(id, "subject"); controller.acknowledge(true); changed = true;
  assert.equal(await controller.confirm("subject"), undefined);
  assert.notEqual(controller.snapshot().proposal?.proposalId, id);
  assert.equal((await api.listBudgets()).length, 0);
});
test("CBD-242-AC06: out-of-order preview cannot replace a newer edit", async () => {
  const api = createMockClient(clock); await api.me(); const original = api.createProposal;
  const release: (() => void)[] = [];
  api.createProposal = async (...args) => { const proposal = await original(...args); await new Promise<void>(resolve => release.push(resolve)); return proposal; };
  const controller = new CreationController(api, draft, "subject", clock);
  const settle = async (count: number) => { while (release.length < count) await new Promise(resolve => setImmediate(resolve)); };
  const first = controller.preview(); await settle(1);
  controller.edit({ ...draft, name: "Latest" }); const second = controller.preview(); await settle(2);
  release[1]!(); await second; release[0]!(); await first;
  assert.equal(controller.snapshot().proposal?.normalizedInputs.name, "Latest");
});
test("CBD-242-AC06: disposed navigation response is discarded; resumed draft gets a new identity", async () => {
  const api = createMockClient(clock); await api.me(); const controller = new CreationController(api, draft, "subject", clock);
  const pending = controller.preview(); controller.dispose(); await pending;
  assert.equal(controller.snapshot().proposal, undefined);
  const one = new CreationController(api, draft, "subject", clock); const two = new CreationController(api, draft, "subject", clock);
  await Promise.all([one.preview(), two.preview()]);
  assert.notEqual(one.snapshot().proposal!.proposalId, two.snapshot().proposal!.proposalId);
  assert.equal(one.canConfirm(), false); assert.equal(two.canConfirm(), false);
});
test("CBD-218-AC01: created budget and plan use exact committed server identities through the merged route shapes", async () => {
  const { api, controller } = await reviewed(); const result = (await controller.confirm("subject"))!;
  const budgets = await api.listBudgets();
  assert.deepEqual(budgets.map(budget => [budget.id, budget.name, budget.currencyCode, budget.timeZone]), [[result.budgetSpaceId, "Our plan", "USD", "America/New_York"]]);
  const budget = await api.budget(result.budgetSpaceId);
  assert.equal(budget.activePeriod!.id, result.currentPeriodId);
  assert.equal(budget.activePeriod!.scheduleVersionId, result.currentScheduleVersionId);
  assert.equal(budget.completeness, "complete"); assert.equal(budget.freshness, "current");
  const category = await api.addCategory(budget.id, "Groceries");
  await api.saveTarget(budget.id, category.id, "450.00", 2);
  const plan = await api.plan(budget.id, result.currentPeriodId);
  assert.equal(plan.budgetSpaceId, result.budgetSpaceId); assert.equal(plan.periodId, result.currentPeriodId); assert.equal(plan.minorUnitPrecision, 2);
  assert.deepEqual(plan.categories, [{ id: category.id, name: "Groceries" }]);
  assert.deepEqual(plan.targets, [{ categoryId: category.id, baseAmount: "450.00", periodAmount: "450.00" }]);
  await assert.rejects(api.saveTarget(budget.id, category.id, "500.123", 2), (error: unknown) => error instanceof ApiError && error.status === 400 && error.fieldErrors[0]?.code === "amount.invalid");
  await assert.rejects(api.plan(budget.id, "other-period"), (error: unknown) => error instanceof ApiError && error.status === 404);
});
test("PROTO-ACTIVATION-001: wire mappings format minor units by precision, mark an incomplete detail partial and never compute a target", () => {
  assert.equal(formatMinorUnits(40000, 2), "400.00"); assert.equal(formatMinorUnits(5, 2), "0.05"); assert.equal(formatMinorUnits(1500, 0), "1500"); assert.equal(formatMinorUnits(12345, 3), "12.345");
  assert.equal(parseMajorUnits("450", 2), 45000); assert.equal(parseMajorUnits("0.5", 2), 50); assert.equal(parseMajorUnits("7", 0), 7);
  assert.throws(() => parseMajorUnits("1.5", 0), ApiError); assert.throws(() => parseMajorUnits("-1", 2), ApiError); assert.throws(() => parseMajorUnits("abc", 2), ApiError);
  const detail: WireSpaceDetail = { space: { budgetSpaceId: "b", name: "Home", nameVersion: 1, timeZone: "UTC", currencyCode: "USD", lifecycle: "live", lifecycleVersion: 1 }, scheduleVersion: { scheduleVersionId: "s", sequence: 1, cadenceDefinition: {} }, budgetDate: "2026-09-14", activePeriod: { periodId: "p", scheduleVersionId: "s", status: "active", ordinal: 0, relation: "current", start: "2026-09-01", end: "2026-09-30", lengthInDays: 30 }, nextPeriods: [] };
  assert.deepEqual(toBudgetDetail(detail), { id: "b", name: "Home", currencyCode: "USD", timeZone: "UTC", activePeriod: { id: "p", start: "2026-09-01", end: "2026-09-30", lengthInDays: 30, scheduleVersionId: "s" }, freshness: "current", completeness: "complete", updatedAt: "2026-09-14" });
  assert.equal(toBudgetDetail({ ...detail, activePeriod: null }).activePeriod, null);
  assert.equal(toBudgetDetail({ ...detail, scheduleVersion: undefined as never }).completeness, "partial");
  const plan: WirePlan = { budgetSpaceId: "b", period: { periodId: "p", start: "2026-09-01", end: "2026-09-30", status: "active", completed: false }, cadence: "monthly", currencyCode: "USD", minorUnitPrecision: 2, formulaVersion: "budget-domain/targets/1", categories: [
    { categoryId: "c1", label: "Rent", position: 0, baseTarget: { amountMinorUnits: 150000 }, periodTarget: { amountMinorUnits: 150000 } },
    { categoryId: "c2", label: "Fun", position: 1, baseTarget: null, periodTarget: { amountMinorUnits: 0 } },
  ] };
  assert.deepEqual(toPlan(plan), { budgetSpaceId: "b", periodId: "p", currencyCode: "USD", minorUnitPrecision: 2, categories: [{ id: "c1", name: "Rent" }, { id: "c2", name: "Fun" }], targets: [{ categoryId: "c1", baseAmount: "1500.00", periodAmount: "1500.00" }] });
});
test("PROTO-SIGNIN-01: logout denies subsequent protected mock reads", async () => {
  const { api } = await reviewed(); assert.ok(await api.me()); await api.logout(); assert.equal(await api.me(), null);
  await assert.rejects(api.listBudgets(), (error: unknown) => error instanceof ApiError && error.status === 403);
});
test("Mock confirmation consumes once under a same-proposal race", async () => {
  const { api, proposal } = await reviewed();
  const claim = { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version };
  const outcomes = await Promise.allSettled([api.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "first-confirmation", claim), api.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "second-confirmation", claim)]);
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
  const api = createMockClient(); await api.me(); const controller = new CreationController(api, draft, "subject");
  await controller.preview(); controller.rendered(controller.snapshot().proposal!.proposalId, "subject"); controller.acknowledge(true);
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
  const api = createMockClient(clock); await api.me();
  const proposal = await api.createProposal({ ...draft, schedule }, crypto.randomUUID());
  assert.equal(proposal.preview.periods.length, 4);
  assert.deepEqual(proposal.normalizedInputs.schedule, schedule);
  assert.ok(proposal.preview.periods.every(period => period.lengthInDays > 0));
});

test("REV-NS-3: the server mock refuses a budget name carrying U+202E with name.control-characters, as the live API does, and still accepts an emoji-ZWJ name", async () => {
  const api = createMockClient(clock); await api.me();
  await assert.rejects(api.createProposal({ ...draft, name: "Groceries ‮seirecorg" }, crypto.randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "validation_failed");
    assert.deepEqual(error.fieldErrors, [{ path: "name", code: "name.control-characters", message: "Remove control and invisible formatting characters." }]);
    return true;
  });
  const family = await api.createProposal({ ...draft, name: "Family \u{1F468}‍\u{1F469}‍\u{1F467}" }, crypto.randomUUID());
  assert.equal(family.normalizedInputs.name, "Family \u{1F468}‍\u{1F469}‍\u{1F467}");
});


// --- PROTO-INCREMENT-B-001: manual accounts, manual expenses and budget progress ---------------

/** A signed-in mock session with one confirmed budget, its active period, and two categories with targets. */
async function budgeted() {
  const api = createMockClient(clock);
  assert.ok(await api.me());
  // The creation ceremony itself is covered above; here it is only the fixture, so the
  // proposal and confirmation are issued directly rather than through the controller.
  const proposal = await api.createProposal(structuredClone(draft), crypto.randomUUID());
  const confirmation = await api.confirmProposal(proposal.proposalId, proposal.confirmationBinding, crypto.randomUUID(),
    { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version });
  const budgetSpaceId = confirmation.budgetSpaceId;
  const detail = await api.budget(budgetSpaceId);
  const periodId = detail.activePeriod!.id;
  const groceries = await api.addCategory(budgetSpaceId, "Groceries");
  const transport = await api.addCategory(budgetSpaceId, "Transport");
  await api.saveTarget(budgetSpaceId, groceries.id, "500", 2);
  await api.saveTarget(budgetSpaceId, transport.id, "200", 2);
  const budgetDate = detail.activePeriod!.start;
  return { api, budgetSpaceId, periodId, groceries, transport, budgetDate };
}

test("CBD-196: an account is created, renamed, archived and restored through the production client", async () => {
  const { api, budgetSpaceId } = await budgeted();
  assert.deepEqual(await api.listAccounts(budgetSpaceId), []);
  const created = await api.addAccount(budgetSpaceId, { label: "Everyday", accountType: "checking", currencyCode: "USD", openingBalance: "1250.00" });
  assert.equal(created.label, "Everyday");
  assert.equal(created.openingBalance, "1250.00", "the API's minor units are formatted, never computed in the browser");
  assert.equal(created.archived, false);
  assert.equal(created.version, 1);

  const renamed = await api.editAccount(budgetSpaceId, created.id, { label: "Everyday checking" });
  assert.equal(renamed.label, "Everyday checking");
  assert.equal(renamed.version, 2);

  const archived = await api.archiveAccount(budgetSpaceId, created.id);
  assert.equal(archived.archived, true);
  assert.equal((await api.listAccounts(budgetSpaceId)).length, 1, "archival is lifecycle, not disappearance");
  assert.equal((await api.restoreAccount(budgetSpaceId, created.id)).archived, false);
});

test("CBD-196/CBD-200 (SEC-P3-F1): every inadmissible account transition is refused with a canonical field error", async () => {
  const { api, budgetSpaceId } = await budgeted();
  const account = await api.addAccount(budgetSpaceId, { label: "Everyday", accountType: "checking", currencyCode: "USD", openingBalance: "0" });
  const refusal = async (work: Promise<unknown>, code: string, path: string) => {
    await assert.rejects(work, (error: unknown) => {
      assert.ok(error instanceof ApiError, String(error));
      assert.equal(error.code, code);
      assert.equal(error.fieldErrors[0]?.path, path, `${code} should land on ${path}`);
      assert.ok(error.fieldErrors[0]!.message.length > 0, "a person never sees the bare code");
      return true;
    });
  };
  await refusal(api.restoreAccount(budgetSpaceId, account.id), "account_not_archived", "accountId");
  await refusal(api.addAccount(budgetSpaceId, { label: "  ", accountType: "checking", currencyCode: "USD", openingBalance: "0" }), "label_invalid", "label");
  await refusal(api.addAccount(budgetSpaceId, { label: "everyday", accountType: "checking", currencyCode: "USD", openingBalance: "0" }), "label_taken", "label");
  await refusal(api.addAccount(budgetSpaceId, { label: "Brokerage", accountType: "brokerage", currencyCode: "USD", openingBalance: "0" }), "account_type_unsupported", "accountType");
  await api.archiveAccount(budgetSpaceId, account.id);
  await refusal(api.archiveAccount(budgetSpaceId, account.id), "account_archived", "accountId");
  await refusal(api.editAccount(budgetSpaceId, account.id, { label: "renamed" }), "account_archived", "accountId");
});

test("CBD-200/CBD-201/CBD-209/CBD-211: an expense split across two categories moves spent and remaining, and the detail itemizes it", async () => {
  const { api, budgetSpaceId, periodId, groceries, transport, budgetDate } = await budgeted();
  const account = await api.addAccount(budgetSpaceId, { label: "Everyday", accountType: "checking", currencyCode: "USD", openingBalance: "0" });

  const before = await api.progress(budgetSpaceId, periodId);
  assert.deepEqual(before.cells.map(cell => [cell.label, cell.spent, cell.remaining, cell.over]), [["Groceries", "0.00", "500.00", false], ["Transport", "0.00", "200.00", false]]);

  const recorded = await api.recordExpense(budgetSpaceId, {
    accountId: account.id, amount: "12.50", budgetDate, description: "Corner shop",
    allocations: [{ categoryId: groceries.id, amount: "8.00" }, { categoryId: transport.id, amount: "4.50" }],
  }, 2);
  assert.equal(recorded.revision, 1);

  const after = await api.progress(budgetSpaceId, periodId);
  const cell = (label: string) => after.cells.find(entry => entry.label === label)!;
  assert.equal(cell("Groceries").spent, "8.00", "spent is the magnitude of the API's signed figure");
  assert.equal(cell("Groceries").remaining, "492.00");
  assert.equal(cell("Transport").spent, "4.50");
  assert.equal(cell("Transport").remaining, "195.50");

  const detail = await api.categoryDetail(budgetSpaceId, periodId, groceries.id);
  assert.equal(detail.label, "Groceries");
  assert.equal(detail.cell!.spent, "8.00", "CBD-209: the aggregate and the detail report the same figure");
  assert.deepEqual(detail.items.map(item => [item.description, item.amount, item.budgetDate]), [["Corner shop", "8.00", budgetDate]]);

  // Editing the expense to a single category moves both cells, and removing it returns them.
  await api.editExpense(budgetSpaceId, detail.items[0]!.transactionId, {
    accountId: account.id, amount: "20.00", budgetDate, description: "Corner shop, corrected",
    allocations: [{ categoryId: groceries.id, amount: "20.00" }],
  }, 2);
  const edited = await api.progress(budgetSpaceId, periodId);
  assert.equal(edited.cells.find(entry => entry.label === "Groceries")!.spent, "20.00");
  assert.equal(edited.cells.find(entry => entry.label === "Transport")!.spent, "0.00");

  await api.removeExpense(budgetSpaceId, detail.items[0]!.transactionId);
  const removed = await api.progress(budgetSpaceId, periodId);
  assert.deepEqual(removed.cells.map(cell => [cell.spent, cell.remaining, cell.over]), [["0.00", "500.00", false], ["0.00", "200.00", false]]);
  assert.deepEqual((await api.categoryDetail(budgetSpaceId, periodId, groceries.id)).items, [], "an excluded item is in neither aggregate nor detail");
});

test("CBD-209: an overspent category reports a remaining of zero-or-more labelled over, never a clamped figure", async () => {
  const { api, budgetSpaceId, periodId, groceries, budgetDate } = await budgeted();
  const account = await api.addAccount(budgetSpaceId, { label: "Everyday", accountType: "checking", currencyCode: "USD", openingBalance: "0" });
  await api.recordExpense(budgetSpaceId, { accountId: account.id, amount: "620.00", budgetDate, description: "Big shop", allocations: [{ categoryId: groceries.id, amount: "620.00" }] }, 2);
  const cell = (await api.progress(budgetSpaceId, periodId)).cells.find(entry => entry.label === "Groceries")!;
  assert.equal(cell.spent, "620.00");
  assert.equal(cell.over, true);
  assert.equal(cell.remaining, "120.00", "the magnitude of the negative remaining; the view labels it as over");
});

test("CBD-201: the exact-sum rule and every other write refusal is the server's, reported on the field it names", async () => {
  const { api, budgetSpaceId, groceries, transport, budgetDate } = await budgeted();
  const account = await api.addAccount(budgetSpaceId, { label: "Everyday", accountType: "checking", currencyCode: "USD", openingBalance: "0" });
  const archived = await api.addAccount(budgetSpaceId, { label: "Retired", accountType: "cash", currencyCode: "USD", openingBalance: "0" });
  await api.archiveAccount(budgetSpaceId, archived.id);
  const base = { accountId: account.id, amount: "12.50", budgetDate, description: "Corner shop", allocations: [{ categoryId: groceries.id, amount: "8.00" }, { categoryId: transport.id, amount: "4.50" }] };
  const refusal = async (override: Record<string, unknown>, code: string, path: string) => {
    await assert.rejects(api.recordExpense(budgetSpaceId, { ...base, ...override } as typeof base, 2), (error: unknown) => {
      assert.ok(error instanceof ApiError, String(error));
      assert.equal(error.code, code);
      assert.equal(error.fieldErrors[0]?.path, path, `${code} should land on ${path}`);
      return true;
    });
  };
  await refusal({ allocations: [{ categoryId: groceries.id, amount: "8.00" }] }, "allocation_sum_mismatch", "allocations");
  await refusal({ allocations: [] }, "allocations_empty", "allocations");
  await refusal({ allocations: [{ categoryId: groceries.id, amount: "6.00" }, { categoryId: groceries.id, amount: "6.50" }] }, "allocation_duplicate_category", "allocations");
  await refusal({ budgetDate: "2026-02-30" }, "date_invalid", "budgetDate");
  await refusal({ accountId: archived.id }, "account_archived", "accountId");
});
