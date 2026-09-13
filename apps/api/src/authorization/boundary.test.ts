import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapFixture, expectedProvenance, ordinaryFixture, serviceFixture } from "@cobudget/contracts/authorization";
import type { AuthorizedEffect } from "@cobudget/contracts/authorization";
import { RestrictedAudit } from "./audit.js";
import { AuthorizationBoundary } from "./boundary.js";
import { AuthorizationDenied } from "./boundary.js";
import { assertPolicyCompatibility, readReleaseHistory, SUPPORTED_POLICY_TUPLES } from "./compatibility.js";
import { FactAssembler } from "./facts.js";
import { Harness, testGovernance, testHistory } from "./test-support.js";
import type { TestState } from "./test-support.js";

describe("authorization transaction boundary", () => {
  it("allows bootstrap only with atomic sole Primary membership and audit", async () => {
    const h = new Harness();
    const context = await h.boundary.authorize(h.lookup());
    assert.equal(context.decision.outcome, "allow");
    assert.notEqual(context.input.bootstrap?.candidateSpaceId, h.input.bootstrap?.candidateSpaceId);
    let issued: AuthorizedEffect | undefined;
    let transaction: unknown;
    const result = await h.boundary.execute(context, async (effect) => {
      issued = effect.effect; transaction = effect.transaction;
      h.boundary.assertEffect(effect.effect, effect.transaction, effect.input);
      const state = effect.transaction as TestState;
      assert.deepEqual(state.memberships, [effect.input.bootstrap!.candidatePrimaryMembershipId]);
      state.spaces.push(effect.input.bootstrap!.candidateSpaceId);
      return "created";
    });
    assert.equal(result, "created");
    assert.equal(h.state.spaces.length, 1); assert.equal(h.state.memberships.length, 1);
    assert.equal(h.state.audits[0]?.outcome, "allow");
    assert.throws(() => h.boundary.assertEffect(issued!, transaction, context.input), AuthorizationDenied);
    await assert.rejects(h.boundary.execute(context, async () => assert.fail("reused context")), AuthorizationDenied);
  });
  it("denies forged contexts and tokens without effects", async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    await assert.rejects(h.boundary.execute(structuredClone(context), async () => assert.fail("forged context")), AuthorizationDenied);
    assert.throws(() => h.boundary.assertEffect({ decision: context.decision } as AuthorizedEffect, {}, context.input), AuthorizationDenied);
    assert.equal(h.state.spaces.length, 0);
  });
  it("rolls back a bootstrap handler that omits its space insert", async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    await assert.rejects(h.boundary.execute(context, async () => undefined), AuthorizationDenied);
    assert.deepEqual(h.state.spaces, []); assert.deepEqual(h.state.memberships, []);
    assert.deepEqual(h.order, ["begin", "rollback", "deny-audit"]);
  });
  it("rolls back a bootstrap handler that creates a second Primary Owner", async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    await assert.rejects(h.boundary.execute(context, async ({ input, transaction }) => {
      const state = transaction as TestState;
      state.spaces.push(input.bootstrap!.candidateSpaceId);
      state.primaryOwners[input.bootstrap!.candidateSpaceId]!.push("second-owner");
    }), AuthorizationDenied);
    assert.deepEqual(h.state.spaces, []); assert.deepEqual(h.state.memberships, []); assert.deepEqual(h.state.primaryOwners, {});
  });
  it("denies absent/unresolvable sessions as not_authenticated without payload fallback", async () => {
    const h = new Harness(); h.missing = "session_store";
    await assert.rejects(h.boundary.authorize({ ...h.lookup(), credential: { subject: h.input.subject, role: "primary_owner" } }), AuthorizationDenied);
    assert.equal(h.state.audits.at(-1)?.reasonClass, "not_authenticated");
    assert.deepEqual(h.reads.map((read) => read.source), ["session_store"]);
  });
  it("denies stale captured versions inside the transaction before the handler", async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    h.input.subject!.sessionVersion = 2;
    await assert.rejects(h.boundary.execute(context, async () => assert.fail("stale effect")), AuthorizationDenied);
    assert.equal(h.state.audits.at(-1)?.reasonClass, "stale_version");
    assert.deepEqual(h.order, ["begin", "rollback", "deny-audit"]);
    assert.equal(h.state.memberships.length, 0);
  });
  it("denies changed facts even when their captured version was not incremented", async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    h.input.profile!.profileId = "changed-profile";
    await assert.rejects(h.boundary.execute(context, async () => assert.fail("digest changed")), AuthorizationDenied);
    assert.equal(h.state.audits.at(-1)?.reasonClass, "stale_version");
  });
  for (const collision of ["spaces", "memberships"] as const) it(`denies bootstrap ${collision} absence race`, async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    h.state[collision].push(collision === "spaces" ? context.input.bootstrap!.candidateSpaceId : context.input.bootstrap!.candidatePrimaryMembershipId);
    await assert.rejects(h.boundary.execute(context, async () => assert.fail("collision")), AuthorizationDenied);
    assert.equal(h.order.includes("commit"), false);
  });
  for (const fault of ["obligation", "handler", "audit", "commit"] as const) it(`rolls back all customer effects on ${fault} failure`, async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    h.obligations = fault !== "obligation"; h.failAudit = fault === "audit"; h.failCommit = fault === "commit";
    let returned = false;
    await assert.rejects(h.boundary.execute(context, async (effect) => {
      const state = effect.transaction as TestState;
      state.spaces.push("space"); state.effects.push("effect"); state.derived.push("derived"); state.notifications.push("notice"); state.versions.push(2);
      if (fault === "handler") throw new Error("internal detail must not escape");
      returned = true; return "must not be serialized";
    }), (error: unknown) => error instanceof AuthorizationDenied && JSON.stringify(error.response) === '{"outcome":"deny","reason":"denied"}');
    for (const key of ["spaces", "memberships", "effects", "derived", "notifications", "versions"] as const) assert.deepEqual(h.state[key], []);
    assert.equal(h.state.audits.some((event) => event.outcome === "allow"), false);
    assert.ok(h.order.includes("rollback"));
    if (fault === "audit") assert.equal(h.operationsFailures, 1);
    if (fault === "obligation") assert.equal(returned, false);
  });
  it("stamps every producer from server reads and ignores unrelated/source-spoofed leaves", async () => {
    const h = new Harness();
    h.corrupt = (source, facts) => { if (source === "session_store") { facts["membership.role"] = "primary_owner"; facts.password = "never-retain-this"; } };
    const context = await h.boundary.authorize(h.lookup());
    assert.equal(context.input.provenance["subject.sessionVersion"], "session_store");
    assert.equal(context.input.provenance["subject.subjectVersion"], "datastore");
    assert.equal(JSON.stringify(context).includes("never-retain-this"), false);
  });
  it("fails closed when a required producer cannot supply a leaf", async () => {
    const h = new Harness(); h.corrupt = (source, facts) => { if (source === "datastore") delete facts["profile.profileVersion"]; };
    await assert.rejects(h.boundary.authorize(h.lookup()), AuthorizationDenied);
  });
  it("denies removal of each server-produced field across API bootstrap, ordinary and worker service variants", async () => {
    for (const input of [bootstrapFixture(), ordinaryFixture("2a.edit_plan"), serviceFixture()]) {
      for (const [path, producer] of Object.entries(expectedProvenance(input))) {
        if (!["session_store", "datastore", "idp_evidence", "workload_identity", "server_policy_store"].includes(producer)) continue;
        const h = new Harness(input);
        h.corrupt = (source, facts) => { if (source === producer) delete facts[path]; };
        await assert.rejects(h.boundary.authorize(h.lookup()), AuthorizationDenied, `${input.evaluation.adapter}:${path}`);
        assert.deepEqual(h.state.effects, []);
      }
    }
  });
  it("denies bounded session-resolution timeouts and cancels the source read", async () => {
    const h = new Harness(); let signal: AbortSignal | undefined;
    const assembler = new FactAssembler("api", { read: async (_source, lookup) => { signal = lookup.signal; return new Promise<null>(() => undefined); } }, () => new Date(), 10);
    const boundary = new AuthorizationBoundary(assembler, h.store, h.audit);
    await assert.rejects(boundary.authorize(h.lookup()), AuthorizationDenied);
    assert.equal(signal?.aborted, true); assert.equal(h.state.audits.at(-1)?.reasonClass, "not_authenticated");
  });
  it("rejects malformed required identifiers even if the core's type was bypassed", async () => {
    for (const path of ["subject.sessionRef", "profile.profileId"]) {
      const h = new Harness(); h.corrupt = (_source, facts) => { if (Object.hasOwn(facts, path)) facts[path] = ""; };
      await assert.rejects(h.boundary.authorize(h.lookup()), AuthorizationDenied);
      assert.deepEqual(h.state.spaces, []);
    }
  });
  it("does not trust payload roles or a resource from another acting space", async () => {
    const h = new Harness(ordinaryFixture("1.view_space"));
    h.input.membership!.role = "viewer";
    await assert.rejects(h.boundary.authorize(h.lookup()), AuthorizationDenied);
    h.input.membership!.role = "primary_owner";
    await assert.rejects(h.boundary.authorize({ ...h.lookup(), operation: { ...h.lookup().operation, actingSpaceId: "other-space" } }), AuthorizationDenied);
  });
  it("never logs session, credentials, customer content, or bootstrap candidates", async () => {
    const h = new Harness(); const context = await h.boundary.authorize(h.lookup());
    await h.boundary.execute(context, async ({ input, transaction }) => { (transaction as TestState).spaces.push(input.bootstrap!.candidateSpaceId); });
    const serialized = JSON.stringify(h.state.audits);
    for (const prohibited of ["session-ref-1", "candidate-space-1", context.input.bootstrap!.candidateSpaceId, "accountSubjectId", "profileId", "sessionVersion\":\"", "credential"]) assert.equal(serialized.includes(prohibited), false);
    assert.equal(h.state.audits[0]?.audienceClass, "restricted_security_evidence");
    assert.throws(() => new RestrictedAudit({ append: async () => undefined }, { ...testGovernance, retentionClass: "" }), /audit_governance_unavailable/);
    const blocked = new AuthorizationBoundary(new FactAssembler("api", h.source), h.store);
    await assert.rejects(blocked.authorize(h.lookup()), AuthorizationDenied);
  });
  it("rejects mismatched registry digest/schema and missing independent release history", () => {
    assert.doesNotThrow(() => assertPolicyCompatibility(testHistory));
    for (const expectedDigest of ["0".repeat(64), SUPPORTED_POLICY_TUPLES[0]!.expectedDigest]) {
      assert.throws(() => assertPolicyCompatibility(testHistory, [{ version: "p1", expectedDigest, schemaVersion: 99 }]), /policy_version_unsupported/);
    }
    assert.throws(() => assertPolicyCompatibility(testHistory, [{ ...SUPPORTED_POLICY_TUPLES[0]!, expectedDigest: "0".repeat(64) }]), /policy_version_unsupported/);
    assert.throws(() => assertPolicyCompatibility([]), /policy_version_unsupported/);
    assert.throws(() => assertPolicyCompatibility([{ ...testHistory[0], securityApprovalRef: "" }]), /policy_version_unsupported/);
    assert.deepEqual(readReleaseHistory(), [], "release prerequisite remains pending; update this assertion when the Manager releases a policy");
  });
});
