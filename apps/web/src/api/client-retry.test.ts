/**
 * EXEC-POV-C200F01-001 item 3 on the web client (PROTO-CBD266-CONCURRENCY-429-001,
 * G429-02): a 429 on a mutation -- the CBD-266 concurrency answer for this same
 * session's still-saving earlier change, `{outcome: "retry", reason: "in_flight"}`
 * with `Retry-After` -- is retried exactly once after the server's Retry-After and
 * otherwise reaches the form as `in_flight` with a "try again" sentence, never as
 * a denial. Driven through a recording fetcher and a recording wait so the exact
 * request count and delay are asserted; the mock server is not involved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createHttpClient, IN_FLIGHT_MESSAGE, fieldErrorFor, retryAfterMs } from "./client.ts";

const SPACE = "11111111-1111-4111-8111-111111111111";
const TX = "22222222-2222-4222-8222-222222222222";
const draft = { accountId: "acc", amount: "9.00", budgetDate: "2026-09-15", description: "Milk", allocations: [{ categoryId: "cat", amount: "9.00" }] };
const result = () => Response.json({ previous: null, current: { version: { transactionId: TX, transactionVersionId: "v", revision: 1, accountId: "acc", budgetDate: "2026-09-15", description: null }, allocations: [] } }, { status: 200 });
const inFlight = (retryAfter?: string) => Response.json({ outcome: "retry", reason: "in_flight" }, { status: 429, headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter } });

function harness(responses: (() => Response)[]) {
  const calls: { url: string; method: string }[] = []; const waits: number[] = [];
  const api = createHttpClient("/v1", (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/identity/me")) return Response.json({ accountSubjectId: "s", csrfValue: "csrf", assurance: "ordinary" });
    return (responses.shift() ?? result)();
  }) as typeof fetch, async (ms) => { waits.push(ms); });
  return { api, calls, waits };
}

test("G429-02: a 429 on a mutation is retried once after Retry-After, and the retry's result is the caller's", async () => {
  const { api, calls, waits } = harness([() => inFlight("1")]);
  await api.me();
  const edited = await api.editExpense(SPACE, TX, draft, 2);
  assert.equal(edited.revision, 1);
  assert.deepEqual(calls.filter((c) => c.method === "PATCH").length, 2, "exactly one retry");
  assert.deepEqual(waits, [1000], "waited the server's Retry-After once");
});

test("G429-02: a second 429 is not retried again; it reaches the form as in_flight with a try-again sentence, never a denial", async () => {
  const { api, calls, waits } = harness([() => inFlight("1"), () => inFlight("1")]);
  await api.me();
  const error = await api.editExpense(SPACE, TX, draft, 2).then(() => assert.fail("expected a refusal"), (e: unknown) => e);
  assert.ok(error instanceof ApiError); assert.equal(error.status, 429); assert.equal(error.code, "in_flight");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 2, "one retry, then the refusal is surfaced");
  assert.deepEqual(waits, [1000]);
  assert.equal(fieldErrorFor(error).message, IN_FLIGHT_MESSAGE);
  assert.match(IN_FLIGHT_MESSAGE, /try again/i); assert.doesNotMatch(IN_FLIGHT_MESSAGE, /unavailable/i);
});

test("G429-02: a 403 on a mutation is not retried and keeps its code; a 429 with no or an unusable Retry-After waits the bounded default", async () => {
  const denied = harness([() => Response.json({ outcome: "deny", reason: "denied" }, { status: 403 })]);
  await denied.api.me();
  const error = await denied.api.editExpense(SPACE, TX, draft, 2).then(() => assert.fail("expected a refusal"), (e: unknown) => e);
  assert.ok(error instanceof ApiError); assert.equal(error.status, 403); assert.equal(error.code, "request_failed");
  assert.equal(denied.calls.filter((c) => c.method === "PATCH").length, 1, "a denial is never retried"); assert.deepEqual(denied.waits, []);
  assert.equal(retryAfterMs(null), 1000); assert.equal(retryAfterMs("nonsense"), 1000); assert.equal(retryAfterMs("0"), 1000);
  assert.equal(retryAfterMs("3"), 3000); assert.equal(retryAfterMs("600"), 5000, "bounded so a client never sleeps on a hostile header");
  const bare = harness([() => inFlight()]);
  await bare.api.me(); await bare.api.editExpense(SPACE, TX, draft, 2);
  assert.deepEqual(bare.waits, [1000]);
});
