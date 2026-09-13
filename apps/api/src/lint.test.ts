/**
 * CBD246-SECURITY-002 finding 2: `no-restricted-imports` only sees a static
 * `import "pg"`; a dynamic `await import("pg")` reached the driver
 * untouched, bypassing CBD-246-AC01's rule that this application never talks
 * to Postgres directly. This loads this workspace's own `eslint.config.mjs`
 * -- the config `npm run lint` actually runs -- and lints a fixture string
 * through it. The fixture never touches disk (`ESLint#lintText` takes a
 * virtual `filePath`), so it cannot itself make `eslint .` fail; only this
 * assertion exercises it.
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

void test("CBD246-SECURITY-002 finding 2: a dynamic import(\"pg\") fails lint", async () => {
  const result = await lint("src/config.ts", 'export async function load() { const { Pool } = await import("pg"); return Pool; }\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(restricted.length, 1, `expected exactly one no-restricted-syntax finding; got ${JSON.stringify(result.messages)}`);
});

void test("CBD246-SECURITY-002 finding 2: a dynamic subpath import(\"pg/lib/...\") also fails lint", async () => {
  const result = await lint("src/config.ts", 'export async function load() { return await import("pg/lib/connection.js"); }\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(restricted.length, 1);
});

void test("a static import \"pg\" still fails lint through the existing no-restricted-imports rule", async () => {
  const result = await lint("src/config.ts", 'import { Pool } from "pg";\nvoid Pool;\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
  assert.equal(restricted.length, 1, `expected exactly one no-restricted-imports finding; got ${JSON.stringify(result.messages)}`);
});

void test("an unrelated dynamic import is unaffected", async () => {
  const result = await lint("src/config.ts", 'export async function load() { return await import("node:path"); }\n');
  assert.ok(result, "eslint produced no result for the fixture");
  const restricted = result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
  assert.equal(restricted.length, 0);
});
