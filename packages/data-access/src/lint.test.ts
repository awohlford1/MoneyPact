/**
 * CBD-246-AC01 negative fixture: "a direct driver import outside it fails
 * lint; a negative fixture proves the rule fires."
 *
 * This loads this package's own `eslint.config.mjs` -- the config `npm run
 * lint` actually runs -- and lints a fixture string through it. The fixture
 * never touches disk (`ESLint#lintText` takes a virtual `filePath`), so it
 * cannot itself make `eslint .` fail; only this assertion exercises it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { ESLint } from "eslint";

const packageDirectory = join(import.meta.dirname, "..");

async function lint(relativePath: string, source: string) {
  const eslint = new ESLint({ cwd: packageDirectory });
  const [result] = await eslint.lintText(source, { filePath: join(packageDirectory, relativePath) });
  return result;
}

void test("CBD-246-AC01: a direct pg import outside driver.ts fails lint", async () => {
  const result = await lint("src/some-application-query.ts", 'import { Pool } from "pg";\nvoid Pool;\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
  assert.equal(restricted.length, 1, `expected exactly one no-restricted-imports finding; got ${JSON.stringify(result.messages)}`);
  assert.match(restricted[0]?.message ?? "", /CBD-246-AC01/);
});

void test("CBD-246-AC01: driver.ts itself is exempt, so the seam can import pg", async () => {
  const result = await lint("src/driver.ts", 'import { Pool } from "pg";\nvoid Pool;\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
  assert.equal(restricted.length, 0, "driver.ts must be the one file allowed to import pg");
});

void test("CBD-246-AC01: a subpath pg import (pg/lib/...) is also refused outside driver.ts", async () => {
  const result = await lint("src/some-application-query.ts", 'import x from "pg/lib/connection.js";\nvoid x;\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
  assert.equal(restricted.length, 1);
});

void test("CBD246-REVIEW-001 medium finding: a dynamic import(\"pg\") outside driver.ts also fails lint", async () => {
  const result = await lint("src/some-application-query.ts", 'export async function load() { const { Pool } = await import("pg"); return Pool; }\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(restricted.length, 1, `expected exactly one no-restricted-syntax finding; got ${JSON.stringify(result.messages)}`);
  assert.match(restricted[0]?.message ?? "", /CBD-246-AC01/);
});

void test("CBD246-REVIEW-001 medium finding: a dynamic subpath import(\"pg/lib/...\") outside driver.ts also fails lint", async () => {
  const result = await lint("src/some-application-query.ts", 'export async function load() { return await import("pg/lib/connection.js"); }\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(restricted.length, 1);
});

void test("CBD246-REVIEW-001 medium finding: driver.ts itself is exempt from the dynamic-import rule too", async () => {
  const result = await lint("src/driver.ts", 'export async function load() { return await import("pg"); }\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(restricted.length, 0);
});
