/**
 * Budget progress (CBD-209 / CBD-34).
 *
 * The whole of "spent and remaining" as one pure function. It is given the
 * cells it must answer for -- a category, a period, and the target that
 * governs them -- and the itemized records that bear on them, and it returns
 * four separately named integer-minor-unit values per cell (AC01) plus the
 * detail set each aggregate was computed from (AC03).
 *
 * Four decisions make the invariants structural rather than tested-for:
 *
 * 1. Amounts are signed throughout. A record is a signed contribution: an
 *    expense is negative, a refund or income positive. Nothing here knows
 *    what "spending" is, so nothing here can get the sign of an unusual case
 *    wrong. `settledActualMinorUnits` is therefore exactly the signed sum of
 *    the settled records in the detail set (AC02) rather than a magnitude
 *    that happens to agree with it.
 *
 * 2. Remaining is `target + actual`, in the same signed convention. With a
 *    target of 50000 and one settled expense of -1250, remaining after
 *    settled is 48750; an overspent cell is simply negative. There is no
 *    absolute value and no clamp anywhere in this module, because a clamp
 *    would break the aggregate/detail identity at exactly the moment a user
 *    most needs to see it.
 *
 * 3. Settled and pending are separate sums and never merge. `pending` here is
 *    a *provisional impact*, which is why it is named one and why remaining
 *    after pending is reported next to, not instead of, remaining after
 *    settled (CBD-107's settled/pending vocabulary). The manual increment
 *    produces settled records only; the pending value exists so that adding
 *    imported pending transactions later changes an input, not this shape.
 *
 * 4. Nothing depends on input order. Every sum is taken over a set keyed by
 *    stable record identity, every output list is sorted by stable identity,
 *    and the cells come back in one canonical order, so two orderings of the
 *    same facts produce byte-identical output and the same calculation
 *    version (AC04).
 *
 * A record whose category/period pair is not one of the requested cells, or
 * that the caller marked excluded, appears in no aggregate and in no detail
 * set (AC03). It is reported by identity in `excludedRecordIds` so that
 * "excluded" is observable rather than merely absent.
 */

/** Bumped when the arithmetic or the shape of a result changes. Recorded on every result (AC04). */
export const PROGRESS_CALCULATION_VERSION = "budget-domain/progress/1";

export const PROGRESS_ERROR_CODES = [
  "amount_not_integer",
  "target_not_integer",
  "duplicate_cell",
  "duplicate_record",
  "overflow",
] as const;

export type ProgressErrorCode = (typeof PROGRESS_ERROR_CODES)[number];

/** A refusal to compute. `detail` names a field or an identity, never a customer value. */
export class ProgressError extends Error {
  readonly code: ProgressErrorCode;
  readonly detail: string | undefined;
  constructor(code: ProgressErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ProgressError";
    this.code = code;
    this.detail = detail;
  }
}

/** CBD-107's lifecycle vocabulary, reduced to the distinction progress depends on. */
export const SETTLEMENT_STATES = ["settled", "pending"] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

/**
 * One itemized record: a single category's signed share of one transaction,
 * which is exactly what a `transaction_allocation` row is. `recordId` is the
 * stable identity the detail set reports.
 */
export interface ProgressRecord {
  readonly recordId: string;
  readonly categoryId: string;
  readonly periodId: string;
  readonly settlement: SettlementState;
  readonly amountMinorUnits: number;
  /** False excludes the record from every aggregate and every detail set: a removed transaction, a filtered account. Defaults to true. */
  readonly included?: boolean;
}

/** A cell the caller wants answered, with the target that governs it. */
export interface ProgressCellInput {
  readonly categoryId: string;
  readonly periodId: string;
  readonly targetMinorUnits: number;
}

export interface ProgressInput {
  readonly cells: readonly ProgressCellInput[];
  readonly records: readonly ProgressRecord[];
}

/** The four named values for one category and period, with the detail each was computed from. */
export interface ProgressCell {
  readonly categoryId: string;
  readonly periodId: string;
  readonly targetMinorUnits: number;
  readonly settledActualMinorUnits: number;
  readonly pendingProvisionalImpactMinorUnits: number;
  readonly remainingAfterSettledMinorUnits: number;
  readonly remainingAfterPendingMinorUnits: number;
  /** Identities of the settled records `settledActualMinorUnits` is the signed sum of, in stable order. */
  readonly settledRecordIds: readonly string[];
  /** Identities of the pending records `pendingProvisionalImpactMinorUnits` is the signed sum of, in stable order. */
  readonly pendingRecordIds: readonly string[];
}

export interface ProgressResult {
  readonly calculationVersion: string;
  readonly cells: readonly ProgressCell[];
  /** Records that matched no requested cell or were marked excluded; in neither aggregate nor detail (AC03). */
  readonly excludedRecordIds: readonly string[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cellKey(periodId: string, categoryId: string): string {
  // Unit separator: no identifier this domain accepts can contain it, so the
  // key cannot collide the way "a|b" + "c" and "a" + "b|c" can.
  return `${periodId}${categoryId}`;
}

/** Every value in this module is an integer minor unit; a fractional or unsafe one is refused, never rounded. */
function assertMinorUnits(code: ProgressErrorCode, detail: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new ProgressError(code, detail);
  return value;
}

function addExact(left: number, right: number, detail: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new ProgressError("overflow", detail);
  return total;
}

interface Accumulator {
  readonly input: ProgressCellInput;
  settled: number;
  pending: number;
  readonly settledRecordIds: string[];
  readonly pendingRecordIds: string[];
}

/**
 * Compute progress for every requested cell.
 *
 * Deterministic and total: the same facts in any order give the same result,
 * an empty input gives an empty result rather than an error, and anything the
 * arithmetic cannot represent exactly is refused with a `ProgressError`
 * instead of silently rounded.
 */
export function calculateBudgetProgress(input: ProgressInput): ProgressResult {
  const accumulators = new Map<string, Accumulator>();
  for (const cell of input.cells) {
    assertMinorUnits("target_not_integer", `${cell.periodId}/${cell.categoryId}.targetMinorUnits`, cell.targetMinorUnits);
    const key = cellKey(cell.periodId, cell.categoryId);
    if (accumulators.has(key)) throw new ProgressError("duplicate_cell", `${cell.periodId}/${cell.categoryId}`);
    accumulators.set(key, { input: cell, settled: 0, pending: 0, settledRecordIds: [], pendingRecordIds: [] });
  }

  const seen = new Set<string>();
  const excluded: string[] = [];
  for (const record of input.records) {
    if (seen.has(record.recordId)) throw new ProgressError("duplicate_record", record.recordId);
    seen.add(record.recordId);
    assertMinorUnits("amount_not_integer", `${record.recordId}.amountMinorUnits`, record.amountMinorUnits);
    const accumulator = accumulators.get(cellKey(record.periodId, record.categoryId));
    if (accumulator === undefined || record.included === false) {
      excluded.push(record.recordId);
      continue;
    }
    if (record.settlement === "settled") {
      accumulator.settled = addExact(accumulator.settled, record.amountMinorUnits, `${record.periodId}/${record.categoryId}.settledActualMinorUnits`);
      accumulator.settledRecordIds.push(record.recordId);
    } else {
      accumulator.pending = addExact(accumulator.pending, record.amountMinorUnits, `${record.periodId}/${record.categoryId}.pendingProvisionalImpactMinorUnits`);
      accumulator.pendingRecordIds.push(record.recordId);
    }
  }

  const cells = [...accumulators.values()]
    .map((accumulator): ProgressCell => {
      const { categoryId, periodId, targetMinorUnits } = accumulator.input;
      const detail = `${periodId}/${categoryId}`;
      const remainingAfterSettled = addExact(targetMinorUnits, accumulator.settled, `${detail}.remainingAfterSettledMinorUnits`);
      return {
        categoryId,
        periodId,
        targetMinorUnits,
        settledActualMinorUnits: accumulator.settled,
        pendingProvisionalImpactMinorUnits: accumulator.pending,
        remainingAfterSettledMinorUnits: remainingAfterSettled,
        remainingAfterPendingMinorUnits: addExact(remainingAfterSettled, accumulator.pending, `${detail}.remainingAfterPendingMinorUnits`),
        settledRecordIds: [...accumulator.settledRecordIds].sort(compareText),
        pendingRecordIds: [...accumulator.pendingRecordIds].sort(compareText),
      };
    })
    .sort((a, b) => compareText(a.periodId, b.periodId) || compareText(a.categoryId, b.categoryId));

  return { calculationVersion: PROGRESS_CALCULATION_VERSION, cells, excludedRecordIds: [...excluded].sort(compareText) };
}

/** The cell for one category and period, or null when it was not requested. */
export function findProgressCell(result: ProgressResult, periodId: string, categoryId: string): ProgressCell | null {
  return result.cells.find((cell) => cell.periodId === periodId && cell.categoryId === categoryId) ?? null;
}

/** True when the record's identity appears in the detail set of the cell it belongs to (AC03). */
export function isRecordInDetail(result: ProgressResult, record: ProgressRecord): boolean {
  const cell = findProgressCell(result, record.periodId, record.categoryId);
  if (cell === null) return false;
  const detail = record.settlement === "settled" ? cell.settledRecordIds : cell.pendingRecordIds;
  return detail.includes(record.recordId);
}
