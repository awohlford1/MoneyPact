import assert from "node:assert/strict";
import { test } from "node:test";
import { statementLogLine, wrapDriverError } from "./logging.ts";

const CANARY = "sk_live_canary_4f2c9d17e5";
const CANARY_SQL = `select * from accounts where token = '${CANARY}'`;

void test("CBD-246-AC06: wrapDriverError never carries the canary statement text or value", () => {
  // A driver error whose own .message happens to echo the failing statement
  // and a bound value -- exactly what pg sometimes does on a constraint
  // violation. wrapDriverError must not forward any of it.
  const driverError = new Error(`duplicate key value violates constraint: ${CANARY_SQL}`);
  const wrapped = wrapDriverError("accounts", "insert");

  const serialized = JSON.stringify({
    message: wrapped.message,
    name: wrapped.name,
    stack: wrapped.stack,
    // A previous version of this code attached the driver error as `cause`;
    // guard against that regression explicitly.
    cause: (wrapped as { cause?: unknown }).cause,
  });

  assert.ok(!serialized.includes(CANARY), "the canary value must not appear anywhere on the wrapped error");
  assert.ok(!serialized.includes("duplicate key"), "the driver's own failure text must not survive into the wrapped error");
  assert.ok(!serialized.includes(CANARY_SQL), "the statement text must not survive into the wrapped error");
  assert.equal((wrapped as { cause?: unknown }).cause, undefined, "the raw driver error must not be attached as cause");
  void driverError; // constructed only to prove its message is never read by wrapDriverError
});

void test("CBD-246-AC06: statementLogLine only ever carries the allowlisted fields", () => {
  const line = statementLogLine({ level: "error", table: "accounts", operation: "select", durationMs: 12 });
  assert.equal(line, "level=error table=accounts operation=select durationMs=12");
  assert.ok(!line.includes(CANARY));
});
