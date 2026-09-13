/**
 * CBD-246-AC05: "No per-customer database credential exists and no
 * row-level-security policy is used for tenant isolation; a check in
 * `npm run check` asserts both."
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
import { roles } from "./connection.ts";

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
