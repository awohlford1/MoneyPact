/**
 * CBD-199 and CBD-200's application half at the application layer. The
 * allocation rules are `allocations.test.ts`; the live-Postgres half is
 * `../persistence/increment-a.live.test.ts`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TransactionError,
  assignPeriod,
  createManualTransaction,
  editManualTransaction,
  isCalendarDate,
  parseTransactionWriteRequest,
  readBudgetProgress,
  readTransactionHistory,
  removeManualTransaction,
} from "./index.ts";
import type { TransactionErrorCode, TransactionWriteRequest } from "./index.ts";
import {
  TX_ACCOUNT_A,
  TX_ACCOUNT_ARCHIVED,
  TX_ACCOUNT_B,
  TX_CATEGORY_GROCERIES,
  TX_CATEGORY_TRANSPORT,
  TX_FIXED_NOW,
  TX_PERIOD_AUG,
  TX_PERIOD_SEP,
  TX_SPACE_A,
  TX_SPACE_B,
  TX_SUBJECT_1,
  transactionWorld,
  writeBody,
} from "./support.ts";

function request(overrides: Record<string, unknown> = {}): TransactionWriteRequest {
  return parseTransactionWriteRequest(writeBody(overrides));
}

async function refuses(code: TransactionErrorCode, work: () => unknown): Promise<void> {
  await assert.rejects(async () => { await work(); }, (error: unknown) => error instanceof TransactionError && error.code === code, code);
}

function refusesSync(code: TransactionErrorCode, work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof TransactionError && error.code === code, code);
}

describe("CBD-199-AC01: a valid request persists one settled manual transaction", () => {
  it("carries manual origin, the account's denomination, the selected date and a stable identity", async () => {
    const world = transactionWorld();
    const { previous, current } = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    assert.equal(previous, null);
    assert.equal(world.repository.versions.size, 1);
    assert.equal(current.version.origin, "manual");
    assert.equal(current.version.settlementState, "settled");
    assert.equal(current.version.accountId, TX_ACCOUNT_A);
    assert.equal(current.version.amountMinorUnits, -1_250);
    assert.equal(Number.isSafeInteger(current.version.amountMinorUnits), true);
    assert.equal(current.version.currencyCode, "USD");
    assert.equal(current.version.minorUnitPrecision, 2);
    assert.equal(current.version.budgetDate, "2026-09-15");
    assert.equal(current.version.revision, 1);
    assert.equal(current.version.supersededAt, null);
    assert.equal(current.version.removedAt, null);
    assert.match(current.version.transactionId, /^[0-9a-f-]{36}$/u);
    assert.equal(current.allocations.length, 1);
  });

  it("a positive amount is income and stores just as well as a negative one", async () => {
    const world = transactionWorld();
    const { current } = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({
      amountMinorUnits: 250_000,
      allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: 250_000 }],
    }));
    assert.equal(current.version.amountMinorUnits, 250_000);
  });

  it("a zero-amount transaction is representable when its allocations also sum to zero", async () => {
    const world = transactionWorld();
    const { current } = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({
      amountMinorUnits: 0,
      allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -500 }, { categoryId: TX_CATEGORY_TRANSPORT, amountMinorUnits: 500 }],
    }));
    assert.equal(current.version.amountMinorUnits, 0);
    assert.equal(current.allocations.length, 2);
  });
});

describe("CBD-199-AC02: no manual state can create a pending or institution-derived fact", () => {
  it("origin and settlement state are set by the command, not by the request", async () => {
    const world = transactionWorld();
    const parsed = parseTransactionWriteRequest(writeBody({ origin: "imported", settlementState: "pending", source: "system" }));
    assert.equal(Object.hasOwn(parsed, "origin"), false);
    assert.equal(Object.hasOwn(parsed, "settlementState"), false);
    const { current } = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, parsed);
    assert.equal(current.version.origin, "manual");
    assert.equal(current.version.settlementState, "settled");
    assert.equal(current.version.source, "user");
  });

  it("every version an edit or a removal produces is still manual and settled", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    await editManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1, request({ amountMinorUnits: -2_000, allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -2_000 }] }));
    await removeManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1);
    for (const version of world.repository.versions.values()) {
      assert.equal(version.origin, "manual");
      assert.equal(version.settlementState, "settled");
    }
  });
});

describe("CBD-199-AC03: invalid inputs fail atomically with stable errors", () => {
  const cases: readonly (readonly [string, TransactionErrorCode, Record<string, unknown>])[] = [
    ["missing account", "invalid_request", { accountId: undefined }],
    ["malformed account", "invalid_request", { accountId: "nope" }],
    ["missing amount", "amount_not_integer", { amountMinorUnits: undefined }],
    ["fractional minor units", "amount_not_integer", { amountMinorUnits: -12.5 }],
    ["string amount", "amount_not_integer", { amountMinorUnits: "-1250" }],
    ["overflow amount", "amount_overflow", { amountMinorUnits: -1e300 }],
    ["missing date", "date_invalid", { budgetDate: undefined }],
    ["malformed date", "date_invalid", { budgetDate: "15/09/2026" }],
    ["impossible date", "date_invalid", { budgetDate: "2026-02-30" }],
    ["over-long description", "description_invalid", { description: "x".repeat(201) }],
    ["non-string description", "description_invalid", { description: 5 }],
    ["empty allocations", "allocations_empty", { allocations: [] }],
    ["missing allocations", "allocations_empty", { allocations: undefined }],
    ["malformed allocation category", "allocation_category_invalid", { allocations: [{ categoryId: "x", amountMinorUnits: -1_250 }] }],
    ["duplicate allocation category", "allocation_duplicate_category", { allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -600 }, { categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -650 }] }],
    ["fractional allocation", "amount_not_integer", { allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -12.5 }] }],
  ];

  for (const [name, code, overrides] of cases) {
    it(`${name} fails as ${code} and writes nothing`, async () => {
      const world = transactionWorld();
      refusesSync(code, () => parseTransactionWriteRequest(writeBody(overrides)));
      assert.equal(world.repository.versions.size, 0);
      assert.equal(world.repository.allocations.size, 0);
    });
  }

  it("an inaccessible account is refused: unknown, archived, or another budget's", async () => {
    const world = transactionWorld();
    await refuses("account_not_found", () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ accountId: TX_ACCOUNT_B })));
    await refuses("account_archived", () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ accountId: TX_ACCOUNT_ARCHIVED })));
    await refuses("account_not_found", () => createManualTransaction(world.deps, TX_SPACE_B, TX_SUBJECT_1, request({ accountId: TX_ACCOUNT_A })));
    assert.equal(world.repository.versions.size, 0);
  });

  it("a date outside every stored period is refused rather than assigned to the nearest one", async () => {
    const world = transactionWorld();
    await refuses("period_not_found", () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ budgetDate: "2026-10-01" })));
    await refuses("period_not_found", () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ budgetDate: "2026-07-31" })));
    assert.equal(world.repository.versions.size, 0);
  });

  it("a category outside the budget, or archived, is refused and nothing is written", async () => {
    const world = transactionWorld();
    await refuses("allocation_category_invalid", () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({
      allocations: [{ categoryId: "88888888-8888-4888-8888-888888888883", amountMinorUnits: -1_250 }],
    })));
    assert.equal(world.repository.allocations.size, 0);
  });
});

describe("CBD-199-AC04: period assignment against the supplied periods", () => {
  const periods = [
    { periodId: TX_PERIOD_AUG, budgetSpaceId: TX_SPACE_A, status: "planned", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
    { periodId: TX_PERIOD_SEP, budgetSpaceId: TX_SPACE_A, status: "active", periodStart: "2026-09-01", periodEnd: "2026-09-30" },
  ];

  it("a transaction on a period start belongs to that period", () => {
    assert.equal(assignPeriod(periods, "2026-09-01").periodId, TX_PERIOD_SEP);
  });

  it("the preceding calendar date belongs to the preceding period", () => {
    assert.equal(assignPeriod(periods, "2026-08-31").periodId, TX_PERIOD_AUG);
  });

  it("neither boundary moves", () => {
    for (const date of ["2026-09-01", "2026-08-31"]) {
      const period = assignPeriod(periods, date);
      const original = periods.find((candidate) => candidate.periodId === period.periodId);
      assert.deepEqual(period, original);
    }
    assert.deepEqual(periods[1], { periodId: TX_PERIOD_SEP, budgetSpaceId: TX_SPACE_A, status: "active", periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  });

  it("the period end is inclusive too", () => {
    assert.equal(assignPeriod(periods, "2026-09-30").periodId, TX_PERIOD_SEP);
    assert.equal(assignPeriod(periods, "2026-08-01").periodId, TX_PERIOD_AUG);
  });

  it("stores the resolved period and its bounds on the transaction", async () => {
    const world = transactionWorld();
    const onStart = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ budgetDate: "2026-09-01" }));
    assert.equal(onStart.current.version.periodId, TX_PERIOD_SEP);
    assert.equal(onStart.current.version.periodStart, "2026-09-01");
    assert.equal(onStart.current.version.periodEnd, "2026-09-30");
    const dayBefore = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ budgetDate: "2026-08-31" }));
    assert.equal(dayBefore.current.version.periodId, TX_PERIOD_AUG);
  });

  it("refuses rather than choosing when two supplied periods contain the date", () => {
    const overlapping = [...periods, { periodId: "overlap", budgetSpaceId: TX_SPACE_A, status: "planned", periodStart: "2026-09-01", periodEnd: "2026-09-07" }];
    refusesSync("period_ambiguous", () => assignPeriod(overlapping, "2026-09-03"));
  });

  it("refuses a date that is not a calendar date at all", () => {
    refusesSync("date_invalid", () => assignPeriod(periods, "2026-13-01"));
    assert.equal(isCalendarDate("2024-02-29"), true, "a leap day is a real date");
    assert.equal(isCalendarDate("2026-02-29"), false);
  });
});

describe("CBD-200 at the application layer: edit and remove", () => {
  it("an edit supersedes exactly one version and retains the prior one with its allocations", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    world.now = "2026-09-16T10:00:00.000Z";
    const edited = await editManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1, request({
      amountMinorUnits: -1_800,
      allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -1_800 }],
    }));
    assert.equal(edited.previous?.version.transactionVersionId, created.current.version.transactionVersionId);
    assert.equal(edited.current.version.revision, 2);
    assert.equal(edited.current.version.transactionId, created.current.version.transactionId);
    assert.equal(world.repository.versions.size, 2);
    assert.equal(world.repository.allocations.size, 2, "the prior allocation is retained, not replaced in place");
    const current = [...world.repository.versions.values()].filter((version) => version.supersededAt === null);
    assert.equal(current.length, 1);
    assert.equal(current[0]?.amountMinorUnits, -1_800);
    const superseded = [...world.repository.versions.values()].find((version) => version.supersededAt !== null);
    assert.equal(superseded?.supersededAt, "2026-09-16T10:00:00.000Z");
    assert.equal(superseded?.amountMinorUnits, -1_250, "the prior version is unchanged apart from the stamp");
  });

  it("a removal writes a tombstone with no allocations and retains everything before it", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    const removed = await removeManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1);
    assert.equal(removed.current.allocations.length, 0);
    assert.equal(removed.current.version.removedAt, world.now);
    assert.equal(removed.current.version.removedBySubjectId, TX_SUBJECT_1);
    assert.equal(world.repository.allocations.size, 1, "the removed version's prior allocation is retained history");
    await refuses("transaction_removed", () => removeManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1));
    await refuses("transaction_removed", () => editManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1, request()));
  });

  it("a supersession or removal stamped earlier than the version's created_at is a constraint violation (manual_transaction_check1, check2)", async () => {
    // The live regression of 2026-09-15: a row whose created_at came from the
    // database clock, superseded by a command whose clock stood earlier. The
    // stamp is refused, and so is a tombstone dated before its own creation;
    // the same command with a clock at or after created_at succeeds.
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    const id = created.current.version.transactionId;
    world.now = "2026-09-15T11:59:59.000Z";
    await refuses("constraint_violation", () => removeManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1));
    await refuses("constraint_violation", () => editManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1, request()));
    const current = await readTransactionHistory(world.deps, TX_SPACE_A, id);
    assert.deepEqual(current.map((snapshot) => snapshot.version.revision), [1], "a refused stamp leaves the identity untouched");
    assert.equal(current[0]?.version.supersededAt, null);
    world.now = TX_FIXED_NOW;
    const removed = await removeManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1);
    assert.equal(removed.current.version.removedAt, TX_FIXED_NOW);
  });

  it("the history is the ordered before/after trail", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    const id = created.current.version.transactionId;
    await editManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1, request({ amountMinorUnits: -2_000, allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -2_000 }] }));
    await removeManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1);
    const history = await readTransactionHistory(world.deps, TX_SPACE_A, id);
    assert.deepEqual(history.map((snapshot) => snapshot.version.revision), [1, 2, 3]);
    assert.deepEqual(history.map((snapshot) => snapshot.allocations.length), [1, 1, 0]);
    assert.deepEqual(history.map((snapshot) => snapshot.version.amountMinorUnits), [-1_250, -2_000, -2_000]);
    assert.equal(history.at(-1)?.version.removedAt, world.now);
  });

  it("an unknown transaction, or one of another budget, is not found", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    await refuses("transaction_not_found", () => readTransactionHistory(world.deps, TX_SPACE_B, created.current.version.transactionId));
    await refuses("transaction_not_found", () => removeManualTransaction(world.deps, TX_SPACE_B, created.current.version.transactionId, TX_SUBJECT_1));
    await refuses("invalid_request", () => readTransactionHistory(world.deps, TX_SPACE_A, "nope"));
  });
});

describe("CBD-209 through the application: one expense changes spent and remaining", () => {
  const targets = [
    { categoryId: TX_CATEGORY_GROCERIES, targetMinorUnits: 50_000 },
    { categoryId: TX_CATEGORY_TRANSPORT, targetMinorUnits: 20_000 },
  ];

  it("reports zero spent and the full target before anything is recorded", async () => {
    const world = transactionWorld();
    const progress = await readBudgetProgress(world.deps, TX_SPACE_A, { periodId: TX_PERIOD_SEP, targets });
    assert.deepEqual(progress.cells.map((cell) => cell.settledActualMinorUnits), [0, 0]);
    assert.deepEqual(progress.cells.map((cell) => cell.remainingAfterSettledMinorUnits).sort((a, b) => a - b), [20_000, 50_000]);
  });

  it("one manual expense moves settled actual and remaining, and nothing else", async () => {
    const world = transactionWorld();
    await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    const progress = await readBudgetProgress(world.deps, TX_SPACE_A, { periodId: TX_PERIOD_SEP, targets });
    const groceries = progress.cells.find((cell) => cell.categoryId === TX_CATEGORY_GROCERIES);
    const transport = progress.cells.find((cell) => cell.categoryId === TX_CATEGORY_TRANSPORT);
    assert.equal(groceries?.settledActualMinorUnits, -1_250);
    assert.equal(groceries?.remainingAfterSettledMinorUnits, 48_750);
    assert.equal(groceries?.pendingProvisionalImpactMinorUnits, 0);
    assert.equal(groceries?.remainingAfterPendingMinorUnits, 48_750);
    assert.equal(transport?.settledActualMinorUnits, 0);
    assert.equal(groceries?.settledRecordIds.length, 1);
  });

  it("an edit replaces the prior effect exactly once", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    await editManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1, request({
      amountMinorUnits: -4_000,
      allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -4_000 }],
    }));
    const progress = await readBudgetProgress(world.deps, TX_SPACE_A, { periodId: TX_PERIOD_SEP, targets });
    const groceries = progress.cells.find((cell) => cell.categoryId === TX_CATEGORY_GROCERIES);
    assert.equal(groceries?.settledActualMinorUnits, -4_000, "the superseded version contributes nothing");
    assert.equal(groceries?.settledRecordIds.length, 1);
  });

  it("a removed transaction contributes to neither aggregate nor detail", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request());
    await removeManualTransaction(world.deps, TX_SPACE_A, created.current.version.transactionId, TX_SUBJECT_1);
    const progress = await readBudgetProgress(world.deps, TX_SPACE_A, { periodId: TX_PERIOD_SEP, targets });
    const groceries = progress.cells.find((cell) => cell.categoryId === TX_CATEGORY_GROCERIES);
    assert.equal(groceries?.settledActualMinorUnits, 0);
    assert.deepEqual(groceries?.settledRecordIds, []);
    assert.deepEqual(progress.excludedRecordIds, []);
  });

  it("a transaction in another period does not reach this period's progress", async () => {
    const world = transactionWorld();
    await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request({ budgetDate: "2026-08-31" }));
    const september = await readBudgetProgress(world.deps, TX_SPACE_A, { periodId: TX_PERIOD_SEP, targets });
    const august = await readBudgetProgress(world.deps, TX_SPACE_A, { periodId: TX_PERIOD_AUG, targets });
    assert.equal(september.cells.find((cell) => cell.categoryId === TX_CATEGORY_GROCERIES)?.settledActualMinorUnits, 0);
    assert.equal(august.cells.find((cell) => cell.categoryId === TX_CATEGORY_GROCERIES)?.settledActualMinorUnits, -1_250);
  });

  it("refuses a period that is not this budget's", async () => {
    const world = transactionWorld();
    await refuses("period_not_found", () => readBudgetProgress(world.deps, TX_SPACE_B, { periodId: TX_PERIOD_SEP, targets }));
    await refuses("invalid_request", () => readBudgetProgress(world.deps, TX_SPACE_A, { periodId: "nope", targets }));
  });
});
