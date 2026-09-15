/**
 * Manual transaction commands and the budget-progress query (CBD-199,
 * CBD-200 at the application layer, CBD-201, CBD-209).
 *
 * Create, edit and remove are all the same shape: parse the whole request
 * into canonical errors, resolve the period from the budget's stored periods,
 * check the allocation set adds up exactly, then write one new version with
 * its allocations and stamp the version it replaces. Nothing is written until
 * every check has passed, so a rejected request leaves no transaction, no
 * allocation and no partial effect (CBD-199-AC03, CBD-201-AC03).
 *
 * Period assignment (CBD-199-AC04) is {@link assignPeriod}: the supplied
 * periods are the only boundaries it may use, it never derives one, and it
 * never moves one. A date on a period's start falls in that period because
 * the comparison is inclusive at both ends; the preceding calendar date falls
 * in the preceding period for exactly the same reason. Both facts are one
 * comparison, not two rules that could drift apart.
 *
 * The progress query (CBD-209) does no arithmetic of its own. It reads the
 * period's current, non-removed versions and their allocations, hands them to
 * budget-domain's `calculateBudgetProgress` as itemized records, and returns
 * what comes back. That is what keeps the aggregate/detail identity a
 * property of one pure function rather than of this module's SQL.
 */
import { createHash } from "node:crypto";
import { calculateBudgetProgress } from "@cobudget/budget-domain/progress";
import type { ProgressInput, ProgressRecord, ProgressResult } from "@cobudget/budget-domain/progress";
import { canonicalJSON } from "../creation-proposals/canonical-json.ts";
import { parseSignedMinorUnits } from "../accounts/records.ts";
import type { AccountRecord } from "../accounts/records.ts";
import type { Clock, IdGenerator, TransactionsRepository } from "./ports.ts";
import {
  ISO_DATE_PATTERN,
  MANUAL_TRANSACTION_ORIGIN,
  MAX_DESCRIPTION_LENGTH,
  SETTLED_STATE,
  StaleVersionError,
  TransactionError,
  asTransactionError,
  compareTransactionIds,
} from "./records.ts";
import type {
  AllocationRecord,
  IdempotentTransactionAction,
  PeriodRecord,
  TransactionMutation,
  TransactionRecord,
  TransactionSnapshot,
} from "./records.ts";

export interface TransactionsDependencies {
  readonly repository: TransactionsRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A real `YYYY-MM-DD` calendar date. `2026-02-30` matches the pattern and is still not a date. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [, rawYear, rawMonth, rawDay] = match;
  if (rawYear === undefined || rawMonth === undefined || rawDay === undefined) return false;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limit = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1] ?? 0;
  return day <= limit;
}

/**
 * The period a budget date belongs to (CBD-199-AC04).
 *
 * Inclusive at both ends, against the supplied periods only. Two periods that
 * both contain the date is a defect in the stored schedule, not something to
 * resolve by picking one, so it is refused as `period_ambiguous`.
 */
export function assignPeriod(periods: readonly PeriodRecord[], budgetDate: string): PeriodRecord {
  if (!isCalendarDate(budgetDate)) throw new TransactionError("date_invalid", "budgetDate");
  const matches = periods.filter((period) => period.periodStart <= budgetDate && budgetDate <= period.periodEnd);
  const first = matches[0];
  if (first === undefined) throw new TransactionError("period_not_found", "budgetDate");
  if (matches.length > 1) throw new TransactionError("period_ambiguous", "budgetDate");
  return first;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

export interface AllocationItem {
  readonly categoryId: string;
  readonly amountMinorUnits: number;
}

export interface TransactionWriteRequest {
  readonly accountId: string;
  readonly amountMinorUnits: number;
  readonly budgetDate: string;
  readonly description: string | null;
  readonly allocations: readonly AllocationItem[];
}

/**
 * Parse `{ accountId, amountMinorUnits, budgetDate, description?, allocations }`.
 *
 * A single-category convenience is deliberately absent: a caller that names
 * one category supplies one allocation equal to the whole signed amount
 * (CBD-201-AC01), so there is one code path and one place the sum is checked
 * rather than two that could disagree.
 */
export function parseTransactionWriteRequest(body: unknown): TransactionWriteRequest {
  if (!isRecordObject(body)) throw new TransactionError("invalid_request", "body");
  if (!isUuid(body.accountId)) throw new TransactionError("invalid_request", "accountId");
  let amountMinorUnits: number;
  try {
    amountMinorUnits = parseSignedMinorUnits(body.amountMinorUnits, "amountMinorUnits");
  } catch (error) { return asTransactionError(error); }
  if (!isCalendarDate(body.budgetDate)) throw new TransactionError("date_invalid", "budgetDate");
  const rawDescription = body.description ?? null;
  if (rawDescription !== null && typeof rawDescription !== "string") throw new TransactionError("description_invalid", "description");
  const description = rawDescription === null ? null : rawDescription.trim();
  if (description !== null && (description.length === 0 || [...description].length > MAX_DESCRIPTION_LENGTH)) {
    throw new TransactionError("description_invalid", "description");
  }
  if (!Array.isArray(body.allocations) || body.allocations.length === 0) throw new TransactionError("allocations_empty", "allocations");
  const seen = new Set<string>();
  const allocations = body.allocations.map((item, index): AllocationItem => {
    const path = `allocations[${index}]`;
    if (!isRecordObject(item)) throw new TransactionError("invalid_request", path);
    if (!isUuid(item.categoryId)) throw new TransactionError("allocation_category_invalid", `${path}.categoryId`);
    if (seen.has(item.categoryId)) throw new TransactionError("allocation_duplicate_category", `${path}.categoryId`);
    seen.add(item.categoryId);
    try {
      return { categoryId: item.categoryId, amountMinorUnits: parseSignedMinorUnits(item.amountMinorUnits, `${path}.amountMinorUnits`) };
    } catch (error) { return asTransactionError(error); }
  });
  return { accountId: body.accountId, amountMinorUnits, budgetDate: body.budgetDate, description, allocations };
}

/**
 * The client's stated basis for an edit or a removal (CBD-200-AC04): the
 * transaction version it was looking at when it decided to mutate.
 *
 * One shape, two carriers. In the body, `expectedTransactionVersionId`; in
 * the request, `If-Match` carrying the same version id as an entity tag
 * (`"<uuid>"`, the quotes optional). Both may be sent and must then agree.
 * Absent everywhere, the mutation has no precondition and behaves as it did
 * before this field existed (backward compatible); present and not the
 * current version, the command refuses `stale_version` having written nothing.
 *
 * `expectedRevision` is deliberately not a carrier. The split-expense
 * proposal (`docs/split-expense-edit-proposal.md`, `OQ-SPLIT-005`) named it
 * before this shape was fixed; a body that states a revision and no version
 * id is refused `invalid_request` rather than silently ignored, so a client
 * written to the older name fails fast instead of losing an update.
 */
export interface VersionPrecondition {
  readonly expectedTransactionVersionId: string;
}

const ENTITY_TAG = /^(W\/)?"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"?$/iu;

export function parseVersionPrecondition(body: unknown, ifMatch: string | readonly string[] | undefined): VersionPrecondition | null {
  let fromBody: string | null = null;
  if (isRecordObject(body)) {
    if (body.expectedTransactionVersionId !== undefined && body.expectedTransactionVersionId !== null) {
      if (!isUuid(body.expectedTransactionVersionId)) throw new TransactionError("invalid_request", "expectedTransactionVersionId");
      fromBody = body.expectedTransactionVersionId.toLowerCase();
    } else if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
      throw new TransactionError("invalid_request", "expectedRevision");
    }
  }
  let fromHeader: string | null = null;
  const header = Array.isArray(ifMatch) ? ifMatch.join(",") : ifMatch;
  if (typeof header === "string" && header.trim() !== "" && header.trim() !== "*") {
    const match = ENTITY_TAG.exec(header.trim());
    // A weak tag is a representation-level comparison; a version id is exact, so only a strong tag names one.
    if (match === null || match[1] !== undefined || match[2] === undefined) throw new TransactionError("invalid_request", "If-Match");
    fromHeader = match[2].toLowerCase();
  }
  if (fromBody !== null && fromHeader !== null && fromBody !== fromHeader) throw new TransactionError("invalid_request", "If-Match");
  const expected = fromBody ?? fromHeader;
  return expected === null ? null : { expectedTransactionVersionId: expected };
}

function assertCurrentBasis(current: TransactionRecord, precondition: VersionPrecondition | null): void {
  if (precondition === null) return;
  if (current.transactionVersionId.toLowerCase() !== precondition.expectedTransactionVersionId) {
    throw new StaleVersionError({ transactionVersionId: current.transactionVersionId, revision: current.revision });
  }
}

/**
 * The request digest an Idempotency-Key is bound to (CBD-200-AC05): SHA-256
 * hex over the canonical JSON of the action, its target and the parsed
 * request, so two requests that parse to the same command share a digest
 * regardless of key order or whitespace, and the same key with a different
 * command is detectable without storing the command.
 */
export function transactionRequestDigest(action: IdempotentTransactionAction, target: { readonly budgetSpaceId: string; readonly transactionId: string | null }, request: TransactionWriteRequest | null, precondition: VersionPrecondition | null): string {
  return createHash("sha256").update(canonicalJSON({ action, budgetSpaceId: target.budgetSpaceId, transactionId: target.transactionId, request, precondition })).digest("hex");
}

/**
 * CBD-201-AC02: the signed sum equals the signed transaction amount exactly.
 *
 * Summed as exact integers with an overflow guard, so a one-unit mismatch in
 * either direction fails and a total that cannot be represented exactly fails
 * rather than rounding into agreement.
 */
export function assertAllocationsSum(amountMinorUnits: number, allocations: readonly AllocationItem[]): void {
  if (allocations.length === 0) throw new TransactionError("allocations_empty", "allocations");
  let total = 0;
  for (const allocation of allocations) {
    total += allocation.amountMinorUnits;
    if (!Number.isSafeInteger(total)) throw new TransactionError("amount_overflow", "allocations");
  }
  if (total !== amountMinorUnits) throw new TransactionError("allocation_sum_mismatch", "allocations");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function resolveAccount(deps: TransactionsDependencies, budgetSpaceId: string, accountId: string): Promise<AccountRecord> {
  const account = await deps.repository.readAccount(budgetSpaceId, accountId);
  if (account === null) throw new TransactionError("account_not_found", "accountId");
  if (account.archivedAt !== null) throw new TransactionError("account_archived", "accountId");
  return account;
}

async function assertCategoriesInScope(deps: TransactionsDependencies, budgetSpaceId: string, allocations: readonly AllocationItem[]): Promise<void> {
  const categories = new Map((await deps.repository.listCategories(budgetSpaceId)).map((category) => [category.categoryId, category] as const));
  for (const [index, allocation] of allocations.entries()) {
    const category = categories.get(allocation.categoryId);
    if (category === undefined || category.budgetSpaceId !== budgetSpaceId || category.archivedAt !== null) {
      throw new TransactionError("allocation_category_invalid", `allocations[${index}].categoryId`);
    }
  }
}

function buildSnapshot(
  deps: TransactionsDependencies,
  identity: { transactionId: string; revision: number },
  budgetSpaceId: string,
  account: AccountRecord,
  period: PeriodRecord,
  request: TransactionWriteRequest,
  actingSubjectId: string,
  now: string,
): TransactionSnapshot {
  const transactionVersionId = deps.ids.uuid();
  const version: TransactionRecord = {
    transactionVersionId,
    transactionId: identity.transactionId,
    budgetSpaceId,
    accountId: account.accountId,
    revision: identity.revision,
    origin: MANUAL_TRANSACTION_ORIGIN,
    settlementState: SETTLED_STATE,
    currencyCode: account.currencyCode,
    minorUnitPrecision: account.minorUnitPrecision,
    amountMinorUnits: request.amountMinorUnits,
    budgetDate: request.budgetDate,
    periodId: period.periodId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    description: request.description,
    recordedBySubjectId: actingSubjectId,
    source: "user",
    removedAt: null,
    removedBySubjectId: null,
    supersededAt: null,
    createdAt: now,
  };
  const allocations = request.allocations.map((item): AllocationRecord => ({
    allocationId: deps.ids.uuid(),
    budgetSpaceId,
    transactionVersionId,
    categoryId: item.categoryId,
    currencyCode: account.currencyCode,
    minorUnitPrecision: account.minorUnitPrecision,
    amountMinorUnits: item.amountMinorUnits,
    createdAt: now,
  }));
  return { version, allocations };
}

/** One settled manual transaction with manual origin, its account's denomination, and a stable identity (CBD-199-AC01). */
export async function createManualTransaction(
  deps: TransactionsDependencies,
  budgetSpaceId: string,
  actingSubjectId: string,
  request: TransactionWriteRequest,
): Promise<TransactionMutation> {
  const account = await resolveAccount(deps, budgetSpaceId, request.accountId);
  const period = assignPeriod(await deps.repository.listPeriods(budgetSpaceId), request.budgetDate);
  assertAllocationsSum(request.amountMinorUnits, request.allocations);
  await assertCategoriesInScope(deps, budgetSpaceId, request.allocations);
  const now = deps.clock.now();
  const snapshot = buildSnapshot(deps, { transactionId: deps.ids.uuid(), revision: 1 }, budgetSpaceId, account, period, request, actingSubjectId, now);
  await deps.repository.appendVersion(snapshot.version, snapshot.allocations, null);
  return { previous: null, current: snapshot };
}

async function currentSnapshot(deps: TransactionsDependencies, budgetSpaceId: string, transactionId: string): Promise<TransactionSnapshot> {
  if (!isUuid(transactionId)) throw new TransactionError("invalid_request", "transactionId");
  const versions = await deps.repository.listVersions(budgetSpaceId, transactionId);
  const current = versions.find((version) => version.supersededAt === null);
  if (current === undefined) throw new TransactionError("transaction_not_found", "transactionId");
  return { version: current, allocations: await deps.repository.listAllocations(budgetSpaceId, current.transactionVersionId) };
}

/**
 * Replace the current version with a new one (CBD-200-AC02, CBD-201-AC04).
 *
 * The prior financial effect is removed and the new allocation set applied
 * exactly once, because the effect *is* the current version's allocation set
 * and there is only ever one current version. The replaced version keeps its
 * identifiers, its allocations and its provenance, so the before/after pair
 * this returns is also on disk.
 */
export async function editManualTransaction(
  deps: TransactionsDependencies,
  budgetSpaceId: string,
  transactionId: string,
  actingSubjectId: string,
  request: TransactionWriteRequest,
  precondition: VersionPrecondition | null = null,
): Promise<TransactionMutation> {
  const previous = await currentSnapshot(deps, budgetSpaceId, transactionId);
  // The basis is compared before anything else about the current version is
  // judged: a client holding a pre-removal view learns it is stale, which is
  // the reload-and-retry result, rather than a bare `transaction_removed`.
  assertCurrentBasis(previous.version, precondition);
  if (previous.version.removedAt !== null) throw new TransactionError("transaction_removed", "transactionId");
  const account = await resolveAccount(deps, budgetSpaceId, request.accountId);
  const period = assignPeriod(await deps.repository.listPeriods(budgetSpaceId), request.budgetDate);
  assertAllocationsSum(request.amountMinorUnits, request.allocations);
  await assertCategoriesInScope(deps, budgetSpaceId, request.allocations);
  const now = deps.clock.now();
  const snapshot = buildSnapshot(deps, { transactionId, revision: previous.version.revision + 1 }, budgetSpaceId, account, period, request, actingSubjectId, now);
  await deps.repository.appendVersion(snapshot.version, snapshot.allocations, { transactionVersionId: previous.version.transactionVersionId, supersededAt: now });
  return { previous, current: snapshot };
}

/**
 * Remove a transaction as a tombstone version (CBD-200-AC03).
 *
 * The tombstone carries no allocations, which is what "no financial effect"
 * means here: progress stops counting it because there is nothing itemized to
 * count, not because a filter remembered to exclude it. Every earlier version
 * and its allocations are retained.
 */
export async function removeManualTransaction(
  deps: TransactionsDependencies,
  budgetSpaceId: string,
  transactionId: string,
  actingSubjectId: string,
  precondition: VersionPrecondition | null = null,
): Promise<TransactionMutation> {
  const previous = await currentSnapshot(deps, budgetSpaceId, transactionId);
  assertCurrentBasis(previous.version, precondition);
  if (previous.version.removedAt !== null) throw new TransactionError("transaction_removed", "transactionId");
  const now = deps.clock.now();
  const version: TransactionRecord = {
    ...previous.version,
    transactionVersionId: deps.ids.uuid(),
    revision: previous.version.revision + 1,
    removedAt: now,
    removedBySubjectId: actingSubjectId,
    supersededAt: null,
    createdAt: now,
  };
  await deps.repository.appendVersion(version, [], { transactionVersionId: previous.version.transactionVersionId, supersededAt: now });
  return { previous, current: { version, allocations: [] } };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every version of one identity with its allocations, oldest revision first: the ordered audit trail (CBD-201-AC04). */
export async function readTransactionHistory(deps: TransactionsDependencies, budgetSpaceId: string, transactionId: string): Promise<readonly TransactionSnapshot[]> {
  if (!isUuid(transactionId)) throw new TransactionError("invalid_request", "transactionId");
  const versions = [...await deps.repository.listVersions(budgetSpaceId, transactionId)]
    .sort((a, b) => a.revision - b.revision || compareTransactionIds(a.transactionVersionId, b.transactionVersionId));
  if (versions.length === 0) throw new TransactionError("transaction_not_found", "transactionId");
  const snapshots: TransactionSnapshot[] = [];
  for (const version of versions) {
    snapshots.push({ version, allocations: await deps.repository.listAllocations(budgetSpaceId, version.transactionVersionId) });
  }
  return snapshots;
}

export interface ProgressTarget {
  readonly categoryId: string;
  readonly targetMinorUnits: number;
}

export interface ProgressQuery {
  readonly periodId: string;
  /** The cells to answer for. A category with no stored target is asked for with a target of zero. */
  readonly targets: readonly ProgressTarget[];
}

/**
 * Budget progress for one period and a category set (CBD-209).
 *
 * Every itemized record is one `transaction_allocation` of a current,
 * non-removed version, carrying the allocation's own identity so the detail
 * set the calculator returns points back at real rows. Superseded versions
 * and tombstones never reach the calculator at all, which is the persistence
 * half of "an excluded item appears in neither aggregate nor detail".
 */
export async function readBudgetProgress(deps: TransactionsDependencies, budgetSpaceId: string, query: ProgressQuery): Promise<ProgressResult> {
  if (!isUuid(query.periodId)) throw new TransactionError("invalid_request", "periodId");
  const period = (await deps.repository.listPeriods(budgetSpaceId)).find((candidate) => candidate.periodId === query.periodId);
  if (period === undefined) throw new TransactionError("period_not_found", "periodId");
  const ledger = await deps.repository.readPeriodLedger(budgetSpaceId, query.periodId);
  const records: ProgressRecord[] = [];
  for (const snapshot of ledger) {
    if (snapshot.version.supersededAt !== null || snapshot.version.removedAt !== null) continue;
    for (const allocation of snapshot.allocations) {
      records.push({
        recordId: allocation.allocationId,
        categoryId: allocation.categoryId,
        periodId: snapshot.version.periodId,
        // CBD-107's vocabulary: this increment produces settled facts only.
        settlement: snapshot.version.settlementState === SETTLED_STATE ? "settled" : "pending",
        amountMinorUnits: allocation.amountMinorUnits,
      });
    }
  }
  const input: ProgressInput = {
    cells: query.targets.map((target) => ({ categoryId: target.categoryId, periodId: query.periodId, targetMinorUnits: target.targetMinorUnits })),
    records,
  };
  return calculateBudgetProgress(input);
}
