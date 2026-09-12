/**
 * Every rule, proved against a fixture that breaks the thing it protects.
 *
 * The fixtures are real directories of real .sql files run through the same
 * `checkCatalog` the repository's own migrations go through, because a rule
 * proved against a string literal in a test is a rule proved against a string
 * literal in a test.
 *
 * Each fixture directory asserts the exact set of rule ids it produces, not
 * merely that it produces something. A fixture that fails for the wrong reason
 * is a guard nobody has actually tested.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { readCatalog } from "../catalog.ts";
import { loadPolicy } from "../policy.ts";
import { checkCatalog, checkFixtureDirectory, checkRepository, formatFindings, manifestOf } from "./index.ts";
import { encodingFindings, parseColumn, normalizeType, typedSqlLayerFindings } from "./rules.ts";

const policy = loadPolicy();
const fixtures = fileURLToPath(new URL("../../fixtures/", import.meta.url));

function ruleIds(directory: string): string[] {
  return [...new Set(checkFixtureDirectory(directory, policy).map((item) => item.rule))].sort();
}

/**
 * Fixture identifier -> the rules it must fail.
 *
 * CBD-116-AC08 asks for fixture identifiers in the completion record; these
 * directory names are them.
 */
const NEGATIVE: Readonly<Record<string, readonly string[]>> = {
  "cbd-116-fx-01-contract-step-missing-header": ["contract-step"],
  "cbd-116-fx-02-contract-step-unknown-expand": ["contract-step"],
  "cbd-116-fx-03-contract-step-unversioned-reader": ["contract-step"],
  "cbd-116-fx-04-monetary-floating-point": ["forbidden-type", "monetary-type"],
  "cbd-116-fx-05-monetary-money-type": ["forbidden-type", "monetary-type"],
  "cbd-116-fx-06-monetary-no-currency-code": ["monetary-currency"],
  "cbd-116-fx-07-timestamp-without-time-zone": ["forbidden-type"],
  "cbd-116-fx-08-budget-space-without-column": ["budget-space-column"],
  "cbd-116-fx-09-missing-scope-annotation": ["table-scope"],
  "cbd-116-fx-10-duplicate-ordinal": ["duplicate-ordinal"],
  "cbd-116-fx-11-unparsable-file-name": ["file-name"],
  "cbd-116-fx-12-down-migration-file": ["file-name", "forward-only"],
  "cbd-116-fx-13-reversion-directive": ["forward-only"],
  "cbd-116-fx-14-transaction-control": ["transaction-control"],
  "cbd-116-fx-15-non-sql-migration": ["file-name", "schema-owner"],
};

test("every negative fixture directory on disk is registered here", () => {
  const onDisk = readdirSync(join(fixtures, "negative"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(onDisk, Object.keys(NEGATIVE).sort(),
    "a fixture nobody asserts against is a fixture that proves nothing");
});

for (const [fixture, expected] of Object.entries(NEGATIVE)) {
  test(`${fixture} fails exactly ${expected.join(", ")}`, () => {
    const findings = checkFixtureDirectory(join(fixtures, "negative", fixture), policy);
    assert.ok(findings.length > 0, `${fixture} produced no findings:\n${formatFindings(findings)}`);
    assert.deepEqual(ruleIds(join(fixtures, "negative", fixture)), [...expected].sort(),
      `unexpected rules for ${fixture}:\n${formatFindings(findings)}`);
    for (const item of findings) {
      assert.match(item.criterion, /^CBD-116-AC0\d$/u, "every finding names the criterion it serves");
      assert.ok(item.message.length > 20, "every finding explains itself");
    }
  });
}

test("the positive fixture produces no findings at all", () => {
  const findings = checkFixtureDirectory(join(fixtures, "positive"), policy);
  assert.deepEqual(findings, [], formatFindings(findings));
});

test("the repository's own migrations pass the check", () => {
  const findings = checkRepository(policy);
  assert.deepEqual(findings, [], formatFindings(findings));
});

test("the repository has at least the ledger migration", () => {
  const catalog = readCatalog(join(fileURLToPath(new URL("../../", import.meta.url)), "migrations"), policy);
  assert.ok(catalog.files.some((file) => file.source.includes(`CREATE TABLE ${policy.ledgerTable}`)),
    "the applied-state table must be established by a migration, not by a bootstrap step");
  assert.deepEqual(catalog.unparsed, []);
});

// ---------------------------------------------------------------------------
// Rules whose negative case is a byte sequence or a manifest rather than SQL,
// so the fixture is built here rather than committed.
// ---------------------------------------------------------------------------

function writeTemporary(name: string, bytes: Buffer): string {
  const directory = mkdtempSync(join(tmpdir(), "cbd-116-"));
  writeFileSync(join(directory, name), bytes);
  return directory;
}

test("CBD-116-FX-18: a byte order mark is rejected", () => {
  const source = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("-- scope: platform\nCREATE TABLE a (id uuid);\n", "utf8"),
  ]);
  const directory = writeTemporary("20260401T000000Z__bom.sql", source);
  assert.deepEqual(ruleIds(directory), ["encoding"]);
});

test("CBD-116-FX-19: a file with no trailing newline is rejected", () => {
  const directory = writeTemporary(
    "20260401T000000Z__no_newline.sql",
    Buffer.from("-- scope: platform\nCREATE TABLE a (id uuid);", "utf8"),
  );
  assert.deepEqual(ruleIds(directory), ["encoding"]);
});

test("CBD-116-FX-20: invalid UTF-8 is rejected", () => {
  const directory = writeTemporary(
    "20260401T000000Z__latin1.sql",
    Buffer.concat([Buffer.from("-- caf", "utf8"), Buffer.from([0xe9]), Buffer.from("\nSELECT 1;\n", "utf8")]),
  );
  assert.deepEqual(ruleIds(directory), ["encoding"]);
});

test("CBD-116-FX-21: mixed line endings inside one file are rejected", () => {
  const file = {
    fileName: "20260401T000000Z__mixed.sql",
    source: "-- scope: platform\r\nCREATE TABLE a (id uuid);\n",
    bytes: Buffer.from("-- scope: platform\r\nCREATE TABLE a (id uuid);\n", "utf8"),
  };
  const findings = encodingFindings(file, policy);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /mixes line endings/u);
});

test("a uniformly CRLF file is not a finding, because git makes one", () => {
  const text = "-- scope: platform\r\nCREATE TABLE a (id uuid);\r\n";
  assert.deepEqual(encodingFindings({
    fileName: "20260401T000000Z__crlf.sql",
    source: text,
    bytes: Buffer.from(text, "utf8"),
  }, policy), []);
});

test("CBD-116-FX-22: an ORM that owns the schema is rejected as a dependency", () => {
  const findings = typedSqlLayerFindings({ dependencies: { prisma: "^6.0.0" } }, [], policy);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, "schema-owner");
  assert.equal(findings[0]?.criterion, "CBD-116-AC06");
});

test("this package declares no schema-owning ORM", () => {
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  assert.deepEqual(typedSqlLayerFindings(manifestOf(packageRoot), [], policy), []);
});

// ---------------------------------------------------------------------------
// Unit checks on the column parser the schema rules depend on.
// ---------------------------------------------------------------------------

test("a column definition parses into a name and a normalised type", () => {
  assert.deepEqual(parseColumn("amount_minor bigint NOT NULL")?.type, "bigint");
  assert.deepEqual(parseColumn("created_at timestamptz NOT NULL DEFAULT now()")?.type, "timestamptz");
  assert.deepEqual(parseColumn("rate double precision")?.type, "double precision");
  assert.deepEqual(parseColumn("code varchar(3)")?.type, "varchar");
  assert.deepEqual(parseColumn("tags text[]")?.type, "text");
  assert.deepEqual(parseColumn("id bigint GENERATED ALWAYS AS IDENTITY")?.type, "bigint");
});

test("a table constraint is not mistaken for a column", () => {
  assert.equal(parseColumn("PRIMARY KEY (id)"), undefined);
  assert.equal(parseColumn("CONSTRAINT uq UNIQUE (a, b)"), undefined);
  assert.equal(parseColumn("FOREIGN KEY (a) REFERENCES t (id)"), undefined);
  assert.equal(parseColumn("CHECK (a > 0)"), undefined);
});

test("normalizeType collapses modifiers and case", () => {
  assert.equal(normalizeType("  NUMERIC ( 12 , 2 ) "), "numeric");
  assert.equal(normalizeType("TIMESTAMP  WITH   TIME ZONE"), "timestamp with time zone");
});

test("checkCatalog reports nothing for an empty directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "cbd-116-empty-"));
  assert.deepEqual(checkCatalog(readCatalog(directory, policy), policy, { name: "empty" }), []);
});
