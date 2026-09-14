/**
 * PROTO-ACTIVATION-001 A3 (review R03) and A4 (SEC-ACT-F02 / RC-02) closing tests.
 *
 * A3: the reviewer's reproduction -- a bootstrap confirmation whose COMMIT fails with a serialization
 * class (40001) after the boundary buffered its allow event, where the creation store then recovers the
 * *previously committed* winner through the idempotency lookup and returns it as the response. The
 * losing attempt's handle rolled back: its pending allow event must be discarded, never flushed on the
 * strength of the winner-shaped response. Before A3, dispatch flushed it (flushed=1, discarded=0).
 *
 * A4: a builder that succeeds at buffer time and throws on any later invocation. Before A4 the store
 * re-ran the builder after the database committed (committed=1, auditEvents=0, reserved=1); now the
 * content is prepared once before COMMIT and published unchanged afterwards.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataAccessClient } from "@cobudget/data-access";
import { StatementFailedError } from "../../../../packages/data-access/src/logging.ts";
import { requestDigest } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import type { ConfirmBudgetCreationResponse, CreationPlan } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import { CreationAuthorizationStore } from "../budget-creation/transaction-store.js";
import { RouteFailure } from "../authorization/http.js";
import { runWithAction } from "./action-scope.ts";
import { InProcessRestrictedAuditStore } from "./audit.ts";
import { DispatchingTransactionStore } from "./dispatch.ts";
import { ApiTransactionStore } from "./transaction-store.ts";

const build = (label: string) => (sequence: number, previousEventDigest: string) => ({ eventId: label, outcome: "allow" as const, sequence, previousEventDigest, eventDigest: "0".repeat(64) });

describe("PROTO-ACTIVATION-001 A3: dispatch flushes exactly the handles the package store reports committed", () => {
  it("a recovered replay after a failed COMMIT (the reviewer's fault injection) discards the losing attempt's pending allow event", async () => {
    const context = { environment: "test", subjectId: "subject", profileId: "profile", accountId: "account", sessionGeneration: 1 };
    const request = { proposalId: "bcp_" + "a".repeat(32), confirmationBinding: "binding", confirmationIdempotencyKey: "1111111111111111" };
    const winner = { confirmationOutcomeId: "winner", budgetSpaceId: "candidate" } as ConfirmBudgetCreationResponse;
    const handles: object[] = [];
    let attempts = 0;
    const client = {
      transaction: async (_options: unknown, work: (client: DataAccessClient) => Promise<unknown>) => {
        attempts++;
        const scoped = { attempt: attempts } as unknown as DataAccessClient;
        handles.push(scoped);
        await work(scoped);
        // The work ran to completion (its allow event is buffered), then COMMIT fails with a serialization error.
        throw new StatementFailedError("transaction", "commit", "40001");
      },
      platformSelect: async () => ({ rows: [{ candidate_budget_space_id: "candidate" }] }),
      tenantSelect: async () => ({ rows: [{ request_digest: requestDigest(request), committed_response: winner }] }),
    } as unknown as DataAccessClient;
    const audit = new InProcessRestrictedAuditStore();
    const creation = new CreationAuthorizationStore(client, 3);
    const dispatch = new DispatchingTransactionStore(new ApiTransactionStore({} as DataAccessClient, audit), audit, [
      { actions: ["space.create"], store: creation, observe: (outcomes) => creation.observe(outcomes) },
    ]);
    const response = await runWithAction("space.create", () => dispatch.transaction(async (transaction) => {
      creation.recordPlan(transaction as DataAccessClient, { context, request } as unknown as CreationPlan);
      await audit.append(build("losing-attempt"), transaction);
      return { confirmationOutcomeId: "attempt" };
    }));
    assert.deepEqual(response, winner, "the creation store recovered the previously committed winner as the response");
    assert.equal(attempts, 1);
    assert.equal(audit.length, 0, "the losing attempt's allow event was discarded, not flushed on the strength of the winner-shaped response");
    assert.equal(audit.reserved, 0, "its reservation was released");
  });

  it("a handle the store reports committed is flushed once; a rolled-back RouteFailure handle and an unreported handle are discarded", async () => {
    const audit = new InProcessRestrictedAuditStore();
    const reports: { committed: (handle: object) => void; rolledBack: (handle: object) => void }[] = [];
    let mode: "commit" | "fail" | "silent" = "commit";
    const store = {
      transaction: async <T>(work: (transaction: unknown) => Promise<T>): Promise<T> => {
        const handle = {};
        const result = await work(handle);
        if (mode === "commit") reports[0]!.committed(handle);
        if (mode === "fail") { reports[0]!.rolledBack(handle); return new RouteFailure(409, "conflict") as T; }
        return result;
      },
      discharge: async () => true,
      verify: async () => true,
    };
    const dispatch = new DispatchingTransactionStore(new ApiTransactionStore({} as DataAccessClient, audit), audit, [{ actions: ["2a.edit_target"], store, observe: (outcomes) => reports.push(outcomes) }]);
    await runWithAction("2a.edit_target", () => dispatch.transaction(async (transaction) => { await audit.append(build("committed"), transaction); return "ok"; }));
    assert.equal(audit.length, 1);
    mode = "fail";
    await runWithAction("2a.edit_target", () => dispatch.transaction(async (transaction) => { await audit.append(build("rolled-back"), transaction); return "ok"; }));
    assert.equal(audit.length, 1); assert.equal(audit.reserved, 0);
    mode = "silent";
    await runWithAction("2a.edit_target", () => dispatch.transaction(async (transaction) => { await audit.append(build("unreported"), transaction); return "ok"; }));
    assert.equal(audit.length, 1, "a handle whose fate was never reported is treated as rolled back");
    assert.equal(audit.reserved, 0);
  });
});

describe("PROTO-ACTIVATION-001 A4: audit content is prepared before COMMIT and published unchanged after it", () => {
  it("a builder that faults on its second invocation cannot produce committed=1, auditEvents=0", async () => {
    const audit = new InProcessRestrictedAuditStore();
    let invocations = 0;
    const faulty = (sequence: number, previousEventDigest: string) => {
      invocations++;
      if (invocations > 1) throw new Error("second invocation fault");
      return { eventId: "once", outcome: "allow" as const, sequence, previousEventDigest, eventDigest: "0".repeat(64) };
    };
    let committed = 0;
    const client = { transaction: async (_options: unknown, work: (scoped: unknown) => Promise<unknown>) => { const result = await work({}); committed++; return result; } } as unknown as DataAccessClient;
    const store = new ApiTransactionStore(client, audit);
    await store.transaction(async (transaction) => { await audit.append(faulty, transaction); return "ok"; });
    assert.equal(committed, 1);
    assert.equal(invocations, 1, "the builder ran exactly once, before COMMIT");
    assert.equal(audit.length, 1, "the prepared event was published after COMMIT");
    assert.equal(audit.reserved, 0);
    const [event] = audit.snapshot();
    assert.equal(event!.sequence, 1);
    assert.equal(event!.previousEventDigest, "0".repeat(64));
    assert.equal(event!.eventId, "once");
  });

  it("publication re-stamps only the chain position: interleaved transactions keep a valid digest chain and each event's prepared content", async () => {
    const audit = new InProcessRestrictedAuditStore();
    const a = {}; const b = {};
    await audit.append(build("a"), a);
    await audit.append(build("b"), b);
    await audit.commit(b);
    await audit.commit(a);
    const events = audit.snapshot();
    assert.deepEqual(events.map((event) => [event.eventId, event.sequence]), [["b", 1], ["a", 2]]);
    assert.equal(events[0]!.previousEventDigest, "0".repeat(64));
    assert.equal(events[1]!.previousEventDigest, events[0]!.eventDigest);
    for (const event of events) { const { eventDigest, ...body } = event; assert.equal(eventDigest, (await import("@cobudget/contracts/authorization")).sha256(body)); }
    // A rolled-back handle publishes nothing and releases its reservation.
    const c = {};
    await audit.append(build("c"), c);
    assert.equal(audit.reserved, 1);
    audit.discard(c);
    assert.equal(audit.reserved, 0); assert.equal(audit.length, 2);
  });
});
