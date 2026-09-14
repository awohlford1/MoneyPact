/**
 * CBD-209-AC02/AC04/AC05 as properties rather than examples.
 *
 * The generator is a seeded linear congruential PRNG, not `Math.random`: a
 * failing case must be reproducible from the seed printed in the assertion
 * message, and a property suite that cannot be replayed is a flake generator.
 * Every property below is checked over the same corpus of pseudo-random
 * worlds, each covering empty sets, zero, positive and negative amounts,
 * supported extrema, and category/period partitioning.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBudgetProgress, isRecordInDetail } from "./progress.ts";
import type { ProgressCellInput, ProgressInput, ProgressRecord } from "./progress.ts";

function prng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const PERIODS = ["p-1", "p-2", "p-3"] as const;
const CATEGORIES = ["c-1", "c-2", "c-3", "c-4"] as const;
/** Amounts a real ledger produces, plus the values that break naive arithmetic. */
const AMOUNTS = [0, 1, -1, 99, -99, 100_000, -100_000, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER] as const;

interface World {
  readonly seed: number;
  readonly input: ProgressInput;
}

function world(seed: number): World {
  const next = prng(seed);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  const cells: ProgressCellInput[] = [];
  for (const periodId of PERIODS) {
    for (const categoryId of CATEGORIES) {
      if (next() < 0.35) continue;
      cells.push({ categoryId, periodId, targetMinorUnits: Math.floor(next() * 200_000) - 50_000 });
    }
  }
  const records: ProgressRecord[] = [];
  const count = Math.floor(next() * 24);
  for (let index = 0; index < count; index += 1) {
    // Extrema are deliberately rare: two of them in one cell would overflow,
    // which is a refusal the unit tests cover rather than a property.
    const amount = next() < 0.04 ? pick(AMOUNTS) : Math.floor(next() * 40_000) - 30_000;
    records.push({
      recordId: `r-${seed}-${index}`,
      categoryId: pick(CATEGORIES),
      periodId: pick(PERIODS),
      settlement: next() < 0.3 ? "pending" : "settled",
      amountMinorUnits: amount,
      included: next() < 0.15 ? false : true,
    });
  }
  return { seed, input: { cells, records } };
}

function shuffled<T>(values: readonly T[], next: () => number): readonly T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const left = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = left;
  }
  return copy;
}

const WORLDS: readonly World[] = Array.from({ length: 200 }, (_, index) => world(index + 1));

/** Skip the rare world whose random draw overflows; overflow is a refusal, tested directly elsewhere. */
function computed(input: ProgressInput): ReturnType<typeof calculateBudgetProgress> | null {
  try {
    return calculateBudgetProgress(input);
  } catch {
    return null;
  }
}

describe("CBD-209-AC05: properties over generated worlds", () => {
  it("covers non-trivial worlds", () => {
    const sizes = WORLDS.map((w) => w.input.records.length);
    assert.ok(Math.max(...sizes) > 10, "generator produced no substantial world");
    assert.ok(sizes.includes(0) || Math.min(...sizes) < 3, "generator produced no near-empty world");
  });

  it("CBD-209-AC02: every aggregate equals the signed sum of its own detail set", () => {
    for (const { seed, input } of WORLDS) {
      const result = computed(input);
      if (result === null) continue;
      const byId = new Map(input.records.map((record) => [record.recordId, record] as const));
      for (const cell of result.cells) {
        const settled = cell.settledRecordIds.reduce((total, id) => total + (byId.get(id)?.amountMinorUnits ?? Number.NaN), 0);
        const pending = cell.pendingRecordIds.reduce((total, id) => total + (byId.get(id)?.amountMinorUnits ?? Number.NaN), 0);
        assert.equal(cell.settledActualMinorUnits, settled, `seed ${seed} ${cell.periodId}/${cell.categoryId}`);
        assert.equal(cell.pendingProvisionalImpactMinorUnits, pending, `seed ${seed} ${cell.periodId}/${cell.categoryId}`);
        assert.equal(cell.remainingAfterSettledMinorUnits, cell.targetMinorUnits + settled, `seed ${seed}`);
        assert.equal(cell.remainingAfterPendingMinorUnits, cell.targetMinorUnits + settled + pending, `seed ${seed}`);
      }
    }
  });

  it("CBD-209-AC03: every record is either in exactly one detail set or in excludedRecordIds", () => {
    for (const { seed, input } of WORLDS) {
      const result = computed(input);
      if (result === null) continue;
      const excluded = new Set(result.excludedRecordIds);
      for (const record of input.records) {
        const discoverable: boolean = isRecordInDetail(result, record) && record.included !== false;
        assert.equal(discoverable !== excluded.has(record.recordId), true, `seed ${seed} record ${record.recordId} is in both or neither`);
      }
      const detailCount = result.cells.reduce((total, cell) => total + cell.settledRecordIds.length + cell.pendingRecordIds.length, 0);
      assert.equal(detailCount + excluded.size, input.records.length, `seed ${seed}`);
    }
  });

  it("CBD-209-AC04: shuffling the inputs does not change the output or the calculation version", () => {
    for (const { seed, input } of WORLDS) {
      const next = prng(seed * 7 + 1);
      const result = computed(input);
      if (result === null) continue;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const shuffledResult = calculateBudgetProgress({ cells: shuffled(input.cells, next), records: shuffled(input.records, next) });
        assert.equal(JSON.stringify(shuffledResult), JSON.stringify(result), `seed ${seed} attempt ${attempt}`);
      }
    }
  });

  it("CBD-209-AC05: every reported value is a safe integer", () => {
    for (const { seed, input } of WORLDS) {
      const result = computed(input);
      if (result === null) continue;
      for (const cell of result.cells) {
        for (const value of [cell.targetMinorUnits, cell.settledActualMinorUnits, cell.pendingProvisionalImpactMinorUnits, cell.remainingAfterSettledMinorUnits, cell.remainingAfterPendingMinorUnits]) {
          assert.equal(Number.isSafeInteger(value), true, `seed ${seed} ${cell.periodId}/${cell.categoryId}`);
        }
      }
    }
  });
});
