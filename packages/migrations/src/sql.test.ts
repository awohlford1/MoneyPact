import assert from "node:assert/strict";
import { test } from "node:test";

import { matchParen, precedingComments, splitTopLevel, strip } from "./sql.ts";

test("comments are removed from the code and returned separately", () => {
  const source = "-- a note\nSELECT 1; /* block */ SELECT 2;\n";
  const { code, comments } = strip(source);
  assert.equal(code.length, source.length, "offsets must survive stripping");
  assert.ok(!code.includes("note"));
  assert.ok(!code.includes("block"));
  assert.deepEqual(comments.map((comment) => comment.text), ["a note", "block"]);
  assert.deepEqual(comments.map((comment) => comment.line), [1, 2]);
});

test("a word inside a comment cannot trip a rule that reads the code", () => {
  // The reason strip exists. Without it, "DROP COLUMN" in prose fails a clean
  // migration and "money" in prose fails a clean column.
  const { code } = strip("-- we used to DROP COLUMN amount as money here\nSELECT 1;\n");
  assert.ok(!/DROP\s+COLUMN/u.test(code));
  assert.ok(!/\bmoney\b/u.test(code));
});

test("a word inside a string literal cannot trip a rule either", () => {
  const { code } = strip("INSERT INTO t VALUES ('DROP TABLE money');\n");
  assert.ok(!/DROP\s+TABLE/u.test(code));
  assert.ok(!/\bmoney\b/u.test(code));
  assert.ok(code.includes("INSERT INTO t VALUES ("));
});

test("doubled quotes do not end a literal early", () => {
  const { code } = strip("SELECT 'it''s money' , 1;\n");
  assert.ok(!/\bmoney\b/u.test(code));
  assert.ok(code.trimEnd().endsWith(", 1;"));
});

test("dollar-quoted bodies are opaque", () => {
  const { code } = strip("DO $x$ BEGIN DROP TABLE t; END $x$;\n");
  assert.ok(!/DROP\s+TABLE/u.test(code));
});

test("quoted identifiers keep their name and lose their quotes", () => {
  const { code } = strip('CREATE TABLE "budget space" ("budget_space_id" uuid);\n');
  assert.ok(code.includes("budget_space_id"));
  assert.ok(!code.includes('"'));
});

test("block comments nest, as PostgreSQL allows", () => {
  const { code } = strip("/* outer /* inner */ still comment */ SELECT 1;\n");
  assert.equal(code.trim(), "SELECT 1;");
});

test("precedingComments stops at the first non-comment text", () => {
  const source = "-- scope: platform\nCREATE TABLE a (id uuid);\n\n-- unrelated\n\nSELECT 1;\nCREATE TABLE b (id uuid);\n";
  const { comments } = strip(source);
  const second = source.indexOf("CREATE TABLE b");
  assert.deepEqual(precedingComments(source, comments, second).map((c) => c.text), []);
  const first = source.indexOf("CREATE TABLE a");
  assert.deepEqual(precedingComments(source, comments, first).map((c) => c.text), ["scope: platform"]);
});

test("matchParen and splitTopLevel respect nesting", () => {
  const code = "CREATE TABLE t (a int, b numeric(10, 2), c text);";
  const open = code.indexOf("(");
  const close = matchParen(code, open);
  assert.equal(code.slice(close), ");");
  assert.deepEqual(splitTopLevel(code.slice(open + 1, close)), ["a int", "b numeric(10, 2)", "c text"]);
});
