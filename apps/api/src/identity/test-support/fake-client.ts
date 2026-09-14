/**
 * In-memory `DataAccessClient` double for the identity and session tests in
 * this package. It reimplements just enough of the CBD-246 statement
 * semantics to exercise the mapping protocol faithfully:
 *
 *   - AND-only equality/comparison conditions, literal `set`/`values`,
 *     `returning` on insert, subject-scoped `profile*` statements;
 *   - unique constraints raising `StatementFailedError` with SQLSTATE 23505;
 *   - snapshot transactions: work runs on a private copy, a throw discards
 *     it (ROLLBACK), and a commit after any other commit raises SQLSTATE
 *     40001 the way SERIALIZABLE would, so the whole-transaction retry path
 *     (§5.2) runs in unit tests without PostgreSQL;
 *   - the deferred subject/profile pair invariant at COMMIT (23514), the
 *     same rule the merged migration's constraint trigger enforces;
 *   - injectable failures (`failStatement`) for fault-injection cases.
 *
 * The live-PostgreSQL proof (`mapping.live.test.ts`) runs the same code
 * against Docker; this fake never replaces that evidence.
 */
import { StatementFailedError } from "@cobudget/data-access";
import type { Condition, DataAccessClient, QueryResult } from "@cobudget/data-access";
import type { PlatformDeleteQuery, PlatformInsertQuery, PlatformSelectQuery, PlatformUpdateQuery } from "@cobudget/data-access";
import type { ProfileDeleteQuery, ProfileInsertQuery, ProfileSelectQuery, ProfileUpdateQuery } from "@cobudget/data-access/profile";

type Row = Record<string, unknown>;
type Tables = Map<string, Row[]>;

const UNIQUE: Readonly<Record<string, readonly (readonly string[])[]>> = {
  account_subject: [["account_subject_id"]],
  identity_binding: [["identity_binding_id"], ["environment_id", "issuer", "provider_subject"], ["environment_id", "account_subject_id"]],
  identity_callback: [["challenge_id"], ["environment_id", "replay_digest"]],
  identity_session_handoff: [["session_handoff_id"], ["challenge_id"]],
  financial_profile: [["profile_id"], ["account_subject_id"]],
  account_subject_authority: [["account_subject_id"]],
  account_session: [["session_selector"], ["session_ref"], ["account_subject_id", "session_version"]],
  session_delivery_result: [["session_handoff_id"], ["session_ref"]],
  provider_security_event: [["environment_id", "issuer", "provider_event_id"]],
  revocation_outbox: [],
};

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  return (a as number) < (b as number) ? -1 : 1;
}

function matches(row: Row, conditions: readonly Condition[] | undefined): boolean {
  return (conditions ?? []).every((condition) => {
    const c = compare(row[condition.column], condition.value);
    switch (condition.operator ?? "=") {
      case "=": return c === 0;
      case "<>": return c !== 0;
      case "<": return c < 0;
      case "<=": return c <= 0;
      case ">": return c > 0;
      case ">=": return c >= 0;
      default: return false;
    }
  });
}

function clone(tables: Tables): Tables {
  return new Map([...tables.entries()].map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
}

export class FakeIdentityDatabase {
  tables: Tables = new Map();
  version = 0;
  readonly statements: { readonly table: string; readonly operation: string }[] = [];
  #failures: { table: string; operation: string; sqlState: string; remaining: number }[] = [];

  /** Injects a failure for the next `times` statements matching table/operation ("*" matches any). */
  failStatement(table: string, operation: string, sqlState: string, times = 1): void {
    this.#failures.push({ table, operation, sqlState, remaining: times });
  }

  rows(table: string, tables: Tables = this.tables): Row[] {
    let rows = tables.get(table);
    if (!rows) { rows = []; tables.set(table, rows); }
    return rows;
  }

  count(table: string, conditions?: readonly Condition[]): number {
    return this.rows(table).filter((row) => matches(row, conditions)).length;
  }

  #check(table: string, operation: string): void {
    this.statements.push({ table, operation });
    const failure = this.#failures.find((candidate) => (candidate.table === "*" || candidate.table === table) && (candidate.operation === "*" || candidate.operation === operation) && candidate.remaining > 0);
    if (failure) { failure.remaining -= 1; throw new StatementFailedError(table, operation, failure.sqlState); }
  }

  #assertUnique(table: string, tables: Tables, candidate: Row, self?: Row): void {
    for (const columns of UNIQUE[table] ?? []) {
      if (this.rows(table, tables).some((row) => row !== self && columns.every((column) => row[column] !== null && row[column] !== undefined && row[column] === candidate[column]))) {
        throw new StatementFailedError(table, "insert", "23505");
      }
    }
  }

  select(tables: Tables, table: string, conditions: readonly Condition[] | undefined, columns: readonly string[] | undefined): QueryResult {
    this.#check(table, "select");
    const rows = this.rows(table, tables).filter((row) => matches(row, conditions)).map((row) => columns && !columns.includes("*") ? Object.fromEntries(columns.map((c) => [c, row[c]])) : { ...row });
    return { rows, rowCount: rows.length } as QueryResult;
  }

  insert(tables: Tables, table: string, values: Row, returning: readonly string[] | undefined): QueryResult {
    this.#check(table, "insert");
    const row = { ...values };
    this.#assertUnique(table, tables, row);
    this.rows(table, tables).push(row);
    const returned = returning && !returning.includes("*") ? Object.fromEntries(returning.map((c) => [c, row[c]])) : { ...row };
    return { rows: [returned], rowCount: 1 } as QueryResult;
  }

  update(tables: Tables, table: string, set: Row, conditions: readonly Condition[] | undefined): QueryResult {
    this.#check(table, "update");
    const affected = this.rows(table, tables).filter((row) => matches(row, conditions));
    for (const row of affected) {
      const candidate = { ...row, ...set };
      this.#assertUnique(table, tables, candidate, row);
      Object.assign(row, set);
    }
    return { rows: [], rowCount: affected.length } as unknown as QueryResult;
  }

  remove(tables: Tables, table: string, conditions: readonly Condition[] | undefined): QueryResult {
    this.#check(table, "delete");
    const rows = this.rows(table, tables);
    const remaining = rows.filter((row) => !matches(row, conditions));
    const removed = rows.length - remaining.length;
    tables.set(table, remaining);
    return { rows: [], rowCount: removed } as unknown as QueryResult;
  }

  /** The deferred pair invariant of 20260913T100000Z, evaluated against the transaction's final state for every subject whose subject or profile rows the transaction touched (the trigger fires per affected row). */
  assertPairInvariant(tables: Tables, base: Tables): void {
    const touched = new Set<unknown>();
    const changed = (table: string, key: string, subjectColumn: string): void => {
      const before = new Map(this.rows(table, base).map((row) => [row[key], JSON.stringify(row)]));
      for (const row of this.rows(table, tables)) if (before.get(row[key]) !== JSON.stringify(row)) touched.add(row[subjectColumn]);
      const after = new Set(this.rows(table, tables).map((row) => row[key]));
      for (const row of this.rows(table, base)) if (!after.has(row[key])) touched.add(row[subjectColumn]);
    };
    changed("account_subject", "account_subject_id", "account_subject_id");
    changed("financial_profile", "profile_id", "account_subject_id");
    for (const subject of this.rows("account_subject", tables)) {
      if (!touched.has(subject.account_subject_id)) continue;
      const profiles = this.rows("financial_profile", tables).filter((row) => row.account_subject_id === subject.account_subject_id);
      const active = profiles.filter((row) => row.profile_state === "active").length;
      if (subject.lifecycle_state === "deleted") {
        if (profiles.length === 0 || (profiles.length === 1 && active === 0)) continue;
        throw new StatementFailedError("transaction", "commit", "23514");
      }
      if (profiles.length !== 1 || active !== 1) throw new StatementFailedError("transaction", "commit", "23514");
    }
  }
}

function bind(db: FakeIdentityDatabase, tables: () => Tables, transaction: DataAccessClient["transaction"]): DataAccessClient {
  const subjectBound = (query: { accountSubjectId: string; conditions?: readonly Condition[] | undefined }): Condition[] => {
    if (!query.accountSubjectId) throw new Error("missing accountSubjectId");
    return [{ column: "account_subject_id", value: query.accountSubjectId }, ...(query.conditions ?? [])];
  };
  return {
    transaction,
    tenantSelect: () => Promise.reject(new Error("tenant statements are not part of this fake")),
    tenantInsert: () => Promise.reject(new Error("tenant statements are not part of this fake")),
    tenantUpdate: () => Promise.reject(new Error("tenant statements are not part of this fake")),
    tenantDelete: () => Promise.reject(new Error("tenant statements are not part of this fake")),
    platformSelect: async (query: PlatformSelectQuery) => db.select(tables(), query.table, query.conditions, query.columns),
    platformInsert: async (query: PlatformInsertQuery) => db.insert(tables(), query.table, query.values as Row, query.returning),
    platformUpdate: async (query: PlatformUpdateQuery) => db.update(tables(), query.table, query.set as Row, query.conditions),
    platformDelete: async (query: PlatformDeleteQuery) => db.remove(tables(), query.table, query.conditions),
    profileSelect: async (query: ProfileSelectQuery) => db.select(tables(), query.table, subjectBound(query), query.columns),
    profileInsert: async (query: ProfileInsertQuery) => db.insert(tables(), query.table, { account_subject_id: query.accountSubjectId, ...(query.values as Row) }, query.returning),
    profileUpdate: async (query: ProfileUpdateQuery) => db.update(tables(), query.table, query.set as Row, subjectBound(query)),
    profileDelete: async (query: ProfileDeleteQuery) => db.remove(tables(), query.table, subjectBound(query)),
  };
}

export function createFakeIdentityClient(db: FakeIdentityDatabase): DataAccessClient {
  const root: DataAccessClient = bind(db, () => db.tables, async (options, work) => {
    if (options.isolation !== undefined && options.isolation !== "serializable" && options.isolation !== "read committed") throw new RangeError("invalid transaction isolation");
    const snapshotVersion = db.version;
    const snapshot = clone(db.tables);
    let active = true;
    const scoped = bind(db, () => { if (!active) throw new Error("transaction scope is closed"); return snapshot; }, async () => { throw new Error("nested transactions are refused"); });
    try {
      const result = await work(scoped);
      active = false;
      if (db.version !== snapshotVersion) throw new StatementFailedError("transaction", "commit", "40001");
      db.assertPairInvariant(snapshot, db.tables);
      db.tables = snapshot;
      db.version += 1;
      return result;
    } finally {
      active = false;
    }
  });
  // Root statements outside a transaction commit immediately and bump the version like any other commit.
  const bumping = <T extends (...args: never[]) => Promise<QueryResult>>(operation: T): T => (async (...args: Parameters<T>) => { const result = await operation(...args); db.version += 1; return result; }) as T;
  return {
    ...root,
    platformInsert: bumping(root.platformInsert),
    platformUpdate: bumping(root.platformUpdate),
    platformDelete: bumping(root.platformDelete),
    profileInsert: bumping(root.profileInsert!),
    profileUpdate: bumping(root.profileUpdate!),
    profileDelete: bumping(root.profileDelete!),
  };
}
