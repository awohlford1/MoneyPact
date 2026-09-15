/**
 * CBD-200-AC04 on the web client (PROTO-CBD200-CONCURRENCY-IDEMPOTENCY-001,
 * QA-F01): an edit or a removal states the version the client was shown as
 * its basis, and a `409 stale_version` refusal reaches the form as a
 * per-field message rather than a bare code. Driven through a recording
 * fetcher so the exact request bodies are asserted; the mock server is not
 * involved and is unchanged.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createHttpClient } from "./client.ts";

const SPACE = "11111111-1111-4111-8111-111111111111";
const TX = "22222222-2222-4222-8222-222222222222";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function version(transactionVersionId: string, revision: number) {
  return { transactionId: TX, transactionVersionId, revision, accountId: "acc", budgetDate: "2026-09-15", description: null };
}

function harness() {
  const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
  let respond: (url: string, method: string) => Response = () => Response.json({}, { status: 200 });
  const api = createHttpClient("/v1", (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined });
    if (url.endsWith("/identity/me")) return Response.json({ accountSubjectId: "s", csrfValue: "csrf", assurance: "ordinary" });
    return respond(url, method);
  }) as typeof fetch);
  return { api, calls, setRespond: (next: typeof respond) => { respond = next; } };
}

const draft = { accountId: "acc", amount: "9.00", budgetDate: "2026-09-15", description: "Milk", allocations: [{ categoryId: "cat", amount: "9.00" }] };

test("CBD-200-AC04: the client states the version it was shown, from the detail read or its own last write, and none when it has seen none", async () => {
  const { api, calls, setRespond } = harness();
  await api.me();
  setRespond(() => Response.json({ previous: null, current: { version: version(V1, 1), allocations: [] } }, { status: 200 }));
  // Never shown this expense: no precondition, exactly as before the field existed.
  await api.editExpense(SPACE, TX, draft, 2);
  assert.equal(calls.at(-1)!.body!.expectedTransactionVersionId, undefined, "no basis is stated for an expense the client has never seen");
  // The write's own result is now the basis.
  await api.editExpense(SPACE, TX, draft, 2);
  assert.equal(calls.at(-1)!.body!.expectedTransactionVersionId, V1);
  // A category detail read refreshes it.
  setRespond(() => Response.json({ budgetSpaceId: SPACE, periodId: "p", categoryId: "cat", label: "Groceries", currencyCode: "USD", minorUnitPrecision: 2, cell: null,
    items: [{ transactionId: TX, transactionVersionId: V2, accountId: "acc", budgetDate: "2026-09-15", description: "Milk", amountMinorUnits: -900, allocationCount: 1 }] }));
  const detail = await api.categoryDetail(SPACE, "p", "cat");
  assert.equal(detail.items[0]!.transactionVersionId, V2);
  setRespond(() => Response.json({ previous: null, current: { version: version(V2, 3), allocations: [] } }, { status: 201 }));
  await api.removeExpense(SPACE, TX);
  assert.deepEqual(calls.at(-1)!.body, { expectedTransactionVersionId: V2 }, "the removal states the basis the detail showed");
  assert.ok(calls.at(-1)!.url.endsWith(`/transactions/${TX}/remove`));
  // A removal forgets the basis; a caller may always state one explicitly, or state none.
  await api.editExpense(SPACE, TX, draft, 2);
  assert.equal(calls.at(-1)!.body!.expectedTransactionVersionId, undefined);
  await api.editExpense(SPACE, TX, draft, 2, V1);
  assert.equal(calls.at(-1)!.body!.expectedTransactionVersionId, V1);
  await api.editExpense(SPACE, TX, draft, 2, null);
  assert.equal(calls.at(-1)!.body!.expectedTransactionVersionId, undefined);
  // A detail row the server did not version yields no precondition rather than a fabricated one.
  setRespond(() => Response.json({ budgetSpaceId: SPACE, periodId: "p", categoryId: "cat", label: "Groceries", currencyCode: "USD", minorUnitPrecision: 2, cell: null,
    items: [{ transactionId: TX, accountId: "acc", budgetDate: "2026-09-15", description: "Milk", amountMinorUnits: -900, allocationCount: 1 }] }));
  assert.equal((await api.categoryDetail(SPACE, "p", "cat")).items[0]!.transactionVersionId, null);
});

test("CBD-200-AC04: a stale_version refusal reaches the form as a field error that says to refresh", async () => {
  const { api, setRespond } = harness();
  await api.me();
  setRespond(() => Response.json({ error: "stale_version", current: { transactionVersionId: V2, revision: 2 } }, { status: 409 }));
  await assert.rejects(api.editExpense(SPACE, TX, draft, 2, V1), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "stale_version");
    assert.equal(error.fieldErrors[0]?.path, "transactionId");
    assert.match(error.fieldErrors[0]?.message ?? "", /Refresh and try again/u);
    return true;
  });
  setRespond(() => Response.json({ error: "idempotency_mismatch" }, { status: 409 }));
  await assert.rejects(api.removeExpense(SPACE, TX), (error: unknown) => error instanceof ApiError && error.code === "idempotency_mismatch" && error.fieldErrors.length === 1);
});
