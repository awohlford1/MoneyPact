import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import type { Pool } from "./driver.ts";
import type { TableCatalog } from "./catalog.ts";
import { StatementFailedError } from "./logging.ts";
import {
  InvalidIdentifierError,
  InvalidPageBoundError,
  MissingBudgetSpaceError,
  ReservedColumnError,
  SkipLockedNotSupportedError,
  UnknownColumnQualifierError,
  UnknownPlatformTableError,
  UnknownTenantTableError,
  platformDelete,
  platformInsert,
  platformSelect,
  platformUpdate,
  tenantCount,
  tenantDelete,
  tenantInsert,
  tenantSelect,
  tenantUpdate,
} from "./tenant.ts";

// This package's own tests exercise the real enforcement path against a
// table no production migration has created yet, hence the injected test
// catalog rather than the production one (see catalog.ts's module doc).
const TEST_CATALOG: TableCatalog = {
  budget_line_items: "budget-space",
  identity_accounts: "identity",
};

function fakePool(): { pool: Pool; calls: { text: string; params: unknown }[] } {
  const calls: { text: string; params: unknown }[] = [];
  const pool = {
    query: (text: string, params?: unknown) => {
      calls.push({ text, params });
      return Promise.resolve({ rows: [], rowCount: 0 } as never);
    },
  } as unknown as Pool;
  return { pool, calls };
}

function rejectingPool(message: string): Pool {
  return {
    query: () => Promise.reject(new Error(message)),
  } as unknown as Pool;
}

void test("CBD-246-AC02: an empty budgetSpaceId throws before the driver is called", () => {
  const { pool, calls } = fakePool();
  // tenantSelect throws synchronously, before it ever returns a promise, so
  // the guard fires even for a caller who never awaits it.
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "" as string }, TEST_CATALOG),
    MissingBudgetSpaceError,
  );
  assert.equal(calls.length, 0, "the driver must never see a statement missing its tenant scope");
});

void test("CBD-246-AC02: whitespace-only budgetSpaceId also throws before execution", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "   " }, TEST_CATALOG),
    MissingBudgetSpaceError,
  );
  assert.equal(calls.length, 0);
});

void test("CBD246-SECURITY-001 finding 1: a table not classified budget-space is refused, even with a valid budgetSpaceId", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => tenantSelect(pool, { table: "identity_accounts", budgetSpaceId: "space-123" }, TEST_CATALOG),
    UnknownTenantTableError,
  );
  assert.equal(calls.length, 0, "a table the catalog does not classify budget-space must never reach the driver through a tenant statement");
});

void test("CBD246-SECURITY-001 finding 1: the platform escape hatch refuses a budget-space table -- it cannot be used to skip tenant scoping", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => platformSelect(pool, { table: "budget_line_items" }, TEST_CATALOG),
    UnknownPlatformTableError,
  );
  assert.equal(calls.length, 0);
});

void test("CBD246-SECURITY-001 finding 1: tenantSelect always composes budget_space_id = $1 -- there is no field through which a caller supplies raw SQL to omit it", async () => {
  const { pool, calls } = fakePool();
  await tenantSelect(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-123",
    conditions: [{ column: "id", value: "line-1" }],
  }, TEST_CATALOG);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? "", /^select \* from budget_line_items where budget_space_id = \$1 and id = \$2$/);
  assert.deepEqual(calls[0]?.params, ["space-123", "line-1"]);
});

void test("CBD-246-AC02: budgetSpaceId cannot be overridden through conditions, values, or set -- it is a reserved column", () => {
  const { pool } = fakePool();
  assert.throws(
    () => tenantSelect(pool, {
      table: "budget_line_items",
      budgetSpaceId: "space-123",
      conditions: [{ column: "budget_space_id", value: "other-space" }],
    }, TEST_CATALOG),
    ReservedColumnError,
  );
  assert.throws(
    () => tenantInsert(pool, {
      table: "budget_line_items",
      budgetSpaceId: "space-123",
      values: { budget_space_id: "other-space", value: "x" },
    }, TEST_CATALOG),
    ReservedColumnError,
  );
  assert.throws(
    () => tenantUpdate(pool, {
      table: "budget_line_items",
      budgetSpaceId: "space-123",
      set: { budget_space_id: "other-space" },
    }, TEST_CATALOG),
    ReservedColumnError,
  );
});

void test("CBD-246-AC02: an invalid identifier (table or column) is refused rather than interpolated", () => {
  const { pool } = fakePool();
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items; drop table x", budgetSpaceId: "space-1" }, TEST_CATALOG),
    InvalidIdentifierError,
  );
  assert.throws(
    () => tenantSelect(pool, {
      table: "budget_line_items",
      budgetSpaceId: "space-1",
      conditions: [{ column: "id = 1; drop table x --", value: 1 }],
    }, TEST_CATALOG),
    InvalidIdentifierError,
  );
});

void test("tenantInsert always writes budget_space_id from budgetSpaceId, never from values", async () => {
  const { pool, calls } = fakePool();
  await tenantInsert(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-123",
    values: { name: "groceries", amount_minor_units: 500 },
  }, TEST_CATALOG);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.text, "insert into budget_line_items (budget_space_id, name, amount_minor_units) values ($1, $2, $3)");
  assert.deepEqual(calls[0]?.params, ["space-123", "groceries", 500]);
});

void test("tenantUpdate and tenantDelete always filter on budget_space_id = $1", async () => {
  const { pool, calls } = fakePool();
  await tenantUpdate(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-123",
    set: { name: "rent" },
    conditions: [{ column: "id", value: "line-1" }],
  }, TEST_CATALOG);
  await tenantDelete(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-123",
    conditions: [{ column: "id", value: "line-1" }],
  }, TEST_CATALOG);
  assert.equal(calls[0]?.text, "update budget_line_items set name = $2 where budget_space_id = $1 and id = $3");
  assert.deepEqual(calls[0]?.params, ["space-123", "rent", "line-1"]);
  assert.equal(calls[1]?.text, "delete from budget_line_items where budget_space_id = $1 and id = $2");
  assert.deepEqual(calls[1]?.params, ["space-123", "line-1"]);
});

void test("a platform statement threads no tenant identifier", async () => {
  const { pool, calls } = fakePool();
  await platformSelect(pool, { table: "identity_accounts", conditions: [{ column: "id", value: "x" }] }, TEST_CATALOG);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.text, "select * from identity_accounts where id = $1");
  assert.deepEqual(calls[0]?.params, ["x"]);
});

void test("platformInsert, platformUpdate, and platformDelete also compose their SQL rather than accepting caller text", async () => {
  const { pool, calls } = fakePool();
  await platformInsert(pool, { table: "identity_accounts", values: { email: "a@example.com" } }, TEST_CATALOG);
  await platformUpdate(pool, { table: "identity_accounts", set: { email: "b@example.com" }, conditions: [{ column: "id", value: 1 }] }, TEST_CATALOG);
  await platformDelete(pool, { table: "identity_accounts", conditions: [{ column: "id", value: 1 }] }, TEST_CATALOG);
  assert.equal(calls[0]?.text, "insert into identity_accounts (email) values ($1)");
  assert.equal(calls[1]?.text, "update identity_accounts set email = $1 where id = $2");
  assert.equal(calls[2]?.text, "delete from identity_accounts where id = $1");
});

void test("IDLE-E02 (CBD-191 SC-191-006): skipLocked renders the exact best-effort ctid/skip-locked predicate, reusing the same bound conditions in both places", async () => {
  const { pool, calls } = fakePool();
  await platformUpdate(pool, {
    table: "identity_accounts",
    set: { email: "b@example.com" },
    conditions: [{ column: "id", value: 1 }],
    skipLocked: true,
  }, TEST_CATALOG);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.text,
    "update identity_accounts set email = $1 where id = $2 and ctid in (select ctid from identity_accounts where id = $2 for no key update skip locked)",
  );
  assert.deepEqual(calls[0]?.params, ["b@example.com", 1]);
});

void test("IDLE-E02: skipLocked with no condition is refused before the driver is called -- a lock with no predicate would target every row", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => platformUpdate(pool, { table: "identity_accounts", set: { email: "b@example.com" }, skipLocked: true }, TEST_CATALOG),
    RangeError,
  );
  assert.equal(calls.length, 0);
});

void test("IDLE-E02: skipLocked is refused on a tenant statement -- CBD-191's best-effort slide is a platform-only predicate", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => tenantUpdate(pool, { table: "budget_line_items", budgetSpaceId: "space-1", set: { name: "x" }, conditions: [{ column: "id", value: 1 }], skipLocked: true }, TEST_CATALOG),
    SkipLockedNotSupportedError,
  );
  assert.equal(calls.length, 0, "refused before the driver is ever called");
});

void test("CBD246-SECURITY-001 finding 3: a rejected driver query never reaches the caller with the driver's own message", async () => {
  const CANARY = "sensitive-bound-value-246 SQL=select secret";
  const pool = rejectingPool(`duplicate key: ${CANARY}`);
  await assert.rejects(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-1" }, TEST_CATALOG),
    (error: unknown) => {
      assert.ok(error instanceof StatementFailedError, "the caller must see a StatementFailedError, not the raw driver rejection");
      assert.ok(!error.message.includes(CANARY), "the wrapped error must not carry the canary bound value or statement text");
      assert.equal((error as { cause?: unknown }).cause, undefined, "the raw driver error must not be attached as cause");
      return true;
    },
  );
});

void test("CBD246-SECURITY-002 finding 3: the same redaction applies to every builder -- both roles, all four operations", async () => {
  const CANARY = "insert-canary-246";
  const pool = rejectingPool(`constraint violation: ${CANARY}`);
  for (const attempt of [
    () => tenantInsert(pool, { table: "budget_line_items", budgetSpaceId: "space-1", values: { name: "x" } }, TEST_CATALOG),
    () => tenantUpdate(pool, { table: "budget_line_items", budgetSpaceId: "space-1", set: { name: "x" } }, TEST_CATALOG),
    () => tenantDelete(pool, { table: "budget_line_items", budgetSpaceId: "space-1" }, TEST_CATALOG),
    () => platformSelect(pool, { table: "identity_accounts" }, TEST_CATALOG),
    () => platformInsert(pool, { table: "identity_accounts", values: { email: "a@example.com" } }, TEST_CATALOG),
    () => platformUpdate(pool, { table: "identity_accounts", set: { email: "b@example.com" }, conditions: [{ column: "id", value: 1 }] }, TEST_CATALOG),
    () => platformDelete(pool, { table: "identity_accounts", conditions: [{ column: "id", value: 1 }] }, TEST_CATALOG),
  ]) {
    await assert.rejects(attempt, (error: unknown) => {
      assert.ok(error instanceof StatementFailedError);
      assert.ok(!error.message.includes(CANARY));
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// CBD-237: tenant-scoped data-access paths. The fixtures below run the seam's
// composed SQL against an in-memory table set that evaluates exactly the
// clause shapes this module produces -- the tenant predicate, `and` terms,
// inner joins, `order by`, `limit`/`offset`, `count(*)` -- and nothing else.
// The fixture applies whatever predicate the seam wrote; it adds none of its
// own. The control test proves that: the same fixture, handed a statement
// without the tenant predicate, hands back the other tenant's row.
// ---------------------------------------------------------------------------

type FixtureRow = Record<string, unknown>;
type FixtureTables = Record<string, FixtureRow[]>;

const SELECT_SHAPE = /^select (.+?) from ([a-z_]+)((?: inner join [a-z_]+ on [a-z_.]+ = [a-z_.]+)*) where (.+?)(?: order by (.+?))?(?: limit \$(\d+))?(?: offset \$(\d+))?$/u;
const JOIN_SHAPE = / inner join ([a-z_]+) on ([a-z_]+)\.([a-z_]+) = ([a-z_]+)\.([a-z_]+)/gu;
const UPDATE_SHAPE = /^update ([a-z_]+) set (.+) where (.+)$/u;
const DELETE_SHAPE = /^delete from ([a-z_]+) where (.+)$/u;
const TERM_SHAPE = /^([a-z_.]+) (=|<>|<|<=|>|>=) \$(\d+)$/u;

function qualify(table: string, row: FixtureRow, into: FixtureRow): FixtureRow {
  const merged: FixtureRow = { ...into };
  for (const [column, value] of Object.entries(row)) {
    merged[`${table}.${column}`] = value;
    if (!(column in merged)) merged[column] = value;
  }
  return merged;
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  const a = String(left);
  const b = String(right);
  switch (operator) {
    case "=": return a === b;
    case "<>": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    default: return a >= b;
  }
}

function matches(row: FixtureRow, where: string, params: readonly unknown[]): boolean {
  return where.split(" and ").every((term) => {
    const parsed = TERM_SHAPE.exec(term);
    if (!parsed) throw new Error(`fixture cannot evaluate predicate term "${term}"`);
    const [, column = "", operator = "=", index = "1"] = parsed;
    return column in row && compare(row[column], operator, params[Number(index) - 1]);
  });
}

function evaluate(tables: FixtureTables, text: string, params: readonly unknown[]): { rows: FixtureRow[]; rowCount: number } {
  const select = SELECT_SHAPE.exec(text);
  if (select) {
    const [, projection = "", base = "", joins = "", where = "", order, limit, offset] = select;
    let rows = (tables[base] ?? []).map((row) => qualify(base, row, {}));
    for (const join of joins.matchAll(JOIN_SHAPE)) {
      const [, table = "", leftTable = "", leftColumn = "", rightTable = "", rightColumn = ""] = join;
      rows = rows.flatMap((row) => (tables[table] ?? [])
        .filter((candidate) => leftTable === table && String(candidate[leftColumn]) === String(row[`${rightTable}.${rightColumn}`]))
        .map((candidate) => qualify(table, candidate, row)));
    }
    rows = rows.filter((row) => matches(row, where, params));
    if (order) {
      const terms = order.split(", ").map((term) => term.split(" "));
      rows.sort((a, b) => {
        for (const [column = "", direction = "asc"] of terms) {
          if (String(a[column]) === String(b[column])) continue;
          return (String(a[column]) < String(b[column]) ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return 0;
      });
    }
    const from = offset ? Number(params[Number(offset) - 1]) : 0;
    const to = limit ? from + Number(params[Number(limit) - 1]) : undefined;
    rows = rows.slice(from, to);
    if (projection === "count(*) as count") return { rows: [{ count: String(rows.length) }], rowCount: 1 };
    const projected = rows.map((row) => {
      const out: FixtureRow = {};
      const columns = projection === "*" ? Object.keys(row).filter((key) => !key.includes(".")) : projection.split(", ");
      for (const column of columns) out[column.includes(".") ? column.slice(column.indexOf(".") + 1) : column] = row[column];
      return out;
    });
    return { rows: projected, rowCount: projected.length };
  }
  const update = UPDATE_SHAPE.exec(text);
  if (update) {
    const [, table = "", assignments = "", where = ""] = update;
    let rowCount = 0;
    for (const row of tables[table] ?? []) {
      if (!matches(qualify(table, row, {}), where, params)) continue;
      for (const assignment of assignments.split(", ")) {
        const [column = "", placeholder = ""] = assignment.split(" = ");
        row[column] = params[Number(placeholder.slice(1)) - 1];
      }
      rowCount += 1;
    }
    return { rows: [], rowCount };
  }
  const remove = DELETE_SHAPE.exec(text);
  if (remove) {
    const [, table = "", where = ""] = remove;
    const before = tables[table] ?? [];
    const kept = before.filter((row) => !matches(qualify(table, row, {}), where, params));
    tables[table] = kept;
    return { rows: [], rowCount: before.length - kept.length };
  }
  throw new Error(`fixture cannot evaluate statement "${text}"`);
}

function scopedFixturePool(tables: FixtureTables): { pool: Pool; calls: { text: string; params: unknown }[]; tables: FixtureTables } {
  const calls: { text: string; params: unknown }[] = [];
  const pool = {
    query: (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return Promise.resolve(evaluate(tables, text, params) as never);
    },
  } as unknown as Pool;
  return { pool, calls, tables };
}

const CBD237_CATALOG: TableCatalog = {
  budget_line_items: "budget-space",
  budget_categories: "budget-space",
  identity_accounts: "identity",
};

/** Two tenants side by side. Tenant A owns line-1 and line-2 in category cat-a; tenant B owns line-3 in cat-b. */
function twoTenants(): FixtureTables {
  return {
    budget_categories: [
      { budget_space_id: "space-a", category_id: "cat-a", label: "groceries" },
      { budget_space_id: "space-b", category_id: "cat-b", label: "rent" },
    ],
    budget_line_items: [
      { budget_space_id: "space-a", id: "line-1", category_id: "cat-a", amount: 500 },
      { budget_space_id: "space-a", id: "line-2", category_id: "cat-a", amount: 700 },
      { budget_space_id: "space-b", id: "line-3", category_id: "cat-b", amount: 900 },
    ],
  };
}

void test("CBD-237-AC02: tenantCount, tenantUpdate, and tenantDelete each refuse a blank budgetSpaceId before the driver is called", () => {
  const { pool, calls } = fakePool();
  assert.throws(() => tenantCount(pool, { table: "budget_line_items", budgetSpaceId: "" }, CBD237_CATALOG), MissingBudgetSpaceError);
  assert.throws(() => tenantUpdate(pool, { table: "budget_line_items", budgetSpaceId: " ", set: { amount: 1 } }, CBD237_CATALOG), MissingBudgetSpaceError);
  assert.throws(() => tenantDelete(pool, { table: "budget_line_items", budgetSpaceId: "" }, CBD237_CATALOG), MissingBudgetSpaceError);
  assert.equal(calls.length, 0, "no statement lacking its tenant scope may reach the driver");
});

void test("CBD-237-AC04: another tenant's identifier reads as nothing -- the same empty result a guessed identifier gets", async () => {
  const { pool, calls } = scopedFixturePool(twoTenants());
  const substituted = await tenantSelect(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-b",
    conditions: [{ column: "id", value: "line-1" }],
  }, CBD237_CATALOG);
  const guessed = await tenantSelect(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-b",
    conditions: [{ column: "id", value: "line-does-not-exist" }],
  }, CBD237_CATALOG);
  assert.deepEqual({ rows: substituted.rows, rowCount: substituted.rowCount }, { rows: [], rowCount: 0 }, "tenant A's line-1 must be invisible under tenant B's scope");
  assert.deepEqual({ rows: guessed.rows, rowCount: guessed.rowCount }, { rows: substituted.rows, rowCount: substituted.rowCount }, "a substituted identifier and a guessed one must be indistinguishable");
  assert.match(calls[0]?.text ?? "", /^select \* from budget_line_items where budget_space_id = \$1 and id = \$2$/u);
});

void test("CBD-237-AC04: another tenant's identifier cannot be updated or deleted -- rowCount 0 and the row is untouched", async () => {
  const { pool, tables } = scopedFixturePool(twoTenants());
  const updated = await tenantUpdate(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-b",
    set: { amount: 1 },
    conditions: [{ column: "id", value: "line-1" }],
  }, CBD237_CATALOG);
  const deleted = await tenantDelete(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-b",
    conditions: [{ column: "id", value: "line-1" }],
  }, CBD237_CATALOG);
  assert.equal(updated.rowCount, 0);
  assert.equal(deleted.rowCount, 0);
  assert.deepEqual(tables.budget_line_items?.find((row) => row.id === "line-1"), { budget_space_id: "space-a", id: "line-1", category_id: "cat-a", amount: 500 });
});

void test("CBD-237-AC04: a failure on a cross-tenant statement reveals neither the identifier nor the space -- existence is not disclosed through the error", async () => {
  const pool = rejectingPool("no such row: line-1 in space-a");
  await assert.rejects(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-b", conditions: [{ column: "id", value: "line-1" }] }, CBD237_CATALOG),
    (error: unknown) => {
      assert.ok(error instanceof StatementFailedError);
      assert.ok(!error.message.includes("line-1") && !error.message.includes("space-a") && !error.message.includes("space-b"));
      return true;
    },
  );
});

void test("CBD-237-AC04 control: the fixture itself isolates nothing -- a statement without the tenant predicate returns tenant A's row", async () => {
  const { pool } = scopedFixturePool(twoTenants());
  const raw = await pool.query("select * from budget_line_items where id = $1", ["line-1"]);
  assert.equal(raw.rowCount, 1, "the fixture must answer an unscoped statement with the row, so the isolation proved above comes from the seam's predicate alone");
});

void test("CBD-237-AC05: orderBy, limit, and offset are composed after the tenant predicate with validated identifiers and bound page parameters", async () => {
  const { pool, calls } = fakePool();
  await tenantSelect(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-a",
    columns: ["id", "amount"],
    conditions: [{ column: "amount", operator: ">=", value: 100 }],
    orderBy: [{ column: "amount", direction: "desc" }, { column: "id" }],
    limit: 2,
    offset: 4,
  }, CBD237_CATALOG);
  assert.equal(calls[0]?.text, "select id, amount from budget_line_items where budget_space_id = $1 and amount >= $2 order by amount desc, id asc limit $3 offset $4");
  assert.deepEqual(calls[0]?.params, ["space-a", 100, 2, 4]);
});

void test("CBD-237-AC05: a page bound that is not a non-negative safe integer is refused before the driver is called", () => {
  const { pool, calls } = fakePool();
  for (const bound of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assert.throws(() => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", limit: bound }, CBD237_CATALOG), InvalidPageBoundError, `limit ${bound}`);
    assert.throws(() => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", offset: bound }, CBD237_CATALOG), InvalidPageBoundError, `offset ${bound}`);
  }
  assert.equal(calls.length, 0);
});

void test("CBD-237-AC05: an order term is a validated identifier with a closed direction -- neither can carry text, and the reserved column is refused", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", orderBy: [{ column: "amount; drop table x", direction: "asc" }] }, CBD237_CATALOG),
    InvalidIdentifierError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", orderBy: [{ column: "amount", direction: "asc; drop table x" as "asc" }] }, CBD237_CATALOG),
    InvalidIdentifierError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", orderBy: [{ column: "budget_space_id" }] }, CBD237_CATALOG),
    ReservedColumnError,
  );
  assert.equal(calls.length, 0);
});

void test("CBD-237-AC05: a page, an ordering, and a total under tenant B contain only tenant B's rows; tenant A's rows are neither counted nor paged in", async () => {
  const { pool, calls } = scopedFixturePool(twoTenants());
  const page = await tenantSelect(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-b",
    columns: ["id"],
    orderBy: [{ column: "amount", direction: "desc" }],
    limit: 10,
    offset: 0,
  }, CBD237_CATALOG);
  const total = await tenantCount(pool, { table: "budget_line_items", budgetSpaceId: "space-b" }, CBD237_CATALOG);
  const emptyPage = await tenantSelect(pool, { table: "budget_categories", budgetSpaceId: "space-c", limit: 10 }, CBD237_CATALOG);
  const emptyTotal = await tenantCount(pool, { table: "budget_categories", budgetSpaceId: "space-c" }, CBD237_CATALOG);
  assert.deepEqual(page.rows, [{ id: "line-3" }], "only tenant B's own line may appear on tenant B's page");
  assert.deepEqual(total.rows, [{ count: "1" }], "the total must not include tenant A's two lines");
  assert.deepEqual({ rows: emptyPage.rows, rowCount: emptyPage.rowCount }, { rows: [], rowCount: 0 }, "a tenant with no rows sees an empty page, not the shape of other tenants' data");
  assert.deepEqual(emptyTotal.rows, [{ count: "0" }]);
  assert.equal(calls[1]?.text, "select count(*) as count from budget_line_items where budget_space_id = $1");
});

void test("CBD-237-AC06: a join composes the joined table's own budget_space_id = $1 predicate; the caller never writes it", async () => {
  const { pool, calls } = fakePool();
  await tenantSelect(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-a",
    columns: ["budget_line_items.id", "budget_categories.label"],
    joins: [{ table: "budget_categories", on: { column: "category_id", references: "category_id" } }],
    conditions: [{ column: "budget_categories.label", value: "groceries" }],
    orderBy: [{ column: "budget_line_items.id" }],
  }, CBD237_CATALOG);
  assert.equal(
    calls[0]?.text,
    "select budget_line_items.id, budget_categories.label from budget_line_items inner join budget_categories on budget_categories.category_id = budget_line_items.category_id"
      + " where budget_line_items.budget_space_id = $1 and budget_categories.budget_space_id = $1 and budget_categories.label = $2 order by budget_line_items.id asc",
  );
  assert.deepEqual(calls[0]?.params, ["space-a", "groceries"]);
  await tenantCount(pool, {
    table: "budget_line_items",
    budgetSpaceId: "space-a",
    joins: [{ table: "budget_categories", on: { column: "category_id", references: "category_id" } }],
  }, CBD237_CATALOG);
  assert.equal(
    calls[1]?.text,
    "select count(*) as count from budget_line_items inner join budget_categories on budget_categories.category_id = budget_line_items.category_id"
      + " where budget_line_items.budget_space_id = $1 and budget_categories.budget_space_id = $1",
  );
});

void test("CBD-237-AC06: a foreign key substituted to another space's row joins to nothing under either tenant -- the join fails closed", async () => {
  const tables = twoTenants();
  // line-4 belongs to tenant A but its category_id names tenant B's category.
  tables.budget_line_items?.push({ budget_space_id: "space-a", id: "line-4", category_id: "cat-b", amount: 100 });
  const { pool } = scopedFixturePool(tables);
  const join = { table: "budget_categories", on: { column: "category_id", references: "category_id" } };
  const underA = await tenantSelect(pool, {
    table: "budget_line_items", budgetSpaceId: "space-a", columns: ["budget_line_items.id", "budget_categories.label"], joins: [join],
    conditions: [{ column: "budget_line_items.id", value: "line-4" }],
  }, CBD237_CATALOG);
  const underB = await tenantSelect(pool, {
    table: "budget_line_items", budgetSpaceId: "space-b", columns: ["budget_line_items.id", "budget_categories.label"], joins: [join],
    conditions: [{ column: "budget_line_items.id", value: "line-4" }],
  }, CBD237_CATALOG);
  const legitimate = await tenantSelect(pool, {
    table: "budget_line_items", budgetSpaceId: "space-a", columns: ["budget_line_items.id", "budget_categories.label"], joins: [join],
    orderBy: [{ column: "budget_line_items.id" }],
  }, CBD237_CATALOG);
  assert.deepEqual(underA.rows, [], "tenant A must not read tenant B's category label through its own line");
  assert.deepEqual(underB.rows, [], "tenant B must not read tenant A's line through its own category");
  assert.deepEqual(legitimate.rows, [{ id: "line-1", label: "groceries" }, { id: "line-2", label: "groceries" }], "a same-space join still returns the space's own rows");
  const counted = await tenantCount(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [join] }, CBD237_CATALOG);
  assert.deepEqual(counted.rows, [{ count: "2" }], "the substituted line is not counted either");
});

void test("CBD-237-AC06: a joined table outside the budget-space catalog, a repeated join, and a reserved join column are each refused before the driver is called", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [{ table: "identity_accounts", on: { column: "id", references: "owner_id" } }] }, CBD237_CATALOG),
    UnknownTenantTableError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [{ table: "unregistered_table", on: { column: "id", references: "owner_id" } }] }, CBD237_CATALOG),
    UnknownTenantTableError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [{ table: "budget_line_items", on: { column: "id", references: "id" } }] }, CBD237_CATALOG),
    RangeError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [{ table: "budget_categories", on: { column: "budget_space_id", references: "budget_space_id" } }] }, CBD237_CATALOG),
    ReservedColumnError,
  );
  assert.equal(calls.length, 0);
});

void test("CBD-237-AC06: a qualified column may name only a table the statement vetted, and budget_space_id stays reserved under a qualifier", () => {
  const { pool, calls } = fakePool();
  const join = { table: "budget_categories", on: { column: "category_id", references: "category_id" } };
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [join], conditions: [{ column: "identity_accounts.id", value: 1 }] }, CBD237_CATALOG),
    UnknownColumnQualifierError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [join], columns: ["identity_accounts.email"] }, CBD237_CATALOG),
    UnknownColumnQualifierError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", conditions: [{ column: "budget_categories.label", value: "x" }] }, CBD237_CATALOG),
    UnknownColumnQualifierError,
    "without a join, only the base table may qualify a column",
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [join], conditions: [{ column: "budget_categories.budget_space_id", value: "space-b" }] }, CBD237_CATALOG),
    ReservedColumnError,
  );
  assert.throws(
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [join], orderBy: [{ column: "budget_categories.budget_space_id" }] }, CBD237_CATALOG),
    ReservedColumnError,
  );
  assert.equal(calls.length, 0);
});

void test("CBD-237-AC02: tenantCount and a joined tenantSelect execute through the same redacting seam as every other builder", async () => {
  const CANARY = "join-canary-237";
  const pool = rejectingPool(`relation does not exist: ${CANARY}`);
  const join = { table: "budget_categories", on: { column: "category_id", references: "category_id" } };
  for (const attempt of [
    () => tenantCount(pool, { table: "budget_line_items", budgetSpaceId: "space-a" }, CBD237_CATALOG),
    () => tenantSelect(pool, { table: "budget_line_items", budgetSpaceId: "space-a", joins: [join], limit: 1 }, CBD237_CATALOG),
  ]) {
    await assert.rejects(attempt, (error: unknown) => {
      assert.ok(error instanceof StatementFailedError);
      assert.ok(!error.message.includes(CANARY));
      assert.equal((error as { cause?: unknown }).cause, undefined);
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// CBD-237-AC08: the repository-method inventory. Every statement this package
// issues either goes through a scope-requiring builder (tenant.ts,
// profile.ts) or sits in a file on the approved exemption list below with
// the reason it may hold a raw `.query(` call. A new file that calls
// `.query(` directly fails this test until it is either rewritten through a
// builder or its exemption is recorded here and reviewed.
// ---------------------------------------------------------------------------

/** Files permitted to call `.query(` directly, and why. Keyed by path relative to `src/`. */
const APPROVED_RAW_QUERY_EXEMPTIONS: Readonly<Record<string, string>> = {
  "tenant.ts": "the tenant/platform statement seam itself (CBD-246-AC02); every call requires the scope it composes",
  "profile.ts": "the subject-scoped financial-profile seam (SM-212-01); every call binds account_subject_id itself",
  "binding.ts": "transaction control (BEGIN/COMMIT/ROLLBACK) and the per-transaction queryable that re-enters the builders above",
  "budget-memberships.ts": "the closed subject-scoped membership discovery read (CBD-246); fixed statement text, subject bound as $1",
  "budget-space-invitation.ts": "the closed cross-space invitation-code and ceremony locators (PK5-F02, R-02); location only, re-read and re-checked inside the tenant-scoped transaction",
};

function rawQueryCallSites(source: string): number {
  let count = 0;
  const ast = ts.createSourceFile("inventory.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "query") count += 1;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return count;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

void test("CBD-237-AC08: every raw .query( call site in packages/data-access/src is in a file on the approved exemption list", () => {
  const sourceDirectory = import.meta.dirname;
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of sourceFiles(sourceDirectory)) {
    const name = relative(sourceDirectory, file).replaceAll("\\", "/");
    const sites = rawQueryCallSites(readFileSync(file, "utf8"));
    if (sites === 0) continue;
    seen.add(name);
    if (!(name in APPROVED_RAW_QUERY_EXEMPTIONS)) offenders.push(`${name} (${sites} call site${sites === 1 ? "" : "s"})`);
  }
  assert.deepEqual(offenders, [], "a repository method may not issue SQL outside the scope-requiring builders without a recorded, reviewed exemption (CBD-237-AC08)");
  for (const name of Object.keys(APPROVED_RAW_QUERY_EXEMPTIONS)) {
    assert.ok(seen.has(name), `exemption for ${name} is stale: the file no longer calls .query( and the entry must be removed`);
  }
});

void test("CBD-237-AC08 negative fixture: the inventory counts a direct .query( call and ignores comments and builder calls", () => {
  assert.equal(rawQueryCallSites('export async function list(pool: { query: Function }) { return pool.query("select * from budget_space"); }\n'), 1);
  assert.equal(rawQueryCallSites('const bypass = (c: any) => c.query("delete from budget_space");\n'), 1);
  assert.equal(rawQueryCallSites('// a comment that says pool.query(...) is not a call\nexport const x = 1;\n'), 0);
  assert.equal(rawQueryCallSites('export const read = (client: any, id: string) => client.tenantSelect({ table: "budget_space", budgetSpaceId: id });\n'), 0);
});
