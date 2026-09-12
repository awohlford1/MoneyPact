import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFileName, compareNames, formatOrdinal, isValidOrdinal, parseName, toSlug } from "./naming.ts";
import { loadPolicy } from "./policy.ts";

const policy = loadPolicy();
const pattern = policy.fileName.pattern;

test("a well formed name parses into an ordinal and a slug", () => {
  assert.deepEqual(parseName("20260912T163355Z__create_schema_migrations.sql", pattern), {
    ordinal: "20260912T163355Z",
    slug: "create_schema_migrations",
    fileName: "20260912T163355Z__create_schema_migrations.sql",
  });
});

test("names the pattern must refuse", () => {
  for (const name of [
    "0001_initial.sql",
    "20260912__missing_time.sql",
    "20260912T163355Z-single-dash.sql",
    "20260912T163355Z__Capitals.sql",
    "20260912T163355Z__trailing_.sql",
    "20260912T163355Z__create.txt",
    "20260912T163355Z__create.down.sql",
  ]) {
    assert.equal(parseName(name, pattern), undefined, name);
  }
});

test("an ordinal must be a real UTC instant, not fourteen digits", () => {
  assert.ok(isValidOrdinal("20260912T163355Z"));
  assert.ok(isValidOrdinal("20240229T000000Z"), "2024 is a leap year");
  assert.ok(!isValidOrdinal("20260231T000000Z"), "February has no 31st");
  assert.ok(!isValidOrdinal("20230229T000000Z"), "2023 is not a leap year");
  assert.ok(!isValidOrdinal("20260912T256100Z"));
  assert.ok(!isValidOrdinal("20261301T000000Z"));
});

test("ordering is lexicographic and therefore the same on every machine", () => {
  const names = [
    "20260912T163355Z__b.sql",
    "20251231T235959Z__a.sql",
    "20260101T000000Z__c.sql",
  ].map((name) => parseName(name, pattern));
  assert.ok(names.every((name) => name !== undefined));
  const sorted = [...names as NonNullable<(typeof names)[number]>[]].sort(compareNames);
  assert.deepEqual(sorted.map((name) => name.slug), ["a", "c", "b"]);
});

test("formatOrdinal and buildFileName round-trip through parseName", () => {
  const instant = new Date(Date.UTC(2026, 8, 12, 16, 33, 55));
  assert.equal(formatOrdinal(instant), "20260912T163355Z");
  const fileName = buildFileName(instant, "add_budget_space");
  assert.deepEqual(parseName(fileName, pattern)?.slug, "add_budget_space");
});

test("toSlug produces something the pattern accepts", () => {
  assert.equal(toSlug("Add budget space table!"), "add_budget_space_table");
  assert.equal(toSlug("  --  "), "");
  assert.ok(parseName(buildFileName(new Date(0), toSlug("Add Plaid item")), pattern));
});
