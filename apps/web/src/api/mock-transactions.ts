/** DEVELOPMENT ONLY (CBD-202; UI-BUILD-PLAN.md section 4.3). Registered in the mock route module registry
 * (`mock-registry.ts`); imported by `mock-server.ts` only, never by browser components.
 *
 * The API has no budget-wide transaction list; it exposes only
 * `GET .../periods/{periodId}/progress/{categoryId}`. CBD-202 asks for an interface over the whole set, so this
 * module stubs exactly the one read the plan names -- `GET /v1/budget-spaces/{id}/transactions?periodId=` --
 * and nothing else. Every field it returns is already a field of `MockVersion` in `mock-server.ts`; this module
 * reads the existing store through the same structural cast `mock-reports.ts` uses on `directory.spaces` (that
 * file's own precedent for reading state a sibling module owns without `mock-server.ts` exporting a type for
 * it, and without editing that file beyond the registry line). It invents no value and no rule of its own:
 * "current version" is the same `supersededAt === null` test `mock-server.ts`'s own `currentVersion` applies,
 * and "in this period" is the same `budgetDate` bound `settledVersions` applies. The wire shape is a candidate
 * for the real API, not a decision -- recorded as a handoff to CBD-32.
 *
 * Mock-fidelity limit, a consequence of "invent no new value" rather than a product choice: like
 * `mock-reports.ts`'s `reports/categories`, this read only ever answers for the budget's one active period
 * (`MockSpace.detail.activePeriod`); a `periodId` for any other period -- past or future -- is `404
 * period_not_found`, because the mock keeps no other period's boundaries to check a date against.
 *
 * Removed transactions are not filtered out here: a removal is a new current version with `removedAt` set
 * (`mock-server.ts`'s `removeTransaction`), and that field travels on the wire so the caller decides whether to
 * show it. `TransactionList` (transactions-view.tsx) excludes a removed row from the active table.
 */
import { ApiError } from "./client.ts";
import type { MockDirectory } from "./mock-invitations.ts";
import { activeMembership } from "./mock-invitations.ts";
import type { MockRouteModule } from "./mock-registry.ts";

// The subset of `mock-server.ts`'s private `MockSpace`/`MockVersion` shape this module reads. Structural, not
// imported -- `mock-server.ts` exports no such type, and this packet does not edit that file beyond the
// registry line in `mock-registry.ts` (the UI-P04 packet's binding correction, followed here).
interface TransactionAllocation { categoryId: string; amountMinorUnits: number }
interface TransactionVersion {
  transactionId: string; transactionVersionId: string; revision: number;
  accountId: string; amountMinorUnits: number; budgetDate: string; description: string | null;
  allocations: readonly TransactionAllocation[]; removedAt: string | null; supersededAt: string | null;
}
interface TransactionsSpace {
  detail: { space: { budgetSpaceId: string; currencyCode: string }; activePeriod: { periodId: string; start: string; end: string } | null };
  versions: readonly TransactionVersion[];
}

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

const noStore = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "content-type": "application/json" } });
}

function transactionsSpaceOf(directory: MockDirectory, accountSubjectId: string, id: string): TransactionsSpace {
  const spaces = directory.spaces as Map<string, TransactionsSpace>;
  const value = spaces.get(id);
  if (!value || !activeMembership(directory, id, accountSubjectId)) throw new ApiError(403, "authorization_denied");
  return value;
}

function handleList(value: TransactionsSpace, periodId: string): WireTransactionsList {
  const period = value.detail.activePeriod;
  if (!period || period.periodId !== periodId) throw new ApiError(404, "period_not_found");
  const transactions = value.versions
    .filter(version => version.supersededAt === null && version.budgetDate >= period.start && version.budgetDate <= period.end)
    .map(version => ({
      transactionId: version.transactionId, transactionVersionId: version.transactionVersionId, revision: version.revision,
      accountId: version.accountId, amountMinorUnits: version.amountMinorUnits, budgetDate: version.budgetDate,
      description: version.description, allocations: version.allocations.map(allocation => ({ ...allocation })),
      removedAt: version.removedAt,
    }))
    .sort((a, b) => a.budgetDate.localeCompare(b.budgetDate) || a.transactionId.localeCompare(b.transactionId));
  return {
    budgetSpaceId: value.detail.space.budgetSpaceId, periodId,
    currencyCode: value.detail.space.currencyCode, minorUnitPrecision: 2,
    transactions,
  };
}

/** CBD-35: one path, `budget-spaces/{id}/transactions` with a query string, GET only; `undefined` for anything
 * else (including the three writes, which `mock-server.ts`'s own existing ladder still owns) so the loop falls
 * through. */
export const handleMockTransactionsRequest: MockRouteModule = async (directory, session, request, path) => {
  if (!(path[0] === "budget-spaces" && path.length === 3 && path[2] === "transactions")) return undefined;
  if (request.method !== "GET") return undefined;
  if (!session) throw new ApiError(403, "authorization_denied");
  try {
    const value = transactionsSpaceOf(directory, session.accountSubjectId, path[1]!);
    const url = new URL(request.url);
    return json(handleList(value, url.searchParams.get("periodId") ?? ""));
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code }, error.status);
    return json({ error: "request_failed" }, 503);
  }
};
