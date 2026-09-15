/**
 * CBD-211 web presentation (PROTO-CBD211-WEB-PRESENTATION-001): the read-side
 * mapping carries the API's four values per cell with their signs as words, and
 * tells a category nothing was recorded against from one whose activity nets to
 * zero. The sentences themselves are checked in the browser by
 * scripts/prototype-qa-browser-cbd211.mjs and apps/web/tests/browser.test.mjs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { directionOf, toCategoryDetail, toProgress, toProgressCell } from "../src/api/client.ts";
import type { WireProgressCell } from "../src/api/client.ts";

const cell = (overrides: Partial<WireProgressCell>): WireProgressCell => ({
  categoryId: "c", targetMinorUnits: 10_000, settledActualMinorUnits: 0, pendingProvisionalImpactMinorUnits: 0,
  remainingAfterSettledMinorUnits: 10_000, remainingAfterPendingMinorUnits: 10_000, settledRecordIds: [], pendingRecordIds: [], ...overrides,
});

test("CBD-211-AC01: the four values arrive separately, each a magnitude with its own sign", () => {
  const spend = toProgressCell(cell({ settledActualMinorUnits: -900, remainingAfterSettledMinorUnits: 9_100, pendingProvisionalImpactMinorUnits: -500, remainingAfterPendingMinorUnits: 8_600, settledRecordIds: ["a", "b", "c"], pendingRecordIds: ["d"] }), "Groceries", 2);
  assert.deepEqual(
    [spend.target, spend.spent, spend.settledDirection, spend.settledActivity, spend.pendingImpact, spend.pendingDirection, spend.remaining, spend.over, spend.remainingAfterPending, spend.overAfterPending],
    ["100.00", "9.00", "spend", "active", "5.00", "spend", "91.00", false, "86.00", false],
  );
  const over = toProgressCell(cell({ settledActualMinorUnits: -15_000, remainingAfterSettledMinorUnits: -5_000, pendingProvisionalImpactMinorUnits: 200, remainingAfterPendingMinorUnits: -4_800, settledRecordIds: ["a"], pendingRecordIds: ["b"] }), "Over", 2);
  assert.deepEqual([over.remaining, over.over, over.pendingImpact, over.pendingDirection, over.remainingAfterPending, over.overAfterPending], ["50.00", true, "2.00", "refund", "48.00", true]);
});

test("CBD-211-AC03/AC04: a net refund is a refund, not money spent, and items keep their direction", () => {
  const refund = toProgressCell(cell({ settledActualMinorUnits: 2_000, remainingAfterSettledMinorUnits: 12_000, remainingAfterPendingMinorUnits: 12_000, settledRecordIds: ["a", "b"] }), "Refund", 2);
  assert.deepEqual([refund.spent, refund.settledDirection, refund.remaining, refund.over], ["20.00", "refund", "120.00", false]);
  assert.deepEqual([directionOf(-1), directionOf(0), directionOf(1)], ["spend", "zero", "refund"]);
  const detail = toCategoryDetail({
    budgetSpaceId: "b", periodId: "p", categoryId: "c", label: "Groceries", currencyCode: "USD", minorUnitPrecision: 2,
    cell: cell({ settledActualMinorUnits: -900, remainingAfterSettledMinorUnits: 9_100, remainingAfterPendingMinorUnits: 9_100, settledRecordIds: ["1", "2", "3"] }),
    items: [
      { transactionId: "1", accountId: "a", budgetDate: "2026-09-01", description: "Corner shop", amountMinorUnits: -800, allocationCount: 2 },
      { transactionId: "2", accountId: "a", budgetDate: "2026-09-01", description: "Milk", amountMinorUnits: -300, allocationCount: 1 },
      { transactionId: "3", accountId: "a", budgetDate: "2026-09-01", description: "Refund for spoiled milk", amountMinorUnits: 200, allocationCount: 1 },
    ],
  });
  assert.deepEqual(detail.items.map(item => [item.amount, item.direction]), [["8.00", "spend"], ["3.00", "spend"], ["2.00", "refund"]]);
  assert.equal(detail.cell!.spent, "9.00");
});

test("CBD-211-AC04: no activity, net-zero activity and an unstated record set are three different states", () => {
  assert.equal(toProgressCell(cell({}), "Idle", 2).settledActivity, "none");
  assert.equal(toProgressCell(cell({ settledRecordIds: ["a", "b"] }), "Net zero", 2).settledActivity, "net-zero");
  assert.equal(toProgressCell(cell({ settledRecordIds: undefined }), "Unknown", 2).settledActivity, "unknown");
  assert.equal(toProgressCell(cell({ settledActualMinorUnits: -1, remainingAfterSettledMinorUnits: 9_999, remainingAfterPendingMinorUnits: 9_999, settledRecordIds: ["a"] }), "Active", 2).settledActivity, "active");
  // A response without the pending pair (an older API) reads as nothing pending, never as a merged figure.
  const legacy = toProgressCell({ categoryId: "c", targetMinorUnits: 10_000, settledActualMinorUnits: -900, remainingAfterSettledMinorUnits: 9_100 } as WireProgressCell, "Legacy", 2);
  assert.deepEqual([legacy.pendingImpact, legacy.pendingDirection, legacy.remainingAfterPending, legacy.overAfterPending, legacy.settledActivity], ["0.00", "zero", "91.00", false, "active"]);
  const progress = toProgress({ budgetSpaceId: "b", periodId: "p", currencyCode: "USD", minorUnitPrecision: 2, labels: { c: "Zed", d: "Alpha" }, calculationVersion: "v", cells: [cell({ categoryId: "c" }), cell({ categoryId: "d" })] });
  assert.deepEqual(progress.cells.map(entry => entry.label), ["Alpha", "Zed"]);
});
