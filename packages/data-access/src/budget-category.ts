/**
 * Tenant-scoped statements for `budget_category` (CBD-153, PROTO-TARGETS-001).
 *
 * Every statement here goes through the closed tenant API in `tenant.ts`, so
 * `budget_space_id = $1` is composed by the layer and never by a caller, and
 * every row read back is normalised to the plain JSON-safe shape the
 * application's persistence port expects: identifiers as strings, instants as
 * ISO-8601 strings, never a driver `Date`. Row shapes are named for the
 * table's columns so a reviewer can check them against the migration.
 */
import type { QueryResult } from "./driver.ts";
import type { TenantInsertQuery, TenantSelectQuery, TenantUpdateQuery } from "./tenant.ts";

/** The subset of a data-access client these statements need. */
export interface TenantStatementClient {
  readonly tenantSelect: (query: TenantSelectQuery) => Promise<QueryResult>;
  readonly tenantInsert: (query: TenantInsertQuery) => Promise<QueryResult>;
  readonly tenantUpdate: (query: TenantUpdateQuery) => Promise<QueryResult>;
}

export const BUDGET_CATEGORY_TABLE = "budget_category";

export interface BudgetCategoryRow {
  readonly category_id: string;
  readonly budget_space_id: string;
  readonly label: string;
  readonly position: number;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** PROTO-HARDENING-001 (F-INCB-03): the row's own monotonic version, what CBD-236 SS8.6.1 `resource.version` carries for a category. */
  readonly version: number;
}

export interface BudgetCategoryInsert {
  readonly category_id: string;
  readonly budget_space_id: string;
  readonly label: string;
  readonly position: number;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

export interface BudgetCategoryUpdate {
  readonly label: string;
  readonly position: number;
  readonly archived_at: string | null;
  readonly updated_at: string;
  /** Must be strictly greater than the stored value; the table's trigger refuses an update that does not advance it. */
  readonly version: number;
}

/** `timestamptz` arrives as a driver `Date`; an ISO string is what crosses the port. */
export function instantText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp");
}

export function nullableInstantText(value: unknown): string | null {
  return value === null || value === undefined ? null : instantText(value);
}

/** `date` arrives as a driver `Date` at local midnight; read its calendar parts, never its UTC ones. */
export function dateText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  throw new TypeError("expected a date");
}

export function integerValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new TypeError("expected a safe integer");
  return parsed;
}

export function textValue(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("expected text");
  return value;
}

function toRow(value: unknown): BudgetCategoryRow {
  const row = value as Record<string, unknown>;
  return {
    category_id: textValue(row.category_id),
    budget_space_id: textValue(row.budget_space_id),
    label: textValue(row.label),
    position: integerValue(row.position),
    archived_at: nullableInstantText(row.archived_at),
    created_at: instantText(row.created_at),
    updated_at: instantText(row.updated_at),
    version: integerValue(row.version),
  };
}

export async function listBudgetCategories(client: TenantStatementClient, budgetSpaceId: string): Promise<readonly BudgetCategoryRow[]> {
  const result = await client.tenantSelect({ table: BUDGET_CATEGORY_TABLE, budgetSpaceId });
  return result.rows.map(toRow);
}

export async function insertBudgetCategory(client: TenantStatementClient, row: BudgetCategoryInsert): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: BUDGET_CATEGORY_TABLE, budgetSpaceId: budget_space_id, values });
}

/** Returns the number of rows changed: 0 when the category is not this budget's. */
export async function updateBudgetCategory(client: TenantStatementClient, budgetSpaceId: string, categoryId: string, set: BudgetCategoryUpdate): Promise<number> {
  const result = await client.tenantUpdate({ table: BUDGET_CATEGORY_TABLE, budgetSpaceId, set: { ...set }, conditions: [{ column: "category_id", value: categoryId }] });
  return result.rowCount ?? 0;
}

/** The statement set the application's data-access adapter is composed from. */
export function budgetCategoryStatements(client: TenantStatementClient) {
  return {
    listCategories: (budgetSpaceId: string) => listBudgetCategories(client, budgetSpaceId),
    insertCategory: (row: BudgetCategoryInsert) => insertBudgetCategory(client, row),
    updateCategory: (budgetSpaceId: string, categoryId: string, set: BudgetCategoryUpdate) => updateBudgetCategory(client, budgetSpaceId, categoryId, set),
  };
}
