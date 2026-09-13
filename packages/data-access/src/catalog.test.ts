import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCTION_TABLE_CATALOG, isPlatformTable, isTenantTable } from "./catalog.ts";

const migrationsDirectory = join(import.meta.dirname, "../../migrations/migrations");
const SCOPE_PATTERN = /^--\s*scope:\s*(budget-space|financial-profile|identity|platform)\s*$/iu;
const CREATE_TABLE_PATTERN = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/iu;

function tablesDeclaredByMigrations(): ReadonlyMap<string, string> {
  const declared = new Map<string, string>();
  let files: readonly string[] = [];
  try {
    files = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"));
  } catch {
    files = [];
  }
  for (const file of files) {
    const lines = readFileSync(join(migrationsDirectory, file), "utf8").split(/\r?\n/u);
    let pendingScope: string | undefined;
    for (const line of lines) {
      const scopeMatch = SCOPE_PATTERN.exec(line.trim());
      if (scopeMatch?.[1]) {
        pendingScope = scopeMatch[1].toLowerCase();
        continue;
      }
      const tableMatch = CREATE_TABLE_PATTERN.exec(line.trim());
      if (tableMatch?.[1]) {
        if (!pendingScope) {
          throw new Error(`${file}: CREATE TABLE ${tableMatch[1]} has no preceding "-- scope:" comment`);
        }
        declared.set(tableMatch[1], pendingScope);
        pendingScope = undefined;
      }
    }
  }
  return declared;
}

void test("CBD-246-AC02: the closed table catalog agrees exactly with every migration's scope annotation", () => {
  const declared = tablesDeclaredByMigrations();
  for (const [table, scope] of declared) {
    assert.equal(
      PRODUCTION_TABLE_CATALOG[table],
      scope,
      `catalog.ts classifies "${table}" as "${PRODUCTION_TABLE_CATALOG[table]}", but the migration that creates it declares "${scope}"`,
    );
  }
  for (const table of Object.keys(PRODUCTION_TABLE_CATALOG)) {
    assert.ok(
      declared.has(table),
      `catalog.ts lists "${table}", but no migration under packages/migrations/migrations creates it -- the catalog must not name a fictitious table`,
    );
  }
});

void test("CBD-246-AC02: isTenantTable and isPlatformTable are mutually exclusive and closed", () => {
  const catalog = { budget_space_table: "budget-space", platform_table: "platform", identity_table: "identity", other_table: "financial-profile" } as const;
  assert.equal(isTenantTable(catalog, "budget_space_table"), true);
  assert.equal(isPlatformTable(catalog, "budget_space_table"), false);
  assert.equal(isTenantTable(catalog, "platform_table"), false);
  assert.equal(isPlatformTable(catalog, "platform_table"), true);
  assert.equal(isPlatformTable(catalog, "identity_table"), true);
  assert.equal(isTenantTable(catalog, "other_table"), false, "financial-profile is not a tenant table");
  assert.equal(isPlatformTable(catalog, "other_table"), false, "financial-profile has no seam yet and must not leak through the platform escape hatch");
  assert.equal(isTenantTable(catalog, "unregistered_table"), false);
  assert.equal(isPlatformTable(catalog, "unregistered_table"), false);
});
