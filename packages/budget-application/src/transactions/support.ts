/** Deterministic fixtures shared by this module's tests and (later) apps/api's route tests. */
import type { AccountRecord } from "../accounts/records.ts";
import { InMemoryTransactionsRepository } from "./in-memory.ts";
import type { TransactionsDependencies } from "./application.ts";

export const TX_SPACE_A = "11111111-1111-4111-8111-111111111111";
export const TX_SPACE_B = "22222222-2222-4222-8222-222222222222";
export const TX_SUBJECT_1 = "33333333-3333-4333-8333-333333333333";
export const TX_ACCOUNT_A = "77777777-7777-4777-8777-777777777771";
export const TX_ACCOUNT_ARCHIVED = "77777777-7777-4777-8777-777777777772";
export const TX_ACCOUNT_B = "77777777-7777-4777-8777-777777777773";
export const TX_CATEGORY_GROCERIES = "88888888-8888-4888-8888-888888888881";
export const TX_CATEGORY_TRANSPORT = "88888888-8888-4888-8888-888888888882";
export const TX_CATEGORY_ARCHIVED = "88888888-8888-4888-8888-888888888883";
export const TX_PERIOD_SEP = "99999999-9999-4999-8999-999999999991";
export const TX_PERIOD_AUG = "99999999-9999-4999-8999-999999999992";

/** A clock frozen at noon UTC on 2026-09-15. */
export const TX_FIXED_NOW = "2026-09-15T12:00:00.000Z";

export class TransactionSequenceIds {
  #next = 0;
  uuid(): string {
    this.#next += 1;
    return `bbbb0000-0000-4000-8000-${String(this.#next).padStart(12, "0")}`;
  }
}

export function testAccount(overrides: Partial<AccountRecord> & { accountId: string; budgetSpaceId: string }): AccountRecord {
  return {
    origin: "manual",
    accountType: "checking",
    label: `account ${overrides.accountId.slice(-4)}`,
    currencyCode: "USD",
    minorUnitPrecision: 2,
    openingBalanceMinorUnits: 0,
    ownerSubjectId: TX_SUBJECT_1,
    createdBySubjectId: TX_SUBJECT_1,
    archivedAt: null,
    version: 1,
    createdAt: TX_FIXED_NOW,
    updatedAt: TX_FIXED_NOW,
    ...overrides,
  };
}

export interface TransactionWorld {
  readonly repository: InMemoryTransactionsRepository;
  readonly deps: TransactionsDependencies;
  readonly ids: TransactionSequenceIds;
  now: string;
}

/**
 * Two consecutive September/August periods in space A, one live account, one
 * archived account, two live categories and one archived; space B carries its
 * own account and period so cross-budget reachability can be tested.
 */
export function transactionWorld(): TransactionWorld {
  const ids = new TransactionSequenceIds();
  const repository = new InMemoryTransactionsRepository();
  repository.seedPeriod({ periodId: TX_PERIOD_AUG, budgetSpaceId: TX_SPACE_A, status: "planned", periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  repository.seedPeriod({ periodId: TX_PERIOD_SEP, budgetSpaceId: TX_SPACE_A, status: "active", periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  repository.seedAccount(testAccount({ accountId: TX_ACCOUNT_A, budgetSpaceId: TX_SPACE_A }));
  repository.seedAccount(testAccount({ accountId: TX_ACCOUNT_ARCHIVED, budgetSpaceId: TX_SPACE_A, label: "retired", archivedAt: TX_FIXED_NOW, version: 2 }));
  repository.seedAccount(testAccount({ accountId: TX_ACCOUNT_B, budgetSpaceId: TX_SPACE_B }));
  repository.seedCategory({ categoryId: TX_CATEGORY_GROCERIES, budgetSpaceId: TX_SPACE_A, archivedAt: null });
  repository.seedCategory({ categoryId: TX_CATEGORY_TRANSPORT, budgetSpaceId: TX_SPACE_A, archivedAt: null });
  repository.seedCategory({ categoryId: TX_CATEGORY_ARCHIVED, budgetSpaceId: TX_SPACE_A, archivedAt: TX_FIXED_NOW });
  const world: TransactionWorld = { now: TX_FIXED_NOW, ids, repository, deps: undefined as unknown as TransactionsDependencies };
  return Object.assign(world, { deps: { repository, clock: { now: () => world.now }, ids } });
}

/** A create/edit body with sensible defaults: one groceries expense of -1250 on 15 September. */
export function writeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountId: TX_ACCOUNT_A,
    amountMinorUnits: -1_250,
    budgetDate: "2026-09-15",
    description: "Corner shop",
    allocations: [{ categoryId: TX_CATEGORY_GROCERIES, amountMinorUnits: -1_250 }],
    ...overrides,
  };
}
