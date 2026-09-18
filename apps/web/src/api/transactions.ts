/**
 * UI-P03 (CBD-202): the transactions client, following the precedent `reports.ts` set (UI-P04, section 3.2): a
 * new surface gets its own client module, never an extension of `ApiClient` in `client.ts`. Writes reuse the
 * existing `ApiClient` (`recordExpense`/`editExpense`/`removeExpense`, already in `client.ts`); this module
 * adds exactly the one new read the plan names.
 *
 * No arithmetic on money here beyond `formatMinorUnits`/`directionOf`, already `client.ts`'s own helpers
 * (CBD-202 section 6.3 item 1): every figure is the API's own value, passed through once.
 */
import { ApiError, directionOf, formatMinorUnits } from "./client.ts";
import type { AmountDirection } from "./client.ts";

// ---------------------------------------------------------------------------
// Wire shape -- UI-BUILD-PLAN.md section 4.3, verbatim.
// ---------------------------------------------------------------------------

export interface WireTransaction {
  transactionId: string; transactionVersionId: string; revision: number;
  accountId: string; amountMinorUnits: number; budgetDate: string; description: string | null;
  allocations: readonly { categoryId: string; amountMinorUnits: number }[];
  removedAt: string | null;
}
export interface WireTransactionsList {
  budgetSpaceId: string; periodId: string; currencyCode: string; minorUnitPrecision: number;
  transactions: readonly WireTransaction[];
}

// ---------------------------------------------------------------------------
// Presentation: every figure formatted once, here, from the API's own field. The view renders strings only.
// ---------------------------------------------------------------------------

export interface AllocationRow { categoryId: string; amount: string; direction: AmountDirection }
export interface TransactionRow {
  transactionId: string; transactionVersionId: string; revision: number;
  accountId: string; budgetDate: string; description: string | null;
  amount: string; direction: AmountDirection;
  allocations: readonly AllocationRow[];
  removed: boolean;
}

export function toTransactionRow(wire: WireTransaction, precision: number): TransactionRow {
  return {
    transactionId: wire.transactionId, transactionVersionId: wire.transactionVersionId, revision: wire.revision,
    accountId: wire.accountId, budgetDate: wire.budgetDate, description: wire.description,
    amount: formatMinorUnits(Math.abs(wire.amountMinorUnits), precision),
    direction: directionOf(wire.amountMinorUnits),
    allocations: wire.allocations.map(allocation => ({
      categoryId: allocation.categoryId,
      amount: formatMinorUnits(Math.abs(allocation.amountMinorUnits), precision),
      direction: directionOf(allocation.amountMinorUnits),
    })),
    removed: wire.removedAt !== null,
  };
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export interface TransactionsList {
  budgetSpaceId: string; periodId: string; currencyCode: string; minorUnitPrecision: number;
  transactions: readonly TransactionRow[];
}

export interface TransactionsClient {
  list(budgetSpaceId: string, periodId: string, signal?: AbortSignal): Promise<TransactionsList>;
}

export function createTransactionsClient(base = "/v1", fetcher: typeof fetch = fetch): TransactionsClient {
  return {
    async list(budgetSpaceId, periodId, signal) {
      const response = await fetcher(`${base}/budget-spaces/${encodeURIComponent(budgetSpaceId)}/transactions?periodId=${encodeURIComponent(periodId)}`, {
        method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store",
        ...(signal ? { signal } : {}),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new ApiError(response.status, typeof body.error === "string" ? body.error : "request_failed");
      const wire = body as unknown as WireTransactionsList;
      return {
        budgetSpaceId: wire.budgetSpaceId, periodId: wire.periodId, currencyCode: wire.currencyCode, minorUnitPrecision: wire.minorUnitPrecision,
        transactions: wire.transactions.map(transaction => toTransactionRow(transaction, wire.minorUnitPrecision)),
      };
    },
  };
}
