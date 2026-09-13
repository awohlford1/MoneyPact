/**
 * CBD-246-AC02 negative fixture: a statement missing `budgetSpaceId` must
 * fail at compile time.
 *
 * `@ts-expect-error` asserts the next statement is a type error. If
 * `TenantSelectQuery.budgetSpaceId` (or any other tenant query's) is ever
 * loosened to optional, this line stops being an error, `@ts-expect-error`
 * becomes an "unused directive" error in its place, and `npm run typecheck`
 * fails -- so the fixture proves the rule by construction rather than by a
 * human re-reading it.
 *
 * This file contains no runnable assertions; it exists to be type-checked.
 * `node --test` only executes it because `tsx`/Node's type-stripping runtime
 * erases the `@ts-expect-error` comment as a plain comment at execution time,
 * so it is harmless at runtime and load-bearing only at `tsc --noEmit`.
 */
import { test } from "node:test";
import type { TenantInsertQuery, TenantSelectQuery } from "./tenant.ts";

void test("CBD-246-AC02 negative fixture: budgetSpaceId cannot be omitted from a tenant select (compile-time)", () => {
  // @ts-expect-error CBD-246-AC02: budgetSpaceId is required for every tenant-scoped query.
  const missingBudgetSpace: TenantSelectQuery = {
    table: "budget_line_items",
  };
  void missingBudgetSpace;
});

void test("CBD-246-AC02 negative fixture: budgetSpaceId cannot be omitted from a tenant insert (compile-time)", () => {
  // @ts-expect-error CBD-246-AC02: budgetSpaceId is required for every tenant-scoped query.
  const missingBudgetSpace: TenantInsertQuery = {
    table: "budget_line_items",
    values: { name: "groceries" },
  };
  void missingBudgetSpace;
});
