/**
 * CBD-200-F04, CBD-266-F04 (WF3-01, PROTO-WEB-FOLLOWUPS-003): the spending page holds one
 * Idempotency-Key per submission -- generated when the draft is submitted, reused on the client's
 * single 429 retry and on a caller's retry after a lost response, discarded once an answer of any
 * kind arrives -- and sends it on manual-transaction writes through the request helper's existing
 * `Idempotency-Key` header support. Driven through a recording fetcher, never the mock server.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SubmissionKey, createHttpClient } from "./client.ts";

const SPACE = "11111111-1111-4111-8111-111111111111";
const TX = "22222222-2222-4222-8222-222222222222";
const draft = { accountId: "acc", amount: "9.00", budgetDate: "2026-09-15", description: "Milk", allocations: [{ categoryId: "cat", amount: "9.00" }] };
const result = () => Response.json({ previous: null, current: { version: { transactionId: TX, transactionVersionId: "v1", revision: 1, accountId: "acc", budgetDate: "2026-09-15", description: null }, allocations: [] } }, { status: 201 });
const inFlight = (retryAfter = "1") => Response.json({ outcome: "retry", reason: "in_flight" }, { status: 429, headers: { "Retry-After": retryAfter } });

function harness(responses: (() => Response)[]) {
  const calls: { url: string; method: string; sentIdempotency: string | null }[] = []; const waits: number[] = [];
  const api = createHttpClient("/v1", (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, method: init?.method ?? "GET", sentIdempotency: headers?.["Idempotency-Key"] ?? null });
    if (url.endsWith("/identity/me")) return Response.json({ accountSubjectId: "s", csrfValue: "csrf", assurance: "ordinary" });
    return (responses.shift() ?? result)();
  }) as typeof fetch, async (ms) => { waits.push(ms); });
  return { api, calls, waits };
}

test("SubmissionKey: held across an unanswered attempt, released once any answer arrives, fresh for the next submission", () => {
  let n = 0;
  const key = new SubmissionKey(() => `key-${++n}`);
  const first = key.next();
  assert.equal(first, "key-1");
  // A retry after a lost response (no answer at all) reuses the held key.
  assert.equal(key.next(), "key-1");
  key.settle(false); // still no answer -- e.g. a network failure
  assert.equal(key.next(), "key-1", "the key survives a lost response");
  key.settle(true); // an answer arrived (success or a canonical refusal)
  assert.equal(key.next(), "key-2", "the next submission gets a fresh key");
});

test("WF3-01: recordExpense sends the caller's Idempotency-Key; the same key on a retry, a fresh key on the next submission", async () => {
  const { api, calls } = harness([result, result]);
  await api.me();
  let n = 0;
  const key = new SubmissionKey(() => `submission_key_${++n}`);
  const firstAttempt = key.next();
  await api.recordExpense(SPACE, draft, 2, firstAttempt);
  key.settle(true);
  const writes = () => calls.filter((call) => call.method === "POST" && call.url.endsWith("/transactions"));
  assert.equal(writes()[0]!.sentIdempotency, "submission_key_1");

  const secondAttempt = key.next();
  assert.equal(secondAttempt, "submission_key_2", "a fresh key once the first submission was answered");
  await api.recordExpense(SPACE, draft, 2, secondAttempt);
  assert.equal(writes()[1]!.sentIdempotency, "submission_key_2");
});

test("WF3-01: the client's own 429 retry resends the same Idempotency-Key (built into the request helper)", async () => {

