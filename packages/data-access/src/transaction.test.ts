import assert from "node:assert/strict";
import { test } from "node:test";
import { bindClient } from "./binding.ts";
import type { DataAccessClient } from "./client.ts";
import type { Pool } from "./driver.ts";
import { isRetryableSqlState, StatementFailedError, wrapDriverError } from "./logging.ts";

function fixture(fail?: string) {
  const calls: string[] = [];
  let checkouts = 0;
  const connection = {
    query: async (text: string) => {
      calls.push(text);
      if (text === fail) throw Object.assign(new Error("private driver detail"), { code: "23503" });
      return { rows: [], rowCount: 0 };
    },
    release: () => calls.push("release"),
  };
  const pool = { connect: async () => { checkouts++; return connection; }, query: async () => { throw new Error("pool bypass"); } } as unknown as Pool;
  return { client: bindClient(pool, true, { items: "budget-space", subjects: "identity", profiles: "financial-profile" }), calls, checkouts: () => checkouts };
}

void test("transaction binds tenant/platform/profile operations to one connection and closes scope", async () => {
  const f = fixture(); let saved: DataAccessClient | undefined;
  assert.equal(await f.client.transaction({}, async (scoped) => {
    saved = scoped;
    assert.equal("pool" in scoped, false);
    await scoped.tenantInsert({ table: "items", budgetSpaceId: "budget", values: { id: "one" } });
    await scoped.platformSelect({ table: "subjects" });
    await scoped.profileSelect!({ table: "profiles", accountSubjectId: "subject" });
    await assert.rejects(scoped.transaction({}, async () => undefined), /nested/);
    return "result";
  }), "result");
  assert.equal(f.checkouts(), 1);
  assert.equal(f.calls[0], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.deepEqual(f.calls.slice(-2), ["COMMIT", "release"]);
  await assert.rejects(async () => saved!.platformSelect({ table: "subjects" }));
});

void test("callback failure rolls back; read committed is explicit", async () => {
  const f = fixture();
  await assert.rejects(f.client.transaction({ isolation: "read committed" }, async () => { throw new Error("application failure"); }), /application failure/);
  assert.deepEqual(f.calls, ["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK", "release"]);
});

void test("deferred constraint failure at COMMIT is redacted and rolls back", async () => {
  const f = fixture("COMMIT");
  await assert.rejects(f.client.transaction({}, async () => "not committed"), (error: unknown) => {
    assert.ok(error instanceof StatementFailedError);
    assert.equal(error.sqlState, "23503");
    assert.equal(JSON.stringify(error).includes("private"), false);
    return true;
  });
  assert.deepEqual(f.calls.slice(-3), ["COMMIT", "ROLLBACK", "release"]);
});

void test("catching a failed statement in work cannot turn an aborted transaction into success", async () => {
  const f = fixture("select * from subjects");
  await assert.rejects(f.client.transaction({}, async (scoped) => {
    try { await scoped.platformSelect({ table: "subjects" }); } catch { /* Caller attempts to continue. */ }
    return "false success";
  }), StatementFailedError);
  assert.equal(f.calls.includes("COMMIT"), false);
  assert.deepEqual(f.calls.slice(-2), ["ROLLBACK", "release"]);
});

void test("only five-character SQLSTATE survives driver wrapping and retry classification is closed", () => {
  for (const code of ["23505", "40001", "40P01"]) assert.equal(isRetryableSqlState(code), true);
  for (const code of [undefined, "23503", "private detail", "40001 private"]) assert.equal(isRetryableSqlState(code), false);
  assert.equal(wrapDriverError("items", "insert", { code: "23505", message: "private" }).sqlState, "23505");
  assert.equal(wrapDriverError("items", "insert", { code: "23505 private" }).sqlState, undefined);
});
