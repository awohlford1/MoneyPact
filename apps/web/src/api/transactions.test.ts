/**
 * CBD-202 (AC01-AC05; UI-BUILD-PLAN.md section 4.3) unit tests: the one stubbed read's shape against
 * `createMockClient`'s own store (never a value or rule this module invents), the stale-version path, the
 * idempotent replay, and the in-flight 429 -- all against the mock server directly, driven with a fixed clock,
 * following `reports.test.ts`'s precedent for testing a new client module over the real mock rather than a
 * recording fetcher.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./client.ts";
import { createMockClient, handleMockRequest } from "./mock-server.ts";
import type { MockWire } from "./mock-server.ts";
import { createTransactionsClient, toTransactionRow } from "./transactions.ts";
import type { WireTransaction } from "./transactions.ts";
import { formatMinorUnits } from "./client.ts";

function csrfFetcher(mock: MockWire, origin = "http://localhost"): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input), origin);
    const headers = new Headers(init?.headers);
    headers.set("origin", origin); headers.set("sec-fetch-site", "same-origin");
    const request = new Request(target, { method: init?.method ?? "GET", headers, ...(init?.body === undefined ? {} : { body: init.body }) });
    return handleMockRequest(mock, request, target.pathname.replace(/^\/v1\//, "").split("/"));
  }) as typeof fetch;
}

async function setUpBudget(clock: () => number) {
  const client = createMockClient(clock);
  await client.me(); // bootstraps the CSRF value the mutations below need, as client-idempotency.test.ts does.
  const proposal = await client.createProposal(
    { name: "Household", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } },
    "proposal-key-0000000001",
  );
  const confirmed = await client.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "confirm-key-0000000001", { kind: "primary_owner_self", version: 1 });
  const budgetSpaceId = confirmed.budgetSpaceId;
  const category = await client.addCategory(budgetSpaceId, "Groceries");
  await client.saveTarget(budgetSpaceId, category.id, "100.00", 2);
  const account = await client.addAccount(budgetSpaceId, { label: "Checking", accountType: "checking", currencyCode: "USD", openingBalance: "0.00" });
  const budget = await client.budget(budgetSpaceId);
  const periodId = budget.activePeriod!.id;
  return { client, mock: client.mock, budgetSpaceId, periodId, categoryId: category.id, accountId: account.id, budgetDate: budget.updatedAt };
}

test("CBD-202: the transactions list reads exactly the fields of the mock's own current version, for the requested period, current-version-only and cross-checked against the write's own result", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { client, mock, budgetSpaceId, periodId, categoryId, accountId, budgetDate } = await setUpBudget(clock);
  const expense = await client.recordExpense(budgetSpaceId, { accountId, amount: "42.50", budgetDate, description: "Groceries run", allocations: [{ categoryId, amount: "42.50" }] }, 2, "expense-key-0000000001");

  const transactions = createTransactionsClient("/v1", csrfFetcher(mock));
  const list = await transactions.list(budgetSpaceId, periodId);
  assert.equal(list.budgetSpaceId, budgetSpaceId);
  assert.equal(list.periodId, periodId);
  assert.equal(list.currencyCode, "USD");
  assert.equal(list.minorUnitPrecision, 2);
  assert.equal(list.transactions.length, 1, "REV-UIP03-fixture-guard: the recorded expense must actually land in this period's list");
  const row = list.transactions[0]!;
  assert.equal(row.transactionId, expense.transactionId);
  assert.equal(row.revision, expense.revision);
  assert.equal(row.accountId, accountId);
  assert.equal(row.budgetDate, budgetDate);
  assert.equal(row.description, "Groceries run");
  assert.equal(row.amount, formatMinorUnits(4250, 2));
  assert.equal(row.direction, "spend");
  assert.deepEqual(row.allocations, [{ categoryId, amount: formatMinorUnits(4250, 2), direction: "spend" }]);
  assert.equal(row.removed, false);

  // An edit supersedes the version this row read; the list must show only the new current one, never both.
  const edited = await client.editExpense(budgetSpaceId, expense.transactionId, { accountId, amount: "50.00", budgetDate, description: "Groceries run", allocations: [{ categoryId, amount: "50.00" }] }, 2, row.transactionVersionId, "expense-key-0000000002");
  const afterEdit = await transactions.list(budgetSpaceId, periodId);
  assert.equal(afterEdit.transactions.length, 1, "the superseded version must not also appear");
  assert.equal(afterEdit.transactions[0]!.revision, edited.revision);
  assert.equal(afterEdit.transactions[0]!.amount, formatMinorUnits(5000, 2));

  // A removal is a new current version with removedAt set -- the wire field this packet added it for.
  await client.removeExpense(budgetSpaceId, expense.transactionId, afterEdit.transactions[0]!.transactionVersionId);
  const afterRemove = await transactions.list(budgetSpaceId, periodId);
  assert.equal(afterRemove.transactions.length, 1);
  assert.equal(afterRemove.transactions[0]!.removed, true, "the current version of a removed transaction still reads, marked removed");
});

test("CBD-202: toTransactionRow formats every figure from the wire's own field, byte for byte, and applies no client-side sum", () => {
  const wire: WireTransaction = {
    transactionId: "t1", transactionVersionId: "v1", revision: 1, accountId: "acc", amountMinorUnits: -12345,
    budgetDate: "2026-09-15", description: "Milk", allocations: [{ categoryId: "c1", amountMinorUnits: -12345 }], removedAt: null,
  };
  const row = toTransactionRow(wire, 2);
  assert.equal(row.amount, formatMinorUnits(12345, 2));
  assert.equal(row.direction, "spend");
  assert.equal(row.allocations[0]!.amount, formatMinorUnits(12345, 2));
});

test("CBD-202: an unrecognised period id is 404, and a subject with no membership is 403", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock);
  const transactions = createTransactionsClient("/v1", csrfFetcher(mock));
  await assert.rejects(() => transactions.list(budgetSpaceId, "not-a-real-period"), (error: unknown) => error instanceof ApiError && error.status === 404 && error.code === "period_not_found");

  const outsider = createMockClient(clock);
  const outsiderTransactions = createTransactionsClient("/v1", csrfFetcher(outsider.mock));
  await assert.rejects(() => outsiderTransactions.list(budgetSpaceId, "any"), (error: unknown) => error instanceof ApiError && error.status === 403);
});

test("CBD-200-F03/CBD-202-AC02: a stale precondition on the reused write endpoints is refused 409 stale_version with the current version, and never silently overwritten", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { client, budgetSpaceId, categoryId, accountId, budgetDate } = await setUpBudget(clock);
  const expense = await client.recordExpense(budgetSpaceId, { accountId, amount: "10.00", budgetDate, description: "First", allocations: [{ categoryId, amount: "10.00" }] }, 2, "k1");
  // A concurrent edit moves the version forward.
  await client.editExpense(budgetSpaceId, expense.transactionId, { accountId, amount: "11.00", budgetDate, description: "First", allocations: [{ categoryId, amount: "11.00" }] }, 2, undefined, "k2");
  // This caller's view still states the original (now stale) version as its basis.
  await assert.rejects(
    client.editExpense(budgetSpaceId, expense.transactionId, { accountId, amount: "12.00", budgetDate, description: "First", allocations: [{ categoryId, amount: "12.00" }] }, 2, "not-the-current-version", "k3"),
    (error: unknown) => { assert.ok(error instanceof ApiError); assert.equal(error.status, 409); assert.equal(error.code, "stale_version"); return true; },
  );
});

test("CBD-266-F04/CBD-202: a second concurrent write while one is still saving is refused 429 in_flight", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId, categoryId, accountId, budgetDate } = await setUpBudget(clock);
  const fetcher = csrfFetcher(mock);
  const csrf = mock.csrf()!;
  const post = (body: unknown, idempotency: string) => fetcher(`http://localhost/v1/budget-spaces/${budgetSpaceId}/transactions`, {
    method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": csrf, "Idempotency-Key": idempotency }, body: JSON.stringify(body),
  });
  const draft = { accountId, amountMinorUnits: -1000, budgetDate, description: "Race", allocations: [{ categoryId, amountMinorUnits: -1000 }] };
  const [first, second] = await Promise.all([post(draft, "race-1"), post(draft, "race-2")]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 429], "exactly one of the two genuinely concurrent writes is refused in_flight");
});

test("CBD-200-F03/CBD-266-F04: a repeated Idempotency-Key on the reused create endpoint replays one success, never a second transaction", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { client, mock, budgetSpaceId, periodId, categoryId, accountId, budgetDate } = await setUpBudget(clock);
  const draft = { accountId, amount: "5.00", budgetDate, description: "Replay", allocations: [{ categoryId, amount: "5.00" }] };
  const first = await client.recordExpense(budgetSpaceId, draft, 2, "idempotent-key-0000000001");
  const replay = await client.recordExpense(budgetSpaceId, draft, 2, "idempotent-key-0000000001");
  assert.equal(replay.transactionId, first.transactionId);
  assert.equal(replay.revision, first.revision);
  const transactions = createTransactionsClient("/v1", csrfFetcher(mock));
  const list = await transactions.list(budgetSpaceId, periodId);
  assert.equal(list.transactions.filter(row => row.description === "Replay").length, 1, "a replayed key must never create a second transaction");
});

test("REV-UIP03-6/CBD-200-F03: a repeated Idempotency-Key with a DIFFERENT request body is refused 409 idempotency_mismatch, never a silent replay of the mismatched request", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { client, mock, budgetSpaceId, periodId, categoryId, accountId, budgetDate } = await setUpBudget(clock);
  const first = { accountId, amount: "5.00", budgetDate, description: "First attempt", allocations: [{ categoryId, amount: "5.00" }] };
  const differentBody = { accountId, amount: "6.00", budgetDate, description: "Different attempt", allocations: [{ categoryId, amount: "6.00" }] };
  await client.recordExpense(budgetSpaceId, first, 2, "idempotent-mismatch-0000000001");
  await assert.rejects(
    client.recordExpense(budgetSpaceId, differentBody, 2, "idempotent-mismatch-0000000001"),
    (error: unknown) => { assert.ok(error instanceof ApiError); assert.equal(error.status, 409); assert.equal(error.code, "idempotency_mismatch"); return true; },
  );
  const transactions = createTransactionsClient("/v1", csrfFetcher(mock));
  const list = await transactions.list(budgetSpaceId, periodId);
  assert.equal(list.transactions.filter(row => row.description === "First attempt").length, 1);
  assert.equal(list.transactions.filter(row => row.description === "Different attempt").length, 0, "the mismatched request must never be written, silently or otherwise");
});
