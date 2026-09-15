/**
 * PROTO-IDENTITY-API-001 correction round 3 RC-05 (C2 activation, P2):
 * at c30c62c, `profile.read` is a released p2 subject-scoped read cell
 * (packages/contracts/src/authorization/policy/v2.ts, `subjectRows`)
 * that carries a `bind_cache_key` obligation
 * (packages/contracts/src/authorization/evaluate.ts#obligation, kind
 * "bind_cache_key"). `ApiTransactionStore.discharge` previously returned
 * `false` for every obligation and `.verify` rejected any obligation
 * outside `audit`/`recheck_at_commit`, so `AuthorizationBoundary.execute`
 * would deny the whole read even after the policy cell allows it. These
 * tests exercise the transaction store directly with the exact obligation
 * shape `evaluate.ts#obligation("bind_cache_key", ...)` produces for a
 * subject-scoped read -- the same probe fidelity the Codex recheck used
 * to find the defect (its own evidence: "Executed transaction-store
 * rejection of the p2 bind_cache_key obligation").
 *
 * This closes only the transaction-store half of RC-05, as the packet
 * scoped it ("keep /me denied only for the missing subject-scoped
 * assembly"). Verified while writing this: `apps/api/src/authorization/
 * facts.ts` has no producer for `environment.environmentId` at all, so
 * `isSubjectScoped(input)` (packages/contracts/src/authorization/
 * evaluate.ts) can never be true through the real `FactAssembler.assemble`
 * pipeline yet -- a real end-to-end `AuthorizationBoundary.execute` proof
 * for `profile.read` is not constructible without also adding that
 * subject-scoped fact assembly, which is the Manager's separate activation
 * sweep, not this round's RC-05. `GET /v1/identity/me` therefore stays
 * denied end to end (proven in http.test.ts) until that assembly lands;
 * this file proves the one piece assigned here no longer blocks it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import type { DataAccessClient } from "@cobudget/data-access";
import { SessionStoreUnavailableError } from "@cobudget/sessions";
import { createFakeIdentityClient, FakeIdentityDatabase } from "../identity/test-support/fake-client.ts";
import { InProcessRestrictedAuditStore } from "./audit.ts";
import { ApiTransactionStore } from "./transaction-store.ts";

const BIND_CACHE_KEY_OBLIGATION: Obligation = { kind: "bind_cache_key", dimensions: ["environmentId", "accountSubjectId", "subjectVersion", "profileVersion", "policyVersion"] };

describe("PROTO-IDENTITY-API-001 RC-05: bind_cache_key discharge for the p2 profile.read obligation", () => {
  it("discharge accepts a bind_cache_key obligation (previously false for every obligation)", async () => {
    const db = new FakeIdentityDatabase();
    const audit = new InProcessRestrictedAuditStore(100);
    const store = new ApiTransactionStore(createFakeIdentityClient(db), audit);
    const accepted = await store.transaction(async (transaction) => store.discharge(transaction, {} as PolicyInput, BIND_CACHE_KEY_OBLIGATION));
    assert.equal(accepted, true, "bind_cache_key names caching dimensions for an already-authorized read; there is nothing to write");
  });

  it("verify accepts an obligation list containing only audit, recheck_at_commit and bind_cache_key", async () => {
    const db = new FakeIdentityDatabase();
    const audit = new InProcessRestrictedAuditStore(100);
    const store = new ApiTransactionStore(createFakeIdentityClient(db), audit);
    const ok = await store.transaction(async (transaction) =>
      store.verify(transaction, {} as PolicyInput, [{ kind: "audit", eventClass: "policy_decision" }, BIND_CACHE_KEY_OBLIGATION]),
    );
    assert.equal(ok, true);
  });

  it("verify still refuses an obligation this store genuinely cannot discharge (e.g. create_primary_owner_membership)", async () => {
    const db = new FakeIdentityDatabase();
    const audit = new InProcessRestrictedAuditStore(100);
    const store = new ApiTransactionStore(createFakeIdentityClient(db), audit);
    const ok = await store.transaction(async (transaction) =>
      store.verify(transaction, {} as PolicyInput, [BIND_CACHE_KEY_OBLIGATION, { kind: "create_primary_owner_membership" }]),
    );
    assert.equal(ok, false, "RC-05 must not become a blanket obligation bypass");
  });
});

/**
 * SEC-PK4-F4: the retry loop recognises a serialization failure however it
 * reaches the loop. The losing side of two serializable transactions on one
 * grant sees SQLSTATE 40001 on a statement deep inside the attempt; the
 * `@cobudget/sessions` store wraps it (now with `sqlState`), `resolve.ts` may
 * reduce it to `not_authenticated`, and the assembler to a `FactFailure`.
 * The transaction is doomed either way, so the attempt is retried either way.
 */
describe("SEC-PK4-F4: a serialization failure anywhere in the attempt is retried", () => {
  const serialization = () => Object.assign(new Error("statement failed"), { name: "StatementFailedError", sqlState: "40001" });

  function clientWhoseUpdateFails(failures: () => Error | undefined) {
    let attempts = 0;
    const scoped = {
      platformSelect: async () => ({ rows: [], rowCount: 0 }),
      platformUpdate: async () => {
        const failure = failures();
        if (failure) throw failure;
        return { rows: [], rowCount: 1 };
      },
    };
    const client = {
      ...scoped,
      transaction: async <T>(_options: unknown, work: (transaction: DataAccessClient) => Promise<T>): Promise<T> => {
        attempts++;
        return work(scoped as unknown as DataAccessClient);
      },
    } as unknown as DataAccessClient;
    return { client, attempts: () => attempts };
  }

  it("a wrapped 40001 thrown out of the work (the sessions store's SessionStoreUnavailableError) is retried with a fresh transaction", async () => {
    let remaining = 1;
    const { client, attempts } = clientWhoseUpdateFails(() => undefined);
    const store = new ApiTransactionStore(client, new InProcessRestrictedAuditStore(100));
    const result = await store.transaction(async () => {
      // Thrown without a statement on the observed handle, so only the wrapped
      // error's own `sqlState` (what `packages/sessions` now carries) can
      // make the loop retry.
      if (remaining-- > 0) throw new SessionStoreUnavailableError(serialization());
      return "committed";
    });
    assert.equal(result, "committed");
    assert.equal(attempts(), 2, "one failed attempt, one retry");
  });

  it("a 40001 a higher layer swallowed (the loser's idle-extension write inside the fact read) is still retried", async () => {
    let remaining = 1;
    const { client, attempts } = clientWhoseUpdateFails(() => remaining-- > 0 ? serialization() : undefined);
    const store = new ApiTransactionStore(client, new InProcessRestrictedAuditStore(100));
    const result = await store.transaction(async (transaction) => {
      try { await (transaction as DataAccessClient).platformUpdate({ table: "account_session", set: {}, conditions: [] }); }
      catch { throw new Error("not_authenticated"); } // what the assembler throws: no sqlState anywhere on it
      return "committed";
    });
    assert.equal(result, "committed");
    assert.equal(attempts(), 2);
  });

  it("a failure that is not a serialization failure is not retried, and the attempts are capped", async () => {
    const other = clientWhoseUpdateFails(() => Object.assign(new Error("statement failed"), { sqlState: "23505" }));
    const store = new ApiTransactionStore(other.client, new InProcessRestrictedAuditStore(100));
    await assert.rejects(store.transaction(async (transaction) => (transaction as DataAccessClient).platformUpdate({ table: "t", set: {}, conditions: [] })), /statement failed/);
    assert.equal(other.attempts(), 1, "23505 is not retried here");
    const always = clientWhoseUpdateFails(serialization);
    const capped = new ApiTransactionStore(always.client, new InProcessRestrictedAuditStore(100));
    await assert.rejects(capped.transaction(async (transaction) => (transaction as DataAccessClient).platformUpdate({ table: "t", set: {}, conditions: [] })), (error: unknown) => (error as { sqlState?: string }).sqlState === "40001");
    assert.equal(always.attempts(), 3, "bounded: the third failure is thrown");
  });

  it("the observed handle keeps every member of the scoped client, non-enumerable ones included", async () => {
    const scoped = Object.defineProperties({ platformSelect: async () => ({ rows: [], rowCount: 0 }) }, {
      profileSelect: { value: async () => ({ rows: [{ hidden: true }], rowCount: 1 }) },
    });
    const client = { transaction: async <T>(_options: unknown, work: (transaction: unknown) => Promise<T>) => work(scoped) } as unknown as DataAccessClient;
    const store = new ApiTransactionStore(client, new InProcessRestrictedAuditStore(100));
    const seen = await store.transaction(async (transaction) => (transaction as DataAccessClient).profileSelect!({} as never));
    assert.equal(seen.rowCount, 1);
  });
});
