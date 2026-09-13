import assert from "node:assert/strict";
import { test } from "node:test";
import type { TableCatalog } from "./catalog.ts";
import type { Pool } from "./driver.ts";
import { StatementFailedError } from "./logging.ts";
import {
  MissingAccountSubjectError,
  profileDelete,
  profileInsert,
  profileSelect,
  profileUpdate,
  ReservedSubjectColumnError,
  UnknownProfileTableError,
} from "./profile.ts";
import { platformSelect, tenantSelect, UnknownPlatformTableError, UnknownTenantTableError } from "./tenant.ts";

const TEST_CATALOG: TableCatalog = {
  financial_profiles: "financial-profile",
  budget_line_items: "budget-space",
  identity_accounts: "identity",
};

function fakePool(): { pool: Pool; calls: { text: string; params: unknown }[] } {
  const calls: { text: string; params: unknown }[] = [];
  const pool = {
    query: (text: string, params?: unknown) => {
      calls.push({ text, params });
      return Promise.resolve({ rows: [], rowCount: 0 } as never);
    },
  } as unknown as Pool;
  return { pool, calls };
}

function rejectingPool(message: string): Pool {
  return { query: () => Promise.reject(new Error(message)) } as unknown as Pool;
}

void test("SM-212-01: profileSelect always binds the subject predicate as parameter one", async () => {
  const { pool, calls } = fakePool();
  await profileSelect(pool, {
    table: "financial_profiles",
    accountSubjectId: "subject-123",
    conditions: [{ column: "profile_id", value: "profile-1" }],
  }, TEST_CATALOG);
  assert.equal(calls[0]?.text, "select * from financial_profiles where account_subject_id = $1 and profile_id = $2");
  assert.deepEqual(calls[0]?.params, ["subject-123", "profile-1"]);
});

void test("SM-212-01: profileInsert binds account_subject_id from accountSubjectId", async () => {
  const { pool, calls } = fakePool();
  await profileInsert(pool, {
    table: "financial_profiles",
    accountSubjectId: "subject-123",
    values: { profile_id: "profile-1", profile_state: "active" },
    returning: ["profile_id"],
  }, TEST_CATALOG);
  assert.equal(calls[0]?.text, "insert into financial_profiles (account_subject_id, profile_id, profile_state) values ($1, $2, $3) returning profile_id");
  assert.deepEqual(calls[0]?.params, ["subject-123", "profile-1", "active"]);
});

void test("SM-212-01: profileUpdate and profileDelete always bind the subject predicate", async () => {
  const { pool, calls } = fakePool();
  await profileUpdate(pool, {
    table: "financial_profiles",
    accountSubjectId: "subject-123",
    set: { profile_state: "deleted" },
    conditions: [{ column: "profile_id", value: "profile-1" }],
  }, TEST_CATALOG);
  await profileDelete(pool, {
    table: "financial_profiles",
    accountSubjectId: "subject-123",
    conditions: [{ column: "profile_id", value: "profile-1" }],
  }, TEST_CATALOG);
  assert.equal(calls[0]?.text, "update financial_profiles set profile_state = $2 where account_subject_id = $1 and profile_id = $3");
  assert.deepEqual(calls[0]?.params, ["subject-123", "deleted", "profile-1"]);
  assert.equal(calls[1]?.text, "delete from financial_profiles where account_subject_id = $1 and profile_id = $2");
  assert.deepEqual(calls[1]?.params, ["subject-123", "profile-1"]);
});

void test("SM-212-01 negative: blank accountSubjectId fails before execution", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => profileSelect(pool, { table: "financial_profiles", accountSubjectId: "   " }, TEST_CATALOG),
    MissingAccountSubjectError,
  );
  assert.equal(calls.length, 0);
});

void test("SM-212-01 negative: a mismatched bound subject cannot override the predicate", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => profileSelect(pool, {
      table: "financial_profiles",
      accountSubjectId: "subject-123",
      conditions: [{ column: "account_subject_id", value: "subject-456" }],
    }, TEST_CATALOG),
    ReservedSubjectColumnError,
  );
  assert.equal(calls.length, 0);
});

void test("SM-212-01 negative: cross-subject reads and updates are refused", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => profileSelect(pool, {
      table: "financial_profiles",
      accountSubjectId: "subject-123",
      conditions: [{ column: "account_subject_id", value: "subject-456" }],
    }, TEST_CATALOG),
    ReservedSubjectColumnError,
  );
  assert.throws(
    () => profileUpdate(pool, {
      table: "financial_profiles",
      accountSubjectId: "subject-123",
      set: { account_subject_id: "subject-456" },
    }, TEST_CATALOG),
    ReservedSubjectColumnError,
  );
  assert.equal(calls.length, 0);
});

void test("SM-212-01 negative: profile statements refuse budget-space and identity tables", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => profileSelect(pool, { table: "budget_line_items", accountSubjectId: "subject-123" }, TEST_CATALOG),
    UnknownProfileTableError,
  );
  assert.throws(
    () => profileSelect(pool, { table: "identity_accounts", accountSubjectId: "subject-123" }, TEST_CATALOG),
    UnknownProfileTableError,
  );
  assert.equal(calls.length, 0);
});

void test("SM-212-01 negative: financial-profile tables cannot use tenant or platform paths", () => {
  const { pool, calls } = fakePool();
  assert.throws(
    () => tenantSelect(pool, { table: "financial_profiles", budgetSpaceId: "space-1" }, TEST_CATALOG),
    UnknownTenantTableError,
  );
  assert.throws(
    () => platformSelect(pool, { table: "financial_profiles" }, TEST_CATALOG),
    UnknownPlatformTableError,
  );
  assert.equal(calls.length, 0);
});

void test("SM-212-01: profile driver failures do not expose bound subject values", async () => {
  const canary = "subject-secret-212";
  await assert.rejects(
    () => profileSelect(rejectingPool(`driver echoed ${canary}`), {
      table: "financial_profiles",
      accountSubjectId: canary,
    }, TEST_CATALOG),
    (error: unknown) => error instanceof StatementFailedError && !error.message.includes(canary),
  );
});
