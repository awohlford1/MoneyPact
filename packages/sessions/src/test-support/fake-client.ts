/**
 * An in-memory `DataAccessClient` double for this package's unit tests.
 *
 * Unit tests exercise `store.ts`'s CAS/select/insert/update logic against
 * this fake rather than a live PostgreSQL instance, so `npm run test`
 * (which `npm run check` runs with no database available -- CI's workflow
 * contract in `scripts/check-ci-contract.mjs` forbids a `services:` block)
 * never depends on Docker. The packet's live-database proof
 * (`db:reset`/`db:migrate`/`db:verify`) is run manually against Docker
 * Desktop and reported separately in the final report; it is not part of
 * this automated suite.
 *
 * This fake reimplements just enough of `tenant.ts`'s condition/returning
 * semantics (AND-only equality/comparison conditions, literal `set`/`values`,
 * `returning` on insert only) to exercise `store.ts` faithfully, including
 * its optimistic-CAS retry paths.
 */
import type { Condition, DataAccessClient, QueryResult } from "@cobudget/data-access";
import type {
  PlatformDeleteQuery,
  PlatformInsertQuery,
  PlatformSelectQuery,
  PlatformUpdateQuery,
  TenantDeleteQuery,
  TenantInsertQuery,
  TenantSelectQuery,
  TenantUpdateQuery,
} from "@cobudget/data-access";

type Row = Record<string, unknown>;

function matches(row: Row, conditions: readonly Condition[] | undefined): boolean {
  if (!conditions) return true;
  return conditions.every((condition) => {
    const value = row[condition.column];
    const operator = condition.operator ?? "=";
    switch (operator) {
      case "=":
        return value === condition.value;
      case "<>":
        return value !== condition.value;
      case "<":
        return (value as any) < (condition.value as any);
      case "<=":
        return (value as any) <= (condition.value as any);
      case ">":
        return (value as any) > (condition.value as any);
      case ">=":
        return (value as any) >= (condition.value as any);
      default:
        return false;
    }
  });
}

export class FakeUniqueViolationError extends Error {
  constructor(table: string, column: string) {
    super(`duplicate value for unique column "${column}" on "${table}"`);
    this.name = "FakeUniqueViolationError";
  }
}

export interface FakeTableConfig {
  readonly uniqueColumns?: readonly (string | readonly string[])[];
}

export class FakeDataAccessDatabase {
  readonly tables = new Map<string, Row[]>();
  readonly #uniques = new Map<string, readonly (string | readonly string[])[]>();

  configureTable(table: string, config: FakeTableConfig): void {
    this.#uniques.set(table, config.uniqueColumns ?? []);
    if (!this.tables.has(table)) this.tables.set(table, []);
  }

  #rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  #assertUnique(table: string, candidate: Row, excludeSelf?: Row): void {
    const uniques = this.#uniques.get(table) ?? [];
    for (const spec of uniques) {
      const columns = typeof spec === "string" ? [spec] : spec;
      const conflict = this.#rows(table).some(
        (row) => row !== excludeSelf && columns.every((column) => row[column] === candidate[column]),
      );
      if (conflict) throw new FakeUniqueViolationError(table, columns.join(","));
    }
  }

  select(table: string, conditions: readonly Condition[] | undefined, columns: readonly string[] | undefined): QueryResult {
    const rows = this.#rows(table).filter((row) => matches(row, conditions));
    const projected = columns && !columns.includes("*") ? rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))) : rows.map((row) => ({ ...row }));
    return { rows: projected, rowCount: projected.length } as QueryResult;
  }

  insert(table: string, values: Row, returning: readonly string[] | undefined): QueryResult {
    const row: Row = { ...values };
    this.#assertUnique(table, row);
    this.#rows(table).push(row);
    const returned = returning && !returning.includes("*") ? Object.fromEntries(returning.map((c) => [c, row[c]])) : { ...row };
    return { rows: [returned], rowCount: 1 } as QueryResult;
  }

  update(table: string, set: Row, conditions: readonly Condition[] | undefined): QueryResult {
    const affected = this.#rows(table).filter((row) => matches(row, conditions));
    for (const row of affected) {
      const candidate = { ...row, ...set };
      this.#assertUnique(table, candidate, row);
      Object.assign(row, set);
    }
    return { rows: [], rowCount: affected.length } as unknown as QueryResult;
  }

  delete(table: string, conditions: readonly Condition[] | undefined): QueryResult {
    const rows = this.#rows(table);
    const remaining = rows.filter((row) => !matches(row, conditions));
    const removed = rows.length - remaining.length;
    this.tables.set(table, remaining);
    return { rows: [], rowCount: removed } as unknown as QueryResult;
  }
}

export function createFakeClient(db: FakeDataAccessDatabase): DataAccessClient {
  const client: DataAccessClient = {
    // The fake has no connection to scope: work runs against the same tables and
    // is not rolled back on throw. Sessions tests prove ordering and CAS, not
    // isolation; the live proofs run against PostgreSQL.
    transaction: (_options, work) => work(client),
    tenantSelect: (_q: TenantSelectQuery) => Promise.reject(new Error("not implemented in fake")),
    tenantInsert: (_q: TenantInsertQuery) => Promise.reject(new Error("not implemented in fake")),
    tenantUpdate: (_q: TenantUpdateQuery) => Promise.reject(new Error("not implemented in fake")),
    tenantDelete: (_q: TenantDeleteQuery) => Promise.reject(new Error("not implemented in fake")),
    platformSelect: (query: PlatformSelectQuery) => Promise.resolve(db.select(query.table, query.conditions, query.columns)),
    platformInsert: (query: PlatformInsertQuery) => Promise.resolve(db.insert(query.table, query.values as Row, query.returning)),
    platformUpdate: (query: PlatformUpdateQuery) => Promise.resolve(db.update(query.table, query.set as Row, query.conditions)),
    platformDelete: (query: PlatformDeleteQuery) => Promise.resolve(db.delete(query.table, query.conditions)),
  };
  return client;
}

export function createTestDatabase(): FakeDataAccessDatabase {
  const db = new FakeDataAccessDatabase();
  db.configureTable("account_subject_authority", { uniqueColumns: ["account_subject_id"] });
  db.configureTable("account_session", { uniqueColumns: ["session_selector", "session_ref", ["account_subject_id", "session_version"]] });
  db.configureTable("session_delivery_result", { uniqueColumns: ["session_handoff_id", "session_ref"] });
  db.configureTable("provider_security_event", { uniqueColumns: [["environment_id", "issuer", "provider_event_id"]] });
  db.configureTable("revocation_outbox", { uniqueColumns: [] });
  return db;
}
