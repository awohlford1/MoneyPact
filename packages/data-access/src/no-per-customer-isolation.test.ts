/**
 * CBD-246-AC05: "No per-customer database credential exists and no
 * row-level-security policy is used for tenant isolation; a check in
 * `npm run check` asserts both."
 *
 * CBD-237-AC03 adds the positive half of the same statement: because no
 * database mechanism isolates tenants, the closed catalog and the scope
 * each builder demands are the isolation, and the sweep at the end of this
 * file proves they cover every production table.
 *
 * This runs as this workspace's own `test` script, which `npm run test
 * --workspaces --if-present` already includes in `npm run check` -- no
 * change to the root `package.json` or CI workflow is needed for this check
 * to run on every push.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCTION_TABLE_CATALOG, tablesInScope } from "./catalog.ts";
import { roles } from "./connection.ts";
import type { Pool } from "./driver.ts";
import {
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

const migrationsDirectory = join(import.meta.dirname, "../../migrations/migrations");

void test("CBD-246-AC05: exactly the three DP-105-003 roles exist -- no per-customer role or credential", () => {
  const names = Object.keys(roles).sort();
  assert.deepEqual(names, ["api", "migration", "worker"]);
  for (const value of Object.values(roles)) {
    assert.ok(/^cobudget_(migration|api|worker)$/.test(value), `role name "${value}" must be one of the three fixed roles, never customer-derived`);
  }
});

void test("CBD-246-AC05: no migration enables row-level security or creates an RLS policy", () => {
  let files: readonly string[] = [];
  try {
    files = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"));
  } catch {
    // No migrations exist yet; the assertion below over an empty set still
    // holds and the test still runs so a later migration is still checked.
    files = [];
  }
  const rowLevelSecurityPattern = /\bROW\s+LEVEL\s+SECURITY\b|\bCREATE\s+POLICY\b/iu;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDirectory, file), "utf8");
    assert.ok(
      !rowLevelSecurityPattern.test(sql),
      `${file} must not use row-level security for tenant isolation (CBD-246-AC05); isolation is enforced by the tenant-scoped statement API instead`,
    );
  }
});

// ---------------------------------------------------------------------------
// CBD-237-AC03: unscoped customer-data access is absent from the ordinary
// path. Isolation here is not a database feature (the two tests above) but
// the closed catalog plus the scope each builder demands. These sweep the
// whole production catalog rather than a sample: every budget-space table is
// unreachable through the platform escape hatch, and every table that is
// not budget-space is unreachable through a tenant statement or a join.
// ---------------------------------------------------------------------------

function rejectingDriver(): { pool: Pool; calls: number } {
  const state = { calls: 0 };
  const pool = {
    query: () => {
      state.calls += 1;
      return Promise.reject(new Error("the driver must never be reached by a refused statement"));
    },
  } as unknown as Pool;
  return { pool, get calls() { return state.calls; } };
}

void test("CBD-237-AC03: every budget-space table in the production catalog is refused by all four platform builders", () => {
  const driver = rejectingDriver();
  const tables = tablesInScope(PRODUCTION_TABLE_CATALOG, "budget-space");
  assert.ok(tables.length > 0, "the production catalog must classify at least one budget-space table");
  for (const table of tables) {
    assert.throws(() => platformSelect(driver.pool, { table }), UnknownPlatformTableError, `platformSelect reached ${table}`);
    assert.throws(() => platformInsert(driver.pool, { table, values: { x: 1 } }), UnknownPlatformTableError, `platformInsert reached ${table}`);
    assert.throws(() => platformUpdate(driver.pool, { table, set: { x: 1 } }), UnknownPlatformTableError, `platformUpdate reached ${table}`);
    assert.throws(() => platformDelete(driver.pool, { table }), UnknownPlatformTableError, `platformDelete reached ${table}`);
  }
  assert.equal(driver.calls, 0);
});

void test("CBD-237-AC03: every identity, platform, and financial-profile table in the production catalog is refused by all five tenant builders and as a join target", () => {
  const driver = rejectingDriver();
  const [anyTenantTable] = tablesInScope(PRODUCTION_TABLE_CATALOG, "budget-space");
  assert.ok(anyTenantTable !== undefined);
  const outside = Object.keys(PRODUCTION_TABLE_CATALOG).filter((table) => PRODUCTION_TABLE_CATALOG[table] !== "budget-space");
  assert.ok(outside.length > 0);
  for (const table of outside) {
    const budgetSpaceId = "space-1";
    assert.throws(() => tenantSelect(driver.pool, { table, budgetSpaceId }), UnknownTenantTableError, `tenantSelect reached ${table}`);
    assert.throws(() => tenantCount(driver.pool, { table, budgetSpaceId }), UnknownTenantTableError, `tenantCount reached ${table}`);
    assert.throws(() => tenantInsert(driver.pool, { table, budgetSpaceId, values: { x: 1 } }), UnknownTenantTableError, `tenantInsert reached ${table}`);
    assert.throws(() => tenantUpdate(driver.pool, { table, budgetSpaceId, set: { x: 1 } }), UnknownTenantTableError, `tenantUpdate reached ${table}`);
    assert.throws(() => tenantDelete(driver.pool, { table, budgetSpaceId }), UnknownTenantTableError, `tenantDelete reached ${table}`);
    assert.throws(
      () => tenantSelect(driver.pool, { table: anyTenantTable, budgetSpaceId, joins: [{ table, on: { column: "id", references: "id" } }] }),
      UnknownTenantTableError,
      `a join reached ${table}`,
    );
  }
  assert.equal(driver.calls, 0);
});

void test("CBD-237-AC03: the production catalog is closed -- every table carries exactly one of the four scopes, and a table it does not name is reachable by no builder", () => {
  const driver = rejectingDriver();
  for (const [table, scope] of Object.entries(PRODUCTION_TABLE_CATALOG)) {
    assert.ok(["budget-space", "financial-profile", "identity", "platform"].includes(scope), `${table} has scope ${scope}`);
  }
  const unlisted = "cobudget_table_nobody_registered";
  assert.equal(PRODUCTION_TABLE_CATALOG[unlisted], undefined);
  assert.throws(() => tenantSelect(driver.pool, { table: unlisted, budgetSpaceId: "space-1" }), UnknownTenantTableError);
  assert.throws(() => platformSelect(driver.pool, { table: unlisted }), UnknownPlatformTableError);
  assert.equal(driver.calls, 0);
});
