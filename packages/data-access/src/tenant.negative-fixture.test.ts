/**
 * CBD-246-AC02 negative fixture: a statement missing `budgetSpaceId` must
 * fail at compile time. CBD-237-AC02 ("omission cannot compile, validate,
 * or execute") extends the same fixture to the whole tenant surface.
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
import type { OrderTerm, TenantCountQuery, TenantDeleteQuery, TenantInsertQuery, TenantJoin, TenantSelectQuery, TenantUpdateQuery } from "./tenant.ts";

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

// ---------------------------------------------------------------------------
// CBD-237-AC02: "omission cannot compile". The CBD-246 fixtures above cover
// select and insert; these close the rest of the tenant surface, including
// the two shapes CBD-237 added, and prove there is no second field through
// which a caller could supply a joined table's scope.
// ---------------------------------------------------------------------------

void test("CBD-237-AC02 negative fixture: budgetSpaceId cannot be omitted from a tenant update (compile-time)", () => {
  // @ts-expect-error CBD-237-AC02: budgetSpaceId is required for every tenant-scoped query.
  const missingBudgetSpace: TenantUpdateQuery = {
    table: "budget_line_items",
    set: { name: "rent" },
  };
  void missingBudgetSpace;
});

void test("CBD-237-AC02 negative fixture: budgetSpaceId cannot be omitted from a tenant delete (compile-time)", () => {
  // @ts-expect-error CBD-237-AC02: budgetSpaceId is required for every tenant-scoped query.
  const missingBudgetSpace: TenantDeleteQuery = {
    table: "budget_line_items",
  };
  void missingBudgetSpace;
});

void test("CBD-237-AC02 negative fixture: budgetSpaceId cannot be omitted from a tenant count (compile-time)", () => {
  // @ts-expect-error CBD-237-AC02: budgetSpaceId is required for every tenant-scoped query.
  const missingBudgetSpace: TenantCountQuery = {
    table: "budget_line_items",
  };
  void missingBudgetSpace;
});

void test("CBD-237-AC06 negative fixture: a join carries no scope of its own -- the joined table is bound to the statement's single budgetSpaceId (compile-time)", () => {
  const join: TenantJoin = {
    table: "budget_categories",
    on: { column: "category_id", references: "category_id" },
    // @ts-expect-error CBD-237-AC06: there is no per-join budgetSpaceId; the module scopes every joined table to the statement's own.
    budgetSpaceId: "space-b",
  };
  void join;
});

void test("CBD-237-AC05 negative fixture: order direction is the closed asc/desc set, never text (compile-time)", () => {
  // @ts-expect-error CBD-237-AC05: direction is "asc" | "desc".
  const term: OrderTerm = { column: "amount", direction: "desc; drop table x" };
  void term;
});
