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
