/**
 * CBD-209 unit tests: the four named values, aggregate/detail identity,
 * inclusion and exclusion, partitioning, and the boundaries.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROGRESS_CALCULATION_VERSION,
  ProgressError,
  calculateBudgetProgress,
  findProgressCell,
  isRecordInDetail,
} from "./progress.ts";
import type { ProgressInput, ProgressRecord } from "./progress.ts";

const PERIOD_SEP = "period-2026-09";
const PERIOD_AUG = "period-2026-08";
const GROCERIES = "cat-groceries";
const TRANSPORT = "cat-transport";

function record(overrides: Partial<ProgressRecord> & { recordId: string; amountMinorUnits: number }): ProgressRecord {
  return { categoryId: GROCERIES, periodId: PERIOD_SEP, settlement: "settled", ...overrides };
}

const TWO_CELLS: ProgressInput["cells"] = [
  { categoryId: GROCERIES, periodId: PERIOD_SEP, targetMinorUnits: 50_000 },
  { categoryId: TRANSPORT, periodId: PERIOD_SEP, targetMinorUnits: 20_000 },
];

describe("CBD-209-AC01: four separately named integer-minor-unit values per cell", () => {
  it("names settled actual, pending provisional impact, remaining after settled, and remaining after pending", () => {
    const result = calculateBudgetProgress({
      cells: TWO_CELLS,
      records: [
        record({ recordId: "a", amountMinorUnits: -1_250 }),
        record({ recordId: "b", amountMinorUnits: -4_000 }),
        record({ recordId: "c", amountMinorUnits: -7_500, settlement: "pending" }),
      ],
    });
    const cell = findProgressCell(result, PERIOD_SEP, GROCERIES);
    assert.ok(cell);
    assert.equal(cell.settledActualMinorUnits, -5_250);
    assert.equal(cell.pendingProvisionalImpactMinorUnits, -7_500);
    assert.equal(cell.remainingAfterSettledMinorUnits, 44_750);
    assert.equal(cell.remainingAfterPendingMinorUnits, 37_250);
    for (const value of [cell.settledActualMinorUnits, cell.pendingProvisionalImpactMinorUnits, cell.remainingAfterSettledMinorUnits, cell.remainingAfterPendingMinorUnits]) {
      assert.equal(Number.isSafeInteger(value), true);
    }
  });

  it("one manual expense moves spent and remaining and nothing else (PROTOTYPE-SLICE-001)", () => {
    const before = calculateBudgetProgress({ cells: TWO_CELLS, records: [] });
    const after = calculateBudgetProgress({ cells: TWO_CELLS, records: [record({ recordId: "e1", amountMinorUnits: -1_250 })] });
    assert.equal(findProgressCell(before, PERIOD_SEP, GROCERIES)?.remainingAfterSettledMinorUnits, 50_000);
    assert.equal(findProgressCell(after, PERIOD_SEP, GROCERIES)?.settledActualMinorUnits, -1_250);
    assert.equal(findProgressCell(after, PERIOD_SEP, GROCERIES)?.remainingAfterSettledMinorUnits, 48_750);
    assert.deepEqual(findProgressCell(after, PERIOD_SEP, TRANSPORT), findProgressCell(before, PERIOD_SEP, TRANSPORT));
  });

  it("an overspent cell reports a negative remaining rather than clamping to zero", () => {
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [record({ recordId: "over", amountMinorUnits: -60_000 })] });
    assert.equal(findProgressCell(result, PERIOD_SEP, GROCERIES)?.remainingAfterSettledMinorUnits, -10_000);
  });

  it("a refund is a positive signed record and increases remaining", () => {
    const result = calculateBudgetProgress({
      cells: TWO_CELLS,
      records: [record({ recordId: "spend", amountMinorUnits: -3_000 }), record({ recordId: "refund", amountMinorUnits: 1_000 })],
    });
    assert.equal(findProgressCell(result, PERIOD_SEP, GROCERIES)?.settledActualMinorUnits, -2_000);
    assert.equal(findProgressCell(result, PERIOD_SEP, GROCERIES)?.remainingAfterSettledMinorUnits, 48_000);
  });
});

describe("CBD-209-AC02: every aggregate equals the signed sum of its itemized records", () => {
  it("holds for settled and pending independently", () => {
    const records = [
      record({ recordId: "s1", amountMinorUnits: -1 }),
      record({ recordId: "s2", amountMinorUnits: -999 }),
      record({ recordId: "s3", amountMinorUnits: 500 }),
      record({ recordId: "p1", amountMinorUnits: -2_500, settlement: "pending" }),
      record({ recordId: "p2", amountMinorUnits: 2_500, settlement: "pending" }),
    ];
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records });
    const cell = findProgressCell(result, PERIOD_SEP, GROCERIES);
    assert.ok(cell);
    const sumOf = (ids: readonly string[]) =>
      ids.reduce((total, id) => total + (records.find((r) => r.recordId === id)?.amountMinorUnits ?? Number.NaN), 0);
    assert.equal(cell.settledActualMinorUnits, sumOf(cell.settledRecordIds));
    assert.equal(cell.pendingProvisionalImpactMinorUnits, sumOf(cell.pendingRecordIds));
    assert.equal(cell.remainingAfterSettledMinorUnits, cell.targetMinorUnits + cell.settledActualMinorUnits);
    assert.equal(cell.remainingAfterPendingMinorUnits, cell.targetMinorUnits + cell.settledActualMinorUnits + cell.pendingProvisionalImpactMinorUnits);
  });

  it("an empty set gives zero aggregates, empty detail, and the target untouched", () => {
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [] });
    for (const cell of result.cells) {
      assert.equal(cell.settledActualMinorUnits, 0);
      assert.equal(cell.pendingProvisionalImpactMinorUnits, 0);
      assert.equal(cell.remainingAfterSettledMinorUnits, cell.targetMinorUnits);
      assert.equal(cell.remainingAfterPendingMinorUnits, cell.targetMinorUnits);
      assert.deepEqual(cell.settledRecordIds, []);
      assert.deepEqual(cell.pendingRecordIds, []);
    }
  });

  it("no cells at all is an empty result, not a failure", () => {
    const result = calculateBudgetProgress({ cells: [], records: [record({ recordId: "orphan", amountMinorUnits: -1 })] });
    assert.deepEqual(result.cells, []);
    assert.deepEqual(result.excludedRecordIds, ["orphan"]);
  });

  it("a zero-amount record contributes nothing but is still itemized", () => {
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [record({ recordId: "z", amountMinorUnits: 0 })] });
    const cell = findProgressCell(result, PERIOD_SEP, GROCERIES);
    assert.equal(cell?.settledActualMinorUnits, 0);
    assert.deepEqual(cell?.settledRecordIds, ["z"]);
  });
});

describe("CBD-209-AC03: inclusion is discoverable, exclusion is total", () => {
  it("an included item appears in the matching detail set", () => {
    const included = record({ recordId: "in", amountMinorUnits: -400 });
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [included] });
    assert.equal(isRecordInDetail(result, included), true);
    assert.deepEqual(result.excludedRecordIds, []);
  });

  it("an explicitly excluded item appears in neither aggregate nor detail", () => {
    const excluded = record({ recordId: "out", amountMinorUnits: -400, included: false });
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [excluded] });
    assert.equal(isRecordInDetail(result, excluded), false);
    assert.equal(findProgressCell(result, PERIOD_SEP, GROCERIES)?.settledActualMinorUnits, 0);
    assert.deepEqual(result.excludedRecordIds, ["out"]);
  });

  it("a record outside the requested cells is excluded by the filter, not silently added elsewhere", () => {
    const stray = record({ recordId: "stray", amountMinorUnits: -400, periodId: PERIOD_AUG });
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [stray] });
    assert.deepEqual(result.excludedRecordIds, ["stray"]);
    for (const cell of result.cells) assert.equal(cell.settledActualMinorUnits, 0);
  });

  it("a settled record is not discoverable in the pending detail set", () => {
    const settled = record({ recordId: "s", amountMinorUnits: -400 });
    const result = calculateBudgetProgress({ cells: TWO_CELLS, records: [settled] });
    assert.equal(isRecordInDetail(result, { ...settled, settlement: "pending" }), false);
  });
});

describe("CBD-209-AC04: determinism and calculation version", () => {
  it("differently ordered inputs representing the same facts produce identical output", () => {
    const records = [
      record({ recordId: "r1", amountMinorUnits: -100 }),
      record({ recordId: "r2", amountMinorUnits: -200, categoryId: TRANSPORT }),
      record({ recordId: "r3", amountMinorUnits: -300, settlement: "pending" }),
      record({ recordId: "r4", amountMinorUnits: 50 }),
    ];
    const forward = calculateBudgetProgress({ cells: TWO_CELLS, records });
    const reversed = calculateBudgetProgress({ cells: [...TWO_CELLS].reverse(), records: [...records].reverse() });
    assert.deepEqual(forward, reversed);
    assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
    assert.equal(forward.calculationVersion, PROGRESS_CALCULATION_VERSION);
    assert.equal(reversed.calculationVersion, PROGRESS_CALCULATION_VERSION);
  });

  it("cells come back in one canonical order whatever order they were asked for", () => {
    const cells = [
      { categoryId: TRANSPORT, periodId: PERIOD_SEP, targetMinorUnits: 1 },
      { categoryId: GROCERIES, periodId: PERIOD_AUG, targetMinorUnits: 2 },
      { categoryId: GROCERIES, periodId: PERIOD_SEP, targetMinorUnits: 3 },
    ];
    const ordered = calculateBudgetProgress({ cells, records: [] }).cells.map((cell) => `${cell.periodId}/${cell.categoryId}`);
    assert.deepEqual(ordered, [`${PERIOD_AUG}/${GROCERIES}`, `${PERIOD_SEP}/${GROCERIES}`, `${PERIOD_SEP}/${TRANSPORT}`]);
  });
});

describe("CBD-209-AC05: partitioning, extrema and refusals", () => {
  it("partitions by category and by period; neither leaks into the other", () => {
    const result = calculateBudgetProgress({
      cells: [
        { categoryId: GROCERIES, periodId: PERIOD_SEP, targetMinorUnits: 1_000 },
        { categoryId: GROCERIES, periodId: PERIOD_AUG, targetMinorUnits: 1_000 },
        { categoryId: TRANSPORT, periodId: PERIOD_SEP, targetMinorUnits: 1_000 },
      ],
      records: [
        record({ recordId: "a", amountMinorUnits: -1 }),
        record({ recordId: "b", amountMinorUnits: -10, periodId: PERIOD_AUG }),
        record({ recordId: "c", amountMinorUnits: -100, categoryId: TRANSPORT }),
      ],
    });
    assert.equal(findProgressCell(result, PERIOD_SEP, GROCERIES)?.settledActualMinorUnits, -1);
    assert.equal(findProgressCell(result, PERIOD_AUG, GROCERIES)?.settledActualMinorUnits, -10);
    assert.equal(findProgressCell(result, PERIOD_SEP, TRANSPORT)?.settledActualMinorUnits, -100);
  });

  it("carries supported extrema exactly", () => {
    const result = calculateBudgetProgress({
      cells: [{ categoryId: GROCERIES, periodId: PERIOD_SEP, targetMinorUnits: 0 }],
      records: [
        record({ recordId: "max", amountMinorUnits: Number.MAX_SAFE_INTEGER }),
        record({ recordId: "min", amountMinorUnits: -Number.MAX_SAFE_INTEGER }),
      ],
    });
    assert.equal(findProgressCell(result, PERIOD_SEP, GROCERIES)?.settledActualMinorUnits, 0);
  });

  it("refuses a fractional amount rather than rounding it", () => {
    assert.throws(
      () => calculateBudgetProgress({ cells: TWO_CELLS, records: [record({ recordId: "f", amountMinorUnits: 12.5 })] }),
      (error: unknown) => error instanceof ProgressError && error.code === "amount_not_integer",
    );
  });

  it("refuses a fractional target", () => {
    assert.throws(
      () => calculateBudgetProgress({ cells: [{ categoryId: GROCERIES, periodId: PERIOD_SEP, targetMinorUnits: 0.5 }], records: [] }),
      (error: unknown) => error instanceof ProgressError && error.code === "target_not_integer",
    );
  });

  it("refuses a duplicate cell and a duplicate record identity", () => {
    assert.throws(
      () => calculateBudgetProgress({ cells: [...TWO_CELLS, TWO_CELLS[0] as ProgressInput["cells"][number]], records: [] }),
      (error: unknown) => error instanceof ProgressError && error.code === "duplicate_cell",
    );
    assert.throws(
      () => calculateBudgetProgress({ cells: TWO_CELLS, records: [record({ recordId: "same", amountMinorUnits: -1 }), record({ recordId: "same", amountMinorUnits: -2 })] }),
      (error: unknown) => error instanceof ProgressError && error.code === "duplicate_record",
    );
  });

  it("refuses an aggregate that would leave the exact integer range rather than losing a unit", () => {
    assert.throws(
      () => calculateBudgetProgress({
        cells: [{ categoryId: GROCERIES, periodId: PERIOD_SEP, targetMinorUnits: 0 }],
        records: [
          record({ recordId: "a", amountMinorUnits: Number.MAX_SAFE_INTEGER }),
          record({ recordId: "b", amountMinorUnits: Number.MAX_SAFE_INTEGER }),
        ],
      }),
      (error: unknown) => error instanceof ProgressError && error.code === "overflow",
    );
  });
});
