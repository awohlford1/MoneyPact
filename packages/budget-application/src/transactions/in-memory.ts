/**
 * In-memory `TransactionsRepository` for unit and (later) route tests.
 *
 * It mirrors 20260914T180001Z and 20260914T180002Z closely enough that the
 * commands' error mapping is exercised without a database: one current
 * version per identity, a superseded version is history and cannot change, a
 * tombstone carries no allocations, allocations are immutable, and the
 * exact-sum rule is checked at the end of the append the way the deferred
 * constraint trigger checks it at commit. Every read and write is keyed on
 * the budget space first, so a transaction of one space is unreachable
 * through another space's identifier.
 */
import type { AccountRecord } from "../accounts/records.ts";
import type { Supersession, TransactionsRepository } from "./ports.ts";
import { SETTLED_STATE, MANUAL_TRANSACTION_ORIGIN, TransactionError } from "./records.ts";
import type { AllocationRecord, CategorySummary, PeriodRecord, TransactionRecord, TransactionSnapshot } from "./records.ts";

function key(budgetSpaceId: string, id: string): string {
  return `${budgetSpaceId}|${id}`;
}

export class InMemoryTransactionsRepository implements TransactionsRepository {
  readonly periods = new Map<string, PeriodRecord>();
  readonly accounts = new Map<string, AccountRecord>();
  readonly categories = new Map<string, CategorySummary>();
  readonly versions = new Map<string, TransactionRecord>();
  readonly allocations = new Map<string, AllocationRecord>();

  seedPeriod(period: PeriodRecord): void {
    this.periods.set(key(period.budgetSpaceId, period.periodId), structuredClone(period));
  }

  seedAccount(account: AccountRecord): void {
    this.accounts.set(key(account.budgetSpaceId, account.accountId), structuredClone(account));
  }

  seedCategory(category: CategorySummary): void {
    this.categories.set(key(category.budgetSpaceId, category.categoryId), structuredClone(category));
  }

  async listPeriods(budgetSpaceId: string): Promise<readonly PeriodRecord[]> {
    return [...this.periods.values()].filter((p) => p.budgetSpaceId === budgetSpaceId).map((p) => structuredClone(p));
  }

  async readAccount(budgetSpaceId: string, accountId: string): Promise<AccountRecord | null> {
    return structuredClone(this.accounts.get(key(budgetSpaceId, accountId)) ?? null);
  }

  async listCategories(budgetSpaceId: string): Promise<readonly CategorySummary[]> {
    return [...this.categories.values()].filter((c) => c.budgetSpaceId === budgetSpaceId).map((c) => structuredClone(c));
  }

  async listVersions(budgetSpaceId: string, transactionId: string): Promise<readonly TransactionRecord[]> {
    return [...this.versions.values()]
      .filter((v) => v.budgetSpaceId === budgetSpaceId && v.transactionId === transactionId)
      .map((v) => structuredClone(v));
  }

  async listAllocations(budgetSpaceId: string, transactionVersionId: string): Promise<readonly AllocationRecord[]> {
    return [...this.allocations.values()]
      .filter((a) => a.budgetSpaceId === budgetSpaceId && a.transactionVersionId === transactionVersionId)
      .map((a) => structuredClone(a));
  }

  async readPeriodLedger(budgetSpaceId: string, periodId: string): Promise<readonly TransactionSnapshot[]> {
    const current = [...this.versions.values()].filter(
      (v) => v.budgetSpaceId === budgetSpaceId && v.periodId === periodId && v.supersededAt === null && v.removedAt === null,
    );
    const snapshots: TransactionSnapshot[] = [];
    for (const version of current) {
      snapshots.push({ version: structuredClone(version), allocations: await this.listAllocations(budgetSpaceId, version.transactionVersionId) });
    }
    return snapshots;
  }

  async appendVersion(version: TransactionRecord, allocations: readonly AllocationRecord[], supersedes: Supersession | null): Promise<void> {
    this.#assertStorable(version, allocations);
    if (supersedes !== null) {
      const superseded = this.versions.get(key(version.budgetSpaceId, supersedes.transactionVersionId));
      if (superseded === undefined) throw new TransactionError("transaction_not_found", "transactionVersionId");
      if (superseded.supersededAt !== null) throw new TransactionError("conflict", "supersededAt");
      // manual_transaction_check1: a supersession stamp is never earlier than
      // the version it closes. The database compares the application's stamp
      // with the row's created_at, so a stored row whose created_at came from
      // a different clock than the command's is refused here as it is there.
      if (Date.parse(supersedes.supersededAt) < Date.parse(superseded.createdAt)) throw new TransactionError("constraint_violation", "superseded_at");
      this.versions.set(key(version.budgetSpaceId, superseded.transactionVersionId), { ...superseded, supersededAt: supersedes.supersededAt });
    }
    for (const existing of this.versions.values()) {
      if (existing.budgetSpaceId === version.budgetSpaceId && existing.transactionId === version.transactionId && existing.supersededAt === null) {
        throw new TransactionError("conflict", "one_current");
      }
      if (existing.budgetSpaceId === version.budgetSpaceId && existing.transactionId === version.transactionId && existing.revision === version.revision) {
        throw new TransactionError("conflict", "revision");
      }
    }
    this.versions.set(key(version.budgetSpaceId, version.transactionVersionId), structuredClone(version));
    for (const allocation of allocations) {
      this.allocations.set(key(allocation.budgetSpaceId, allocation.allocationId), structuredClone(allocation));
    }
  }

  #assertStorable(version: TransactionRecord, allocations: readonly AllocationRecord[]): void {
    if (version.origin !== MANUAL_TRANSACTION_ORIGIN || version.settlementState !== SETTLED_STATE) {
      throw new TransactionError("constraint_violation", "origin");
    }
    if (!Number.isSafeInteger(version.amountMinorUnits)) throw new TransactionError("constraint_violation", "amount_minor_units");
    const account = this.accounts.get(key(version.budgetSpaceId, version.accountId));
    if (account === undefined) throw new TransactionError("constraint_violation", "account_id");
    if (account.currencyCode !== version.currencyCode || account.minorUnitPrecision !== version.minorUnitPrecision) {
      throw new TransactionError("currency_mismatch", "currency_code");
    }
    const period = this.periods.get(key(version.budgetSpaceId, version.periodId));
    if (period === undefined || period.periodStart !== version.periodStart || period.periodEnd !== version.periodEnd) {
      throw new TransactionError("constraint_violation", "period_id");
    }
    if (version.budgetDate < version.periodStart || version.budgetDate > version.periodEnd) {
      throw new TransactionError("constraint_violation", "budget_date");
    }
    if ((version.removedAt === null) !== (version.removedBySubjectId === null)) throw new TransactionError("constraint_violation", "removed_at");
    // manual_transaction_check2: a tombstone is removed no earlier than it was created.
    if (version.removedAt !== null && Date.parse(version.removedAt) < Date.parse(version.createdAt)) throw new TransactionError("constraint_violation", "removed_at");
    // The deferred exact-sum constraint, restated.
    if (version.removedAt !== null) {
      if (allocations.length !== 0) throw new TransactionError("constraint_violation", "allocations");
      return;
    }
    if (allocations.length === 0) throw new TransactionError("constraint_violation", "allocations");
    const categories = new Set<string>();
    let total = 0;
    for (const allocation of allocations) {
      if (allocation.transactionVersionId !== version.transactionVersionId || allocation.budgetSpaceId !== version.budgetSpaceId) {
        throw new TransactionError("constraint_violation", "transaction_version_id");
      }
      if (categories.has(allocation.categoryId)) throw new TransactionError("constraint_violation", "category_id");
      categories.add(allocation.categoryId);
      if (!this.categories.has(key(version.budgetSpaceId, allocation.categoryId))) throw new TransactionError("constraint_violation", "category_id");
      if (allocation.currencyCode !== version.currencyCode || allocation.minorUnitPrecision !== version.minorUnitPrecision) {
        throw new TransactionError("constraint_violation", "currency_code");
      }
      if (!Number.isSafeInteger(allocation.amountMinorUnits)) throw new TransactionError("constraint_violation", "amount_minor_units");
      total += allocation.amountMinorUnits;
    }
    if (total !== version.amountMinorUnits) throw new TransactionError("constraint_violation", "allocation_sum");
  }
}
