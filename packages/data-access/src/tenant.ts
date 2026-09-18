/**
 * The tenant-scoped and platform statement APIs (CBD-246-AC02).
 *
 * CBD246-SECURITY-001 finding 1 and CBD246-REVIEW-001's matching AC02/AC03
 * findings: an earlier version of this file let a caller supply raw SQL
 * `text`. `budgetSpaceId` was required, but nothing forced the statement's
 * `WHERE` clause to actually filter on it -- a caller (or a bug) could bind
 * `budgetSpaceId` as `$1` and never reference it, and a platform statement
 * could reach a budget-space table just as easily as a real platform table.
 *
 * This version removes raw SQL entirely from both statement APIs. Every
 * function here takes a structured query -- a table, a closed set of
 * columns, and values that always travel as bound parameters, never as
 * interpolated text -- and builds the SQL itself. `budget_space_id = $1` is
 * appended to every tenant statement by this module, not requested by the
 * caller; `budgetSpaceId` cannot be set through `values`/`set`/`conditions`
 * (that is a reserved column, see `assertNotReservedColumn`), so there is no
 * way to override it from the query object. `table` is checked against
 * `catalog.ts`'s closed catalog before anything is built: a tenant function
 * refuses any table not classified `budget-space`, and a platform function
 * refuses any table not classified `identity` or `platform` (financial-profile
 * has its own subject-scoped seam). Every execution passes through `logging.ts`'s
 * `wrapDriverError`, so a rejected query never reaches a caller with the
 * driver's own message, which can echo statement text or bound values.
 */
import type { Pool, QueryResult } from "./driver.ts";
import { wrapDriverError } from "./logging.ts";
import type { TableCatalog } from "./catalog.ts";
import { PRODUCTION_TABLE_CATALOG, isPlatformTable, isTenantTable } from "./catalog.ts";

export class MissingBudgetSpaceError extends Error {
  constructor(table: string) {
    super(
      `tenant-scoped statement on "${table}" is missing budgetSpaceId (CBD-246-AC02); `
        + "every budget-space-classified table is read through a tenant statement with an explicit budgetSpaceId.",
    );
    this.name = "MissingBudgetSpaceError";
  }
}

export class UnknownTenantTableError extends Error {
  constructor(table: string) {
    super(`"${table}" is not classified "budget-space" in the closed table catalog (CBD-246-AC02); a tenant statement refuses any table it has not vetted.`);
    this.name = "UnknownTenantTableError";
  }
}

export class UnknownPlatformTableError extends Error {
  constructor(table: string) {
    super(`"${table}" is not classified "identity" or "platform" in the closed table catalog (CBD-246-AC02); a platform statement refuses any table it has not vetted, including every budget-space table.`);
    this.name = "UnknownPlatformTableError";
  }
}

export class InvalidIdentifierError extends Error {
  constructor(kind: string, value: string) {
    super(`${kind} "${value}" is not a valid lowercase SQL identifier; identifiers are never accepted from unvalidated caller input.`);
    this.name = "InvalidIdentifierError";
  }
}

export class ReservedColumnError extends Error {
  constructor(column: string) {
    super(`"${column}" is a reserved column and cannot be set through values/set/conditions; it is controlled only by the statement's own budgetSpaceId or table classification.`);
    this.name = "ReservedColumnError";
  }
}

const BUDGET_SPACE_COLUMN = "budget_space_id";
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function assertIdentifier(kind: string, value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new InvalidIdentifierError(kind, value);
  return value;
}

function assertSelectColumn(value: string): string {
  return value === "*" ? value : assertIdentifier("column", value);
}

function assertNotReservedColumn(column: string): void {
  if (column === BUDGET_SPACE_COLUMN) throw new ReservedColumnError(column);
}

export type ComparisonOperator = "=" | "<>" | "<" | "<=" | ">" | ">=";
const COMPARISON_OPERATORS: readonly ComparisonOperator[] = ["=", "<>", "<", "<=", ">", ">="];

export interface Condition {
  readonly column: string;
  readonly operator?: ComparisonOperator;
  readonly value: unknown;
}

/** Appends each condition as `column op $n` to `params`, returning the SQL fragment (empty string if there are none), prefixed with ` and `. */
function buildConditions(conditions: readonly Condition[] | undefined, params: unknown[]): string {
  if (!conditions || conditions.length === 0) return "";
  const clauses: string[] = [];
  for (const condition of conditions) {
    assertNotReservedColumn(condition.column);
    const column = assertIdentifier("column", condition.column);
    const operator = condition.operator ?? "=";
    if (!COMPARISON_OPERATORS.includes(operator)) {
      throw new InvalidIdentifierError("operator", operator);
    }
    params.push(condition.value);
    clauses.push(`${column} ${operator} $${params.length}`);
  }
  return ` and ${clauses.join(" and ")}`;
}

async function execute(pool: Pick<Pool, "query">, table: string, operation: string, text: string, params: readonly unknown[]): Promise<QueryResult> {
  try {
    return await pool.query(text, params as unknown[]);
  } catch (error) {
    // Preserve only the validated SQLSTATE; discard message and cause.
    throw wrapDriverError(table, operation, error);
  }
}

function assertTenantTable(catalog: TableCatalog, table: string): string {
  const identifier = assertIdentifier("table", table);
  if (!isTenantTable(catalog, identifier)) throw new UnknownTenantTableError(identifier);
  return identifier;
}

function assertPlatformTable(catalog: TableCatalog, table: string): string {
  const identifier = assertIdentifier("table", table);
  if (!isPlatformTable(catalog, identifier)) throw new UnknownPlatformTableError(identifier);
  return identifier;
}

function assertBudgetSpaceId(table: string, budgetSpaceId: string): void {
  if (isBlank(budgetSpaceId)) throw new MissingBudgetSpaceError(table);
}

// ---------------------------------------------------------------------------
// Tenant-scoped statements. `budget_space_id = $1` is always the first
// predicate; a caller never writes it.
// ---------------------------------------------------------------------------

export interface TenantSelectQuery {
  readonly table: string;
  readonly budgetSpaceId: string;
  readonly columns?: readonly string[];
  readonly conditions?: readonly Condition[];
}

export function tenantSelect(pool: Pick<Pool, "query">, query: TenantSelectQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  const columns = (query.columns ?? ["*"]).map(assertSelectColumn).join(", ");
  const params: unknown[] = [query.budgetSpaceId];
  const extra = buildConditions(query.conditions, params);
  const text = `select ${columns} from ${table} where ${BUDGET_SPACE_COLUMN} = $1${extra}`;
  return execute(pool, table, "select", text, params);
}

export interface TenantInsertQuery {
  readonly table: string;
  readonly budgetSpaceId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly returning?: readonly string[];
}

export function tenantInsert(pool: Pick<Pool, "query">, query: TenantInsertQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  const entries = Object.entries(query.values);
  for (const [column] of entries) {
    assertNotReservedColumn(column);
    assertIdentifier("column", column);
  }
  const columns = [BUDGET_SPACE_COLUMN, ...entries.map(([column]) => column)];
  const params: unknown[] = [query.budgetSpaceId, ...entries.map(([, value]) => value)];
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const returning = query.returning && query.returning.length > 0
    ? ` returning ${query.returning.map(assertSelectColumn).join(", ")}`
    : "";
  const text = `insert into ${table} (${columns.join(", ")}) values (${placeholders})${returning}`;
  return execute(pool, table, "insert", text, params);
}

export interface TenantUpdateQuery {
  readonly table: string;
  readonly budgetSpaceId: string;
  readonly set: Readonly<Record<string, unknown>>;
  readonly conditions?: readonly Condition[];
  /** CBD-191 SC-191-006 / IDLE-E02: not supported on a tenant statement. Accepted on the type only so a
   * caller's mistake is a clear runtime refusal (`SkipLockedNotSupportedError`) rather than a missing property;
   * `tenantUpdate` always throws when this is set. */
  readonly skipLocked?: true;
}

export class SkipLockedNotSupportedError extends Error {
  constructor(table: string) {
    super(`"skipLocked" is not supported on a tenant statement ("${table}"); CBD-191's best-effort idle-expiry slide (SC-191-006) is the only caller of this predicate today and it is always a platform statement -- refusing rather than half-supporting a tenant-scoped skip-locked update.`);
    this.name = "SkipLockedNotSupportedError";
  }
}

export function tenantUpdate(pool: Pick<Pool, "query">, query: TenantUpdateQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  if (query.skipLocked) throw new SkipLockedNotSupportedError(table);
  const entries = Object.entries(query.set);
  if (entries.length === 0) throw new RangeError(`tenant update on "${table}" must set at least one column`);
  const params: unknown[] = [query.budgetSpaceId];
  const assignments = entries.map(([column, value]) => {
    assertNotReservedColumn(column);
    assertIdentifier("column", column);
    params.push(value);
    return `${column} = $${params.length}`;
  });
  const extra = buildConditions(query.conditions, params);
  const text = `update ${table} set ${assignments.join(", ")} where ${BUDGET_SPACE_COLUMN} = $1${extra}`;
  return execute(pool, table, "update", text, params);
}

export interface TenantDeleteQuery {
  readonly table: string;
  readonly budgetSpaceId: string;
  readonly conditions?: readonly Condition[];
}

export function tenantDelete(pool: Pick<Pool, "query">, query: TenantDeleteQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  const params: unknown[] = [query.budgetSpaceId];
  const extra = buildConditions(query.conditions, params);
  const text = `delete from ${table} where ${BUDGET_SPACE_COLUMN} = $1${extra}`;
  return execute(pool, table, "delete", text, params);
}

// ---------------------------------------------------------------------------
// Platform statements: the explicit escape hatch for tables the catalog
// classifies `identity` or `platform`, which carry no budget-space column.
// No tenant identifier is threaded, and every other table -- including
// every budget-space table -- is refused.
// ---------------------------------------------------------------------------

export interface PlatformSelectQuery {
  readonly table: string;
  readonly columns?: readonly string[];
  readonly conditions?: readonly Condition[];
}

export function platformSelect(pool: Pick<Pool, "query">, query: PlatformSelectQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertPlatformTable(catalog, query.table);
  const columns = (query.columns ?? ["*"]).map(assertSelectColumn).join(", ");
  const params: unknown[] = [];
  const extra = buildConditions(query.conditions, params);
  const where = extra ? ` where ${extra.replace(/^ and /u, "")}` : "";
  const text = `select ${columns} from ${table}${where}`;
  return execute(pool, table, "select", text, params);
}

export interface PlatformInsertQuery {
  readonly table: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly returning?: readonly string[];
}

export function platformInsert(pool: Pick<Pool, "query">, query: PlatformInsertQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertPlatformTable(catalog, query.table);
  const entries = Object.entries(query.values);
  if (entries.length === 0) throw new RangeError(`platform insert on "${table}" must set at least one column`);
  for (const [column] of entries) assertIdentifier("column", column);
  const columns = entries.map(([column]) => column);
  const params = entries.map(([, value]) => value);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const returning = query.returning && query.returning.length > 0
    ? ` returning ${query.returning.map(assertSelectColumn).join(", ")}`
    : "";
  const text = `insert into ${table} (${columns.join(", ")}) values (${placeholders})${returning}`;
  return execute(pool, table, "insert", text, params);
}

export interface PlatformUpdateQuery {
  readonly table: string;
  readonly set: Readonly<Record<string, unknown>>;
  readonly conditions?: readonly Condition[];
  /**
   * CBD-191 SC-191-006 / IDLE-E01: renders the update as a best-effort, single-statement slide that updates
   * the row only if it can lock it without waiting -- `and ctid in (select ctid from <table> where <same
   * conditions> for no key update skip locked)`, reusing `buildConditions`'s own rendering (and therefore its
   * bound parameters) for both occurrences so the table assertion and identifier checks apply unchanged and
   * nothing here becomes a second, divergent predicate. Zero rows means the row could not be locked without
   * waiting (held by any conflicting `FOR UPDATE`/`FOR NO KEY UPDATE` holder); that is data, not an error --
   * the caller decides what a skip means. Requires at least one condition: a lock without a predicate would
   * target every row in the table.
   */
  readonly skipLocked?: true;
}

export function platformUpdate(pool: Pick<Pool, "query">, query: PlatformUpdateQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertPlatformTable(catalog, query.table);
  const entries = Object.entries(query.set);
  if (entries.length === 0) throw new RangeError(`platform update on "${table}" must set at least one column`);
  const params: unknown[] = [];
  const assignments = entries.map(([column, value]) => {
    assertIdentifier("column", column);
    params.push(value);
    return `${column} = $${params.length}`;
  });
  const extra = buildConditions(query.conditions, params);
  const conditionSql = extra.replace(/^ and /u, "");
  if (query.skipLocked && !conditionSql) {
    throw new RangeError(`platform update with skipLocked on "${table}" requires at least one condition; a lock without a predicate would target every row`);
  }
  const where = conditionSql ? ` where ${conditionSql}` : "";
  const skipLockedClause = query.skipLocked
    ? ` and ctid in (select ctid from ${table} where ${conditionSql} for no key update skip locked)`
    : "";
  const text = `update ${table} set ${assignments.join(", ")}${where}${skipLockedClause}`;
  return execute(pool, table, "update", text, params);
}

export interface PlatformDeleteQuery {
  readonly table: string;
  readonly conditions?: readonly Condition[];
}

export function platformDelete(pool: Pick<Pool, "query">, query: PlatformDeleteQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertPlatformTable(catalog, query.table);
  const params: unknown[] = [];
  const extra = buildConditions(query.conditions, params);
  const where = extra ? ` where ${extra.replace(/^ and /u, "")}` : "";
  const text = `delete from ${table}${where}`;
  return execute(pool, table, "delete", text, params);
}
