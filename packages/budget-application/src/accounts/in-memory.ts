/**
 * In-memory `AccountsRepository` for unit and (later) route tests.
 *
 * It mirrors 20260914T180000Z closely enough that the commands' error mapping
 * is exercised without a database: the live-label uniqueness index, the
 * identity and currency immutability trigger, and the rule that every update
 * advances `version`. Every read and write is keyed on the budget space
 * first, so an account of one space is unreachable through another space's
 * identifier.
 */
import type { AccountsRepository } from "./ports.ts";
import { AccountError, MAX_MINOR_UNITS, SUPPORTED_MINOR_UNIT_PRECISIONS } from "./records.ts";
import type { AccountRecord } from "./records.ts";

function key(budgetSpaceId: string, accountId: string): string {
  return `${budgetSpaceId}|${accountId}`;
}

function assertStorable(record: AccountRecord): void {
  if (!Number.isSafeInteger(record.openingBalanceMinorUnits) || Math.abs(record.openingBalanceMinorUnits) > MAX_MINOR_UNITS) {
    throw new AccountError("constraint_violation", "opening_balance_minor_units");
  }
  if (!SUPPORTED_MINOR_UNIT_PRECISIONS.includes(record.minorUnitPrecision)) throw new AccountError("constraint_violation", "minor_unit_precision");
  if (record.origin !== "manual") throw new AccountError("constraint_violation", "origin");
  if (record.label.length < 1 || record.label.length > 120) throw new AccountError("constraint_violation", "label");
}

export class InMemoryAccountsRepository implements AccountsRepository {
  readonly accounts = new Map<string, AccountRecord>();

  async listAccounts(budgetSpaceId: string): Promise<readonly AccountRecord[]> {
    return [...this.accounts.values()].filter((a) => a.budgetSpaceId === budgetSpaceId).map((a) => structuredClone(a));
  }

  async readAccount(budgetSpaceId: string, accountId: string): Promise<AccountRecord | null> {
    return structuredClone(this.accounts.get(key(budgetSpaceId, accountId)) ?? null);
  }

  async insertAccount(record: AccountRecord): Promise<void> {
    assertStorable(record);
    const k = key(record.budgetSpaceId, record.accountId);
    if (this.accounts.has(k)) throw new AccountError("conflict", "account_id");
    this.#assertLabelFree(record);
    this.accounts.set(k, structuredClone(record));
  }

  async updateAccount(record: AccountRecord, previousVersion: number): Promise<boolean> {
    assertStorable(record);
    const k = key(record.budgetSpaceId, record.accountId);
    const existing = this.accounts.get(k);
    if (!existing || existing.version !== previousVersion) return false;
    // The migration's trigger, restated: identity, denomination and creation
    // provenance never change, and every update advances the version.
    if (record.version <= previousVersion) throw new AccountError("constraint_violation", "version");
    if (record.currencyCode !== existing.currencyCode || record.minorUnitPrecision !== existing.minorUnitPrecision) throw new AccountError("constraint_violation", "currency_code");
    if (record.origin !== existing.origin || record.createdAt !== existing.createdAt || record.createdBySubjectId !== existing.createdBySubjectId) {
      throw new AccountError("constraint_violation", "provenance");
    }
    this.#assertLabelFree(record);
    this.accounts.set(k, structuredClone(record));
    return true;
  }

  #assertLabelFree(record: AccountRecord): void {
    if (record.archivedAt !== null) return;
    for (const other of this.accounts.values()) {
      if (other.budgetSpaceId === record.budgetSpaceId && other.accountId !== record.accountId && other.archivedAt === null && other.label.toLowerCase() === record.label.toLowerCase()) {
        throw new AccountError("conflict", "label");
      }
    }
  }
}
