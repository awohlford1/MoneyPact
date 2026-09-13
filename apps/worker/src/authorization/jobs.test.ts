import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, expectedProvenance, generateLocalSigningKeyPair, ordinaryFixture, serviceFixture, signLocalDecision } from "@cobudget/contracts/authorization";
import type { PolicyInput, WorkerUserDelegatedPolicyInput } from "@cobudget/contracts/authorization";
import { Harness, operationFor, testHistory } from "./test-support.js";
import type { TestState } from "./test-support.js";
import { loadWorkerConfigFrom } from "../config.js";
import { startWorker } from "../runtime.js";
import { assertPolicyCompatibility as assertWorkerPolicyCompatibility, SUPPORTED_POLICY_TUPLES } from "./compatibility.js";
import { AuthorizedJobs } from "./jobs.js";
import type { JobEnvelope, WorkerAuthorizationOptions } from "./jobs.js";

function envelopeFor(input: PolicyInput): JobEnvelope {
  const decision = decide(input);
  return { jobType: "test-job", producerRef: "test-producer", operation: operationFor(input), claimedVersions: decision.capturedVersions!, claimedEffectClass: decision.effectClass!, idempotencyKey: "test-effect" };
}
function optionsFor(h: Harness): WorkerAuthorizationOptions {
  return {
    boundary: h.boundary,
    jobs: { "test-job": { action: h.input.request.action, purpose: h.input.request.purpose, queueContractRef: "test-only-queue-contract", run: async ({ transaction }) => { (transaction as TestState).effects.push("effect"); return "done"; } } },
    authenticateProducer: async () => "verified-test-producer",
    consumeTransport: async ({ transaction }, envelope) => { const state = transaction as TestState; if (state.consumed.includes(envelope.oneUseId)) return false; state.consumed.push(envelope.oneUseId); return true; },
    claimEffect: async ({ transaction }, id) => { const state = transaction as TestState; if (state.effectIds.includes(id)) return false; state.effectIds.push(id); return true; },
  };
}
function delegated(): WorkerUserDelegatedPolicyInput {
  const input = ordinaryFixture("2a.edit_plan");
  const { sessionRef: _ref, sessionVersion: _version, ...subject } = input.subject;
  const worker = { ...input, subject: { ...subject, delegationRef: "delegation-1", delegationVersion: 1 }, evaluation: { ...input.evaluation, adapter: "worker" as const } };
  worker.provenance = expectedProvenance(worker);
  return worker;
}
function serviceHarness(): Harness {
  const h = new Harness(serviceFixture());
  // The fake transaction already preserves its source arrays. Production must
  // provide the governed preservation implementation instead of this fixture.
  h.store.discharge = async (_transaction, _input, obligation) => obligation.kind === "preserve";
  return h;
}

describe("worker fail-closed job chain", () => {
  it("denies unregistered and malformed jobs before producer or fact lookups", async () => {
    const h = serviceHarness(); let calls = 0;
    const jobs = new AuthorizedJobs({ ...optionsFor(h), authenticateProducer: async () => { calls++; return "producer"; } });
    for (const value of [null, {}, { ...envelopeFor(h.input), jobType: "unknown" }, { ...envelopeFor(h.input), subject: { role: "primary_owner" } }, { ...envelopeFor(h.input), claimedVersions: {} }]) {
      assert.deepEqual(await jobs.run(value), { outcome: "denied", terminal: true });
    }
    assert.equal(calls, 0); assert.equal(h.reads.length, 0); assert.deepEqual(h.state.effects, []);
  });
  it("reloads worker service facts and atomically records material-effect identity", async () => {
    const h = serviceHarness(); const jobs = new AuthorizedJobs(optionsFor(h));
    assert.deepEqual(await jobs.run(envelopeFor(h.input)), { outcome: "completed", value: "done" });
    assert.deepEqual(h.state.effects, ["effect"]); assert.deepEqual(h.state.effectIds, ["test-effect"]);
    for (const source of ["workload_identity", "datastore", "server_policy_store"]) {
      assert.equal(h.reads.filter((read) => read.source === source).length, 2);
      assert.ok(h.reads.some((read) => read.source === source && read.transaction));
    }
    assert.deepEqual(await new AuthorizedJobs(optionsFor(h)).run(envelopeFor(h.input)), { outcome: "denied", terminal: true });
    assert.deepEqual(h.state.effects, ["effect"]);
  });
  it("resolves current delegation instead of accepting envelope-carried authority", async () => {
    const h = new Harness(delegated());
    h.store.discharge = async (_transaction, _input, obligation) => obligation.kind === "preserve";
    const jobs = new AuthorizedJobs(optionsFor(h));
    assert.deepEqual(await jobs.run(envelopeFor(h.input)), { outcome: "completed", value: "done" });
    assert.equal(h.reads.some((read) => read.source === "session_store"), false);
    assert.equal(h.reads.filter((read) => read.source === "delegation_store").length, 2);
  });
  it("denies unauthenticated producers before datastore lookups", async () => {
    const h = serviceHarness(); const jobs = new AuthorizedJobs({ ...optionsFor(h), authenticateProducer: async () => null });
    assert.deepEqual(await jobs.run(envelopeFor(h.input)), { outcome: "denied", terminal: true });
    assert.equal(h.reads.length, 0);
  });
  it("denies claimed effect/version mismatch, wrong scope and unsupported purpose", async () => {
    for (const mutate of [
      (value: JobEnvelope) => { value.claimedEffectClass = "read"; },
      (value: JobEnvelope) => { value.claimedVersions = { ...value.claimedVersions, targetVersion: 9 }; },
      (value: JobEnvelope) => { value.operation = { ...value.operation, actingSpaceId: "other-space" }; },
      (value: JobEnvelope) => { value.operation = { ...value.operation, purpose: "SA-92-003" }; },
    ]) {
      const h = serviceHarness(); const value = envelopeFor(h.input); mutate(value);
      assert.deepEqual(await new AuthorizedJobs(optionsFor(h)).run(value), { outcome: "denied", terminal: true });
      assert.deepEqual(h.state.effects, []);
    }
  });
  it("denies a service-source version race at commit", async () => {
    const h = serviceHarness(); const original = h.source.read;
    h.source.read = async (source, lookup, transaction) => {
      if (transaction && source === "server_policy_store") h.input.authority.mode === "service" && h.input.authority.sourceVersion++;
      return original(source, lookup, transaction);
    };
    assert.deepEqual(await new AuthorizedJobs(optionsFor(h)).run(envelopeFor(h.input)), { outcome: "denied", terminal: true });
    assert.deepEqual(h.state.effects, []); assert.equal(h.state.audits.at(-1)?.reasonClass, "stale_version");
  });
  it("consumes local signed decisions once across concurrent consumers and receiver restart", async () => {
    const h = serviceHarness(); const keys = generateLocalSigningKeyPair();
    const value = envelopeFor(h.input); const now = Date.now();
    value.transportedDecision = signLocalDecision({ decision: decide(h.input), action: value.operation.action, targetBinding: value.operation.resourceId!, claimedEffectClass: value.claimedEffectClass,
      issuer: "test-issuer", audience: "test-worker", issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(), oneUseId: "test-once", algorithm: "Ed25519" }, keys.privateKey);
    const options = { ...optionsFor(h), localTransport: { environment: "local" as const, publicKey: keys.publicKey, issuer: "test-issuer", audience: "test-worker", maximumLifetimeMs: 60_000 } };
    const results = await Promise.all([new AuthorizedJobs(options).run(value), new AuthorizedJobs(options).run(value)]);
    assert.equal(results.filter((result) => result.outcome === "completed").length, 1);
    assert.deepEqual(h.state.consumed, ["test-once"]); assert.deepEqual(h.state.effects, ["effect"]);
    assert.deepEqual(await new AuthorizedJobs(options).run(value), { outcome: "denied", terminal: true });
    assert.deepEqual(await new AuthorizedJobs(optionsFor(h)).run(value), { outcome: "denied", terminal: true });
    const tampered = structuredClone(value); tampered.transportedDecision!.audience = "other-worker";
    assert.deepEqual(await new AuthorizedJobs(options).run(tampered), { outcome: "denied", terminal: true });
  });
  it("rolls back consumption, idempotency, effect and allow-audit together", async () => {
    const h = serviceHarness(); h.failCommit = true;
    assert.deepEqual(await new AuthorizedJobs(optionsFor(h)).run(envelopeFor(h.input)), { outcome: "denied", terminal: true });
    assert.deepEqual(h.state.effectIds, []); assert.deepEqual(h.state.effects, []);
    h.failCommit = false;
    assert.equal((await new AuthorizedJobs(optionsFor(h)).run(envelopeFor(h.input))).outcome, "completed");
  });
  it("rejects startup mismatches and installs an empty deny-by-default job inventory", async () => {
    assert.throws(() => assertWorkerPolicyCompatibility(), /policy_version_unsupported/);
    assert.throws(() => assertWorkerPolicyCompatibility(testHistory, [{ ...SUPPORTED_POLICY_TUPLES[0]!, schemaVersion: 2 }]), /policy_version_unsupported/);
    const config = loadWorkerConfigFrom({ LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "authorization-test" });
    const worker = startWorker(config, { readiness: () => undefined, reliability: () => undefined }, undefined, testHistory);
    try { assert.deepEqual(worker.jobs.inventory(), []); assert.deepEqual(await worker.jobs.run({}), { outcome: "denied", terminal: true }); }
    finally { await worker.stop(); }
  });
});
