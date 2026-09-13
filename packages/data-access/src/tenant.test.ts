import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "./driver.ts";
import type { TableCatalog } from "./catalog.ts";
import { StatementFailedError } from "./logging.ts";
import {
  InvalidIdentifierError,
  MissingBudgetSpaceError,
  ReservedColumnError,
  UnknownPlatformTableError,
  UnknownTenantTableError,
  platformDelete,
  platformInsert,
  platformSelect,
  platformUpdate,
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
