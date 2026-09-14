import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "./driver.ts";
import { readOwnBudgetMemberships } from "./budget-memberships.ts";

void test("membership discovery binds the authenticated subject and rejects absent identity before SQL", async () => {
  let calls = 0;
  const pool = { query: async (sql: string, values: unknown[]) => {
    calls++; assert.match(sql, /WHERE account_subject_id = \$1 AND status = 'active'/u);
    assert.deepEqual(values, ["subject' OR true --"]); return { rows: [], rowCount: 0 };
  } } as unknown as Pool;
  await readOwnBudgetMemberships(pool, "subject' OR true --");
  await assert.rejects(readOwnBudgetMemberships(pool, "")); assert.equal(calls, 1);
});
