/**
 * Subject-scoped statements for tables classified `financial-profile`.
 *
 * The caller supplies the server-obtained account subject identifier, but
 * never its SQL predicate. This module always binds `account_subject_id` as
 * parameter one and refuses attempts to set or filter that reserved column
 * through the structured query fields.
 */
import type { TableCatalog } from "./catalog.ts";
import { isProfileTable, PRODUCTION_TABLE_CATALOG } from "./catalog.ts";
import type { Pool, QueryResult } from "./driver.ts";
import { wrapDriverError } from "./logging.ts";
import type { ComparisonOperator, Condition } from "./tenant.ts";
import { InvalidIdentifierError } from "./tenant.ts";

const ACCOUNT_SUBJECT_COLUMN = "account_subject_id";
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;
const COMPARISON_OPERATORS: readonly ComparisonOperator[] = ["=", "<>", "<", "<=", ">", ">="];

export class MissingAccountSubjectError extends Error {
  constructor(table: string) {
    super(
      `subject-scoped statement on "${table}" is missing accountSubjectId (SM-212-01); `
        + "every financial-profile-classified table is accessed with an explicit server-obtained accountSubjectId.",
    );
    this.name = "MissingAccountSubjectError";
  }
}

export class UnknownProfileTableError extends Error {
  constructor(table: string) {
    super(`"${table}" is not classified "financial-profile" in the closed table catalog (SM-212-01); a profile statement refuses any table it has not vetted.`);
    this.name = "UnknownProfileTableError";
  }
}

export class ReservedSubjectColumnError extends Error {
  constructor() {
    super(`"${ACCOUNT_SUBJECT_COLUMN}" is reserved and cannot be set through values/set/conditions; it is controlled only by the statement's accountSubjectId.`);
    this.name = "ReservedSubjectColumnError";
  }
}

function assertIdentifier(kind: string, value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new InvalidIdentifierError(kind, value);
  return value;
}

function assertSelectColumn(value: string): string {
  return value === "*" ? value : assertIdentifier("column", value);
}

function assertNotSubjectColumn(column: string): void {
  if (column === ACCOUNT_SUBJECT_COLUMN) throw new ReservedSubjectColumnError();
}

function assertProfileTable(catalog: TableCatalog, table: string): string {
  const identifier = assertIdentifier("table", table);
  if (!isProfileTable(catalog, identifier)) throw new UnknownProfileTableError(identifier);
  return identifier;
}

function assertAccountSubjectId(table: string, accountSubjectId: string): void {
  if (accountSubjectId.trim().length === 0) throw new MissingAccountSubjectError(table);
}

function buildConditions(conditions: readonly Condition[] | undefined, params: unknown[]): string {
  if (!conditions || conditions.length === 0) return "";
  const clauses: string[] = [];
  for (const condition of conditions) {
    assertNotSubjectColumn(condition.column);
    const column = assertIdentifier("column", condition.column);
    const operator = condition.operator ?? "=";
    if (!COMPARISON_OPERATORS.includes(operator)) throw new InvalidIdentifierError("operator", operator);
    params.push(condition.value);
    clauses.push(`${column} ${operator} $${params.length}`);
  }
  return ` and ${clauses.join(" and ")}`;
}

async function execute(pool: Pool, table: string, operation: string, text: string, params: readonly unknown[]): Promise<QueryResult> {
  try {
    return await pool.query(text, params as unknown[]);
  } catch {
    throw wrapDriverError(table, operation);
  }
}

export interface ProfileSelectQuery {
  readonly table: string;
  readonly accountSubjectId: string;
  readonly columns?: readonly string[];
  readonly conditions?: readonly Condition[];
}

export function profileSelect(pool: Pool, query: ProfileSelectQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertProfileTable(catalog, query.table);
  assertAccountSubjectId(table, query.accountSubjectId);
  const columns = (query.columns ?? ["*"]).map(assertSelectColumn).join(", ");
  const params: unknown[] = [query.accountSubjectId];
  const extra = buildConditions(query.conditions, params);
  return execute(pool, table, "select", `select ${columns} from ${table} where ${ACCOUNT_SUBJECT_COLUMN} = $1${extra}`, params);
}

export interface ProfileInsertQuery {
  readonly table: string;
  readonly accountSubjectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly returning?: readonly string[];
}

export function profileInsert(pool: Pool, query: ProfileInsertQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertProfileTable(catalog, query.table);
  assertAccountSubjectId(table, query.accountSubjectId);
  const entries = Object.entries(query.values);
  for (const [column] of entries) {
    assertNotSubjectColumn(column);
    assertIdentifier("column", column);
  }
  const columns = [ACCOUNT_SUBJECT_COLUMN, ...entries.map(([column]) => column)];
  const params: unknown[] = [query.accountSubjectId, ...entries.map(([, value]) => value)];
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const returning = query.returning && query.returning.length > 0
    ? ` returning ${query.returning.map(assertSelectColumn).join(", ")}`
    : "";
  return execute(pool, table, "insert", `insert into ${table} (${columns.join(", ")}) values (${placeholders})${returning}`, params);
}

export interface ProfileUpdateQuery {
  readonly table: string;
  readonly accountSubjectId: string;
  readonly set: Readonly<Record<string, unknown>>;
  readonly conditions?: readonly Condition[];
}

export function profileUpdate(pool: Pool, query: ProfileUpdateQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertProfileTable(catalog, query.table);
  assertAccountSubjectId(table, query.accountSubjectId);
  const entries = Object.entries(query.set);
  if (entries.length === 0) throw new RangeError(`profile update on "${table}" must set at least one column`);
  const params: unknown[] = [query.accountSubjectId];
  const assignments = entries.map(([column, value]) => {
    assertNotSubjectColumn(column);
    assertIdentifier("column", column);
    params.push(value);
    return `${column} = $${params.length}`;
  });
  const extra = buildConditions(query.conditions, params);
  return execute(pool, table, "update", `update ${table} set ${assignments.join(", ")} where ${ACCOUNT_SUBJECT_COLUMN} = $1${extra}`, params);
}

export interface ProfileDeleteQuery {
  readonly table: string;
  readonly accountSubjectId: string;
  readonly conditions?: readonly Condition[];
}

export function profileDelete(pool: Pool, query: ProfileDeleteQuery, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): Promise<QueryResult> {
  const table = assertProfileTable(catalog, query.table);
  assertAccountSubjectId(table, query.accountSubjectId);
  const params: unknown[] = [query.accountSubjectId];
  const extra = buildConditions(query.conditions, params);
  return execute(pool, table, "delete", `delete from ${table} where ${ACCOUNT_SUBJECT_COLUMN} = $1${extra}`, params);
}
