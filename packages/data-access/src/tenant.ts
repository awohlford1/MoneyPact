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
 *
 * CBD-237 (tenant-scoped data-access paths) extends the same seam rather
 * than opening a second one. `tenantSelect` additionally accepts `joins`,
 * `orderBy`, `limit`, and `offset`, and `tenantCount` gives totals a scoped
 * path, so a caller never has to leave this module to list, search, page,
 * total, or join customer rows. Every joined table is vetted against the
 * catalog exactly like the base table, and this module appends
 * `<joined>.budget_space_id = $1` for each one (CBD-237-AC06): a foreign key
 * or join predicate substituted to another space's row simply matches
 * nothing. `limit` and `offset` travel as bound parameters, and `orderBy`
 * names only validated identifiers, so paging can neither widen the
 * predicate nor reach a row outside it (CBD-237-AC05). A column reference
 * may be qualified as `table.column` only when `table` is the statement's
 * own base table or one of its joined tables; `budget_space_id` stays
 * reserved under either spelling.
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

export class UnknownColumnQualifierError extends Error {
  constructor(qualifier: string) {
    super(`"${qualifier}" is not the statement's base table or one of its joined tables (CBD-237-AC06); a qualified column reference can only name a table the statement has itself vetted.`);
    this.name = "UnknownColumnQualifierError";
  }
}

export class InvalidPageBoundError extends Error {
  constructor(kind: string) {
    super(`${kind} must be a non-negative safe integer (CBD-237-AC05); page bounds are validated here and bound as parameters, never interpolated.`);
    this.name = "InvalidPageBoundError";
  }
}

const BUDGET_SPACE_COLUMN = "budget_space_id";
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;
const QUALIFIED_IDENTIFIER_PATTERN = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/u;

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

/**
 * The tables one statement may reference: its base table first, then each
 * joined table in order. Every entry has already passed `assertTenantTable`.
 */
type StatementTables = readonly string[];

/**
 * A column reference in a condition or order term: a plain identifier, or
 * `table.column` where `table` is one the statement has vetted. The reserved
 * column is refused under either spelling, so a join cannot be used to name
 * `budget_space_id` through a qualifier (CBD-237-AC06).
 */
function assertColumnReference(value: string, tables: StatementTables): string {
  const qualified = QUALIFIED_IDENTIFIER_PATTERN.exec(value);
  if (qualified === null) {
    assertNotReservedColumn(value);
    return assertIdentifier("column", value);
  }
  const [, table = "", column = ""] = qualified;
  if (!tables.includes(table)) throw new UnknownColumnQualifierError(table);
  assertNotReservedColumn(column);
  return value;
}

/** A projected column: `*`, a plain identifier, or `table.column` against a vetted table. Projection may name the reserved column; only predicates may not. */
function assertProjectedColumn(value: string, tables: StatementTables): string {
  if (value === "*") return value;
  const qualified = QUALIFIED_IDENTIFIER_PATTERN.exec(value);
  if (qualified === null) return assertIdentifier("column", value);
  const [, table = ""] = qualified;
  if (!tables.includes(table)) throw new UnknownColumnQualifierError(table);
  return value;
}

function assertPageBound(kind: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidPageBoundError(kind);
  return value;
}

export type ComparisonOperator = "=" | "<>" | "<" | "<=" | ">" | ">=";
const COMPARISON_OPERATORS: readonly ComparisonOperator[] = ["=", "<>", "<", "<=", ">", ">="];

export interface Condition {
  readonly column: string;
  readonly operator?: ComparisonOperator;
  readonly value: unknown;
}

export type OrderDirection = "asc" | "desc";
const ORDER_DIRECTIONS: readonly OrderDirection[] = ["asc", "desc"];

export interface OrderTerm {
  readonly column: string;
  readonly direction?: OrderDirection;
}

/**
 * One inner join to another budget-space table (CBD-237-AC06). `on.column`
 * is a column of the joined table; `on.references` is a column of the base
 * table, or `table.column` naming an earlier join. The tenant predicate for
 * the joined table is appended by `buildJoins`, never written by a caller.
 */
export interface TenantJoin {
  readonly table: string;
  readonly on: {
    readonly column: string;
    readonly references: string;
  };
}

/** Appends each condition as `column op $n` to `params`, returning the SQL fragment (empty string if there are none), prefixed with ` and `. */
function buildConditions(conditions: readonly Condition[] | undefined, params: unknown[], tables: StatementTables): string {
  if (!conditions || conditions.length === 0) return "";
  const clauses: string[] = [];
  for (const condition of conditions) {
    const column = assertColumnReference(condition.column, tables);
    const operator = condition.operator ?? "=";
    if (!COMPARISON_OPERATORS.includes(operator)) {
      throw new InvalidIdentifierError("operator", operator);
    }
    params.push(condition.value);
    clauses.push(`${column} ${operator} $${params.length}`);
  }
  return ` and ${clauses.join(" and ")}`;
}

/** ` order by a asc, b desc` over validated references, or the empty string. Direction is a closed set, never caller text. */
function buildOrderBy(orderBy: readonly OrderTerm[] | undefined, tables: StatementTables): string {
  if (!orderBy || orderBy.length === 0) return "";
  const terms = orderBy.map((term) => {
    const column = assertColumnReference(term.column, tables);
    const direction = term.direction ?? "asc";
    if (!ORDER_DIRECTIONS.includes(direction)) throw new InvalidIdentifierError("direction", direction);
    return `${column} ${direction}`;
  });
  return ` order by ${terms.join(", ")}`;
}

/** ` limit $n offset $m` with each bound validated and pushed to `params`, or the empty string. */
function buildPageBounds(query: { readonly limit?: number; readonly offset?: number }, params: unknown[]): string {
  let text = "";
  if (query.limit !== undefined) {
    params.push(assertPageBound("limit", query.limit));
    text += ` limit $${params.length}`;
  }
  if (query.offset !== undefined) {
    params.push(assertPageBound("offset", query.offset));
    text += ` offset $${params.length}`;
  }
  return text;
}

interface JoinedFrom {
  /** The base table followed by every joined table. */
  readonly tables: StatementTables;
  /** `base inner join j on j.col = base.ref ...`. */
  readonly from: string;
  /** `budget_space_id = $1` alone, or `base.budget_space_id = $1 and j.budget_space_id = $1 ...` when joined. */
  readonly scope: string;
}

/**
 * Vets every joined table against the catalog exactly like the base table
 * and composes the tenant predicate for each one. With no joins the
 * predicate is the unqualified `budget_space_id = $1` the single-table
 * statements have always produced.
 */
function buildJoins(catalog: TableCatalog, base: string, joins: readonly TenantJoin[] | undefined): JoinedFrom {
  if (!joins || joins.length === 0) {
    return { tables: [base], from: base, scope: `${BUDGET_SPACE_COLUMN} = $1` };
  }
  const tables: string[] = [base];
  let from = base;
  let scope = `${base}.${BUDGET_SPACE_COLUMN} = $1`;
  for (const join of joins) {
    const table = assertTenantTable(catalog, join.table);
    if (tables.includes(table)) throw new RangeError(`tenant statement on "${base}" joins "${table}" more than once; a table is joined at most once and never aliased`);
    assertNotReservedColumn(join.on.column);
    const column = assertIdentifier("column", join.on.column);
    const references = QUALIFIED_IDENTIFIER_PATTERN.test(join.on.references)
      ? assertColumnReference(join.on.references, tables)
      : `${base}.${assertColumnReference(join.on.references, tables)}`;
    tables.push(table);
    from += ` inner join ${table} on ${table}.${column} = ${references}`;
    scope += ` and ${table}.${BUDGET_SPACE_COLUMN} = $1`;
  }
  return { tables, from, scope };
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
  /** CBD-237-AC06: each joined table is catalog-vetted and tenant-scoped by this module. */
  readonly joins?: readonly TenantJoin[];
  /** CBD-237-AC05: ordering over validated references only. */
  readonly orderBy?: readonly OrderTerm[];
  /** CBD-237-AC05: page bounds, validated and bound as parameters. */
  readonly limit?: number;
  readonly offset?: number;
}

export function tenantSelect(pool: Pick<Pool, "query">, query: TenantSelectQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  const joined = buildJoins(catalog, table, query.joins);
  const columns = (query.columns ?? ["*"]).map((column) => assertProjectedColumn(column, joined.tables)).join(", ");
  const params: unknown[] = [query.budgetSpaceId];
  const extra = buildConditions(query.conditions, params, joined.tables);
  const order = buildOrderBy(query.orderBy, joined.tables);
  const page = buildPageBounds(query, params);
  const text = `select ${columns} from ${joined.from} where ${joined.scope}${extra}${order}${page}`;
  return execute(pool, table, "select", text, params);
}

export interface TenantCountQuery {
  readonly table: string;
  readonly budgetSpaceId: string;
  readonly conditions?: readonly Condition[];
  readonly joins?: readonly TenantJoin[];
}

/**
 * CBD-237-AC05: a total that can only ever count the authorized space's
 * rows. `count(*)` arrives from the driver as a string (`bigint`); the
 * single row is `{ count }`.
 */
export function tenantCount(pool: Pick<Pool, "query">, query: TenantCountQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  const joined = buildJoins(catalog, table, query.joins);
  const params: unknown[] = [query.budgetSpaceId];
  const extra = buildConditions(query.conditions, params, joined.tables);
  const text = `select count(*) as count from ${joined.from} where ${joined.scope}${extra}`;
  return execute(pool, table, "count", text, params);
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
}

export function tenantUpdate(pool: Pick<Pool, "query">, query: TenantUpdateQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertTenantTable(catalog, query.table);
  assertBudgetSpaceId(table, query.budgetSpaceId);
  const entries = Object.entries(query.set);
  if (entries.length === 0) throw new RangeError(`tenant update on "${table}" must set at least one column`);
  const params: unknown[] = [query.budgetSpaceId];
  const assignments = entries.map(([column, value]) => {
    assertNotReservedColumn(column);
    assertIdentifier("column", column);
    params.push(value);
    return `${column} = $${params.length}`;
  });
  const extra = buildConditions(query.conditions, params, [table]);
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
  const extra = buildConditions(query.conditions, params, [table]);
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
  const extra = buildConditions(query.conditions, params, [table]);
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
  const extra = buildConditions(query.conditions, params, [table]);
  const where = extra ? ` where ${extra.replace(/^ and /u, "")}` : "";
  const text = `update ${table} set ${assignments.join(", ")}${where}`;
  return execute(pool, table, "update", text, params);
}

export interface PlatformDeleteQuery {
  readonly table: string;
  readonly conditions?: readonly Condition[];
}

export function platformDelete(pool: Pick<Pool, "query">, query: PlatformDeleteQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertPlatformTable(catalog, query.table);
  const params: unknown[] = [];
  const extra = buildConditions(query.conditions, params, [table]);
  const where = extra ? ` where ${extra.replace(/^ and /u, "")}` : "";
  const text = `delete from ${table}${where}`;
  return execute(pool, table, "delete", text, params);
}
