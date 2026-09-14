/**
 * CBD-201: exact category allocation and split validation, table-driven.
 *
 * The rows below are the whole criterion set for AC05 -- one allocation, many
 * allocations, negative transactions, zero components, maximum supported
 * values, and every mismatch boundary -- run through the same command a real
 * caller uses, so a row that passes here is a row that would persist.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TransactionError,
  assertAllocationsSum,
  createManualTransaction,
  editManualTransaction,
  parseTransactionWriteRequest,
  readTransactionHistory,
} from "./index.ts";
import type { AllocationItem, TransactionErrorCode } from "./index.ts";
import {
  TX_CATEGORY_ARCHIVED,
  TX_CATEGORY_GROCERIES,
  TX_CATEGORY_TRANSPORT,
  TX_SPACE_A,
  TX_SUBJECT_1,
  transactionWorld,
  writeBody,
} from "./support.ts";

const GROCERIES = TX_CATEGORY_GROCERIES;
const TRANSPORT = TX_CATEGORY_TRANSPORT;
const MAX = Number.MAX_SAFE_INTEGER;

interface Row {
  readonly name: string;
  readonly amountMinorUnits: number;
  readonly allocations: readonly { categoryId: string; amountMinorUnits: number }[];
  /** undefined means the row is accepted. */
  readonly code?: TransactionErrorCode;
}

const ROWS: readonly Row[] = [
  // AC01 and AC02: accepted shapes.
  { name: "one allocation equal to the signed amount", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_250 }] },
  { name: "one allocation, positive transaction", amountMinorUnits: 9_900, allocations: [{ categoryId: GROCERIES, amountMinorUnits: 9_900 }] },
  { name: "two allocations summing exactly", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_000 }, { categoryId: TRANSPORT, amountMinorUnits: -250 }] },
  { name: "a zero component where the rest still sums", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_250 }, { categoryId: TRANSPORT, amountMinorUnits: 0 }] },
  { name: "mixed signs summing to a negative total", amountMinorUnits: -500, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_500 }, { categoryId: TRANSPORT, amountMinorUnits: 1_000 }] },
  { name: "a zero transaction with components that cancel", amountMinorUnits: 0, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -750 }, { categoryId: TRANSPORT, amountMinorUnits: 750 }] },
  { name: "a zero transaction with a single zero component", amountMinorUnits: 0, allocations: [{ categoryId: GROCERIES, amountMinorUnits: 0 }] },
  { name: "the maximum supported value", amountMinorUnits: MAX, allocations: [{ categoryId: GROCERIES, amountMinorUnits: MAX }] },
  { name: "the minimum supported value", amountMinorUnits: -MAX, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -MAX }] },
  { name: "the maximum split across two categories", amountMinorUnits: MAX, allocations: [{ categoryId: GROCERIES, amountMinorUnits: MAX - 1 }, { categoryId: TRANSPORT, amountMinorUnits: 1 }] },

  // AC03: every mismatch boundary.
  { name: "one unit short on a negative transaction", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_249 }], code: "allocation_sum_mismatch" },
  { name: "one unit over on a negative transaction", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_251 }], code: "allocation_sum_mismatch" },
  { name: "one unit short on a positive transaction", amountMinorUnits: 1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: 1_249 }], code: "allocation_sum_mismatch" },
  { name: "one unit over on a positive transaction", amountMinorUnits: 1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: 1_251 }], code: "allocation_sum_mismatch" },
  { name: "one unit short across a split", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_000 }, { categoryId: TRANSPORT, amountMinorUnits: -249 }], code: "allocation_sum_mismatch" },
  { name: "a sign flip that would otherwise match in magnitude", amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: 1_250 }], code: "allocation_sum_mismatch" },
  { name: "a zero transaction with a non-zero component", amountMinorUnits: 0, allocations: [{ categoryId: GROCERIES, amountMinorUnits: 1 }], code: "allocation_sum_mismatch" },
  { name: "a running total that leaves the exact integer range", amountMinorUnits: 1, allocations: [{ categoryId: GROCERIES, amountMinorUnits: MAX }, { categoryId: TRANSPORT, amountMinorUnits: MAX }], code: "amount_overflow" },
];

describe("CBD-201-AC01/AC02/AC03/AC05: the exact-sum rule, table-driven", () => {
  for (const row of ROWS) {
    it(`${row.name} ${row.code === undefined ? "is accepted" : `fails as ${row.code}`}`, async () => {
      const world = transactionWorld();
      const request = parseTransactionWriteRequest(writeBody({ amountMinorUnits: row.amountMinorUnits, allocations: row.allocations }));
      if (row.code === undefined) {
        const { current } = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request);
        assert.equal(current.allocations.length, row.allocations.length);
        assert.equal(current.allocations.reduce((total, allocation) => total + allocation.amountMinorUnits, 0), row.amountMinorUnits);
        for (const allocation of current.allocations) {
          assert.equal(allocation.transactionVersionId, current.version.transactionVersionId);
          assert.equal(allocation.currencyCode, current.version.currencyCode);
          assert.equal(Number.isSafeInteger(allocation.amountMinorUnits), true);
        }
        return;
      }
      await assert.rejects(
        () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, request),
        (error: unknown) => error instanceof TransactionError && error.code === row.code,
        row.code,
      );
      assert.equal(world.repository.versions.size, 0, "a refused split writes no transaction");
      assert.equal(world.repository.allocations.size, 0, "a refused split writes no allocation");
    });
  }
});

describe("CBD-201-AC03: allocations that are not about arithmetic", () => {
  it("an empty allocation set is refused", () => {
    assert.throws(() => assertAllocationsSum(0, []), (error: unknown) => error instanceof TransactionError && error.code === "allocations_empty");
    assert.throws(
      () => parseTransactionWriteRequest(writeBody({ allocations: [] })),
      (error: unknown) => error instanceof TransactionError && error.code === "allocations_empty",
    );
  });

  it("a duplicate category is refused before any arithmetic happens", () => {
    assert.throws(
      () => parseTransactionWriteRequest(writeBody({ amountMinorUnits: -1_250, allocations: [{ categoryId: GROCERIES, amountMinorUnits: -600 }, { categoryId: GROCERIES, amountMinorUnits: -650 }] })),
      (error: unknown) => error instanceof TransactionError && error.code === "allocation_duplicate_category",
    );
  });

  it("an archived or foreign category is refused even when the sum is exact", async () => {
    const world = transactionWorld();
    for (const categoryId of [TX_CATEGORY_ARCHIVED, "44444444-4444-4444-8444-444444444444"]) {
      await assert.rejects(
        () => createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, parseTransactionWriteRequest(writeBody({ allocations: [{ categoryId, amountMinorUnits: -1_250 }] }))),
        (error: unknown) => error instanceof TransactionError && error.code === "allocation_category_invalid",
      );
    }
    assert.equal(world.repository.allocations.size, 0);
  });

  it("every allocation is denominated in the transaction's currency, which is the account's", async () => {
    const world = transactionWorld();
    const { current } = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, parseTransactionWriteRequest(writeBody()));
    for (const allocation of current.allocations) {
      assert.equal(allocation.currencyCode, "USD");
      assert.equal(allocation.minorUnitPrecision, 2);
    }
  });
});

describe("CBD-201-AC04: replacing allocations removes the prior effect exactly once", () => {
  it("substitutes the whole set and keeps the ordered before/after data", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, parseTransactionWriteRequest(writeBody({
      amountMinorUnits: -1_250,
      allocations: [{ categoryId: GROCERIES, amountMinorUnits: -1_250 }],
    })));
    const id = created.current.version.transactionId;
    world.now = "2026-09-17T08:00:00.000Z";
    const edited = await editManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1, parseTransactionWriteRequest(writeBody({
      amountMinorUnits: -1_250,
      allocations: [{ categoryId: GROCERIES, amountMinorUnits: -800 }, { categoryId: TRANSPORT, amountMinorUnits: -450 }],
    })));

    assert.equal(edited.previous?.allocations.length, 1);
    assert.equal(edited.current.allocations.length, 2);
    const currentIds = new Set(edited.current.allocations.map((allocation) => allocation.allocationId));
    for (const before of edited.previous?.allocations ?? []) {
      assert.equal(currentIds.has(before.allocationId), false, "a replacement is a new allocation row, never an edit of the old one");
    }

    const history = await readTransactionHistory(world.deps, TX_SPACE_A, id);
    assert.deepEqual(history.map((snapshot) => snapshot.version.revision), [1, 2]);
    assert.deepEqual(history.map((snapshot) => snapshot.allocations.length), [1, 2]);
    assert.equal(history[0]?.version.supersededAt, "2026-09-17T08:00:00.000Z");
    assert.equal(history[1]?.version.supersededAt, null);
    for (const snapshot of history) {
      assert.equal(snapshot.allocations.reduce((total, allocation) => total + allocation.amountMinorUnits, 0), snapshot.version.amountMinorUnits);
    }
  });

  it("a rejected replacement leaves the current set exactly as it was", async () => {
    const world = transactionWorld();
    const created = await createManualTransaction(world.deps, TX_SPACE_A, TX_SUBJECT_1, parseTransactionWriteRequest(writeBody()));
    const id = created.current.version.transactionId;
    const mismatched: readonly AllocationItem[] = [{ categoryId: GROCERIES, amountMinorUnits: -1_249 }];
    await assert.rejects(
      () => editManualTransaction(world.deps, TX_SPACE_A, id, TX_SUBJECT_1, parseTransactionWriteRequest(writeBody({ allocations: mismatched }))),
      (error: unknown) => error instanceof TransactionError && error.code === "allocation_sum_mismatch",
    );
    const history = await readTransactionHistory(world.deps, TX_SPACE_A, id);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.version.supersededAt, null);
    assert.equal(world.repository.allocations.size, 1);
  });
});
