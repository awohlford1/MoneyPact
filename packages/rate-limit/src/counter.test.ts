import assert from "node:assert/strict";
import { it } from "node:test";
import { CountingKeyDeriver, InProcessCounterStore, RateLimitEngine } from "./counter.ts";
import type { ConsumeInput } from "./counter.ts";
import { loadPrototypeRegistry, loadRegistrations } from "./prototype.ts";
import type { ParameterRecord } from "./types.ts";
import type { ApprovalContext, Registration } from "./types.ts";
import { seal, validateRegistry } from "./registry.ts";

const records = loadPrototypeRegistry().records;
function input(record: ParameterRecord, key = "a".repeat(64)): ConsumeInput { return { record, releaseSetDigest: "b".repeat(64), keys: [key], unit: 1 }; }
function syntheticRuntime(store: import("./counter.ts").CounterStore) {
  const candidate = structuredClone(records[0]!); candidate.surface_id = "surf-266-recovery";
  candidate.product_owner_approval = { ...candidate.product_owner_approval, status: "approved", approval_id: "test-only", approved_by_actor_id: "test-only", decided_at: "2026-09-13T04:00:00Z" };
  const record = seal(candidate); let revoked = false;
  const context: ApprovalContext = { now: "2026-09-13T12:00:00Z", environment: "local-prototype", singleProcess: true,
    resolve: () => ({ approvalId: "test-only", actorId: "test-only", candidateDigests: [record.product_owner_approval.candidate_digest], conditions: record.product_owner_approval.conditions, decidedAt: record.product_owner_approval.decided_at!, expiresAt: null, revoked }) };
  const registry = validateRegistry([record], context);
  assert.deepEqual(registry.diagnostics, []); assert.equal(registry.approved.size, 1);
  const registration: Registration = { registration_id: "api:POST:/recovery-fixture", executor_kind: "api_route", source_locator: "test-only#recovery", surface_id: record.surface_id, parameter_record_id: record.record_id, registration_lifecycle: "active", introduced_by: "test-only", authorization_metadata_id: null };
  const engine = new RateLimitEngine(registry, [registration], store, new CountingKeyDeriver(), 10);
  return { revoke: () => { revoked = true; }, decide: () => engine.decide({ registrationId: registration.registration_id, surfaceId: record.surface_id, parameterRecordId: record.record_id, releaseSetDigest: registry.releaseSetDigest, requestOrJobUnit: 1, verifiedContext: { localCaller: true, networkCohort: "verified-infrastructure-fixture" } }) };
}
it("counter failures, timeouts and unknown outcomes deny after an approved record; revocation is live", async () => {
  for (const store of [
    { consume: async (): Promise<never> => { throw new Error("failed"); } },
    { consume: (): Promise<never> => new Promise(() => undefined) },
    { consume: async () => ({ outcome: "unknown" } as never) },
  ]) assert.equal((await syntheticRuntime(store).decide()).outcome, "deny_counter_unavailable");
  const runtime = syntheticRuntime(new InProcessCounterStore()); assert.equal((await runtime.decide()).outcome, "allow");
  runtime.revoke(); assert.equal((await runtime.decide()).outcome, "deny_policy_unavailable");
});
it("FX-266-LOCKOUT-RECOVERY independently budgeted synthetic recovery survives ordinary exhaustion", async () => {
  const store = new InProcessCounterStore(() => 0);
  for (let i = 0; i < 70; i++) await store.consume(input(records[1]!));
  assert.equal((await store.consume(input(records[1]!))).outcome, "exhausted");
  assert.equal((await syntheticRuntime(store).decide()).outcome, "allow");
  // This proves isolation mechanics, not approval of production recovery values.
});
it("VT-94-068 concurrent consumes never exceed ceiling and mutation concurrency is one", async () => {
  const store = new InProcessCounterStore(() => 0);
  const results = await Promise.all(Array.from({ length: 100 }, () => store.consume(input(records[0]!))));
  assert.equal(results.filter((r) => r.outcome === "accepted").length, 70);
  const mutations = await Promise.all(Array.from({ length: 10 }, () => store.consume(input(records[2]!))));
  assert.equal(mutations.filter((r) => r.outcome === "accepted").length, 1);
  for (const r of mutations) if (r.outcome === "accepted") await r.release();
  assert.equal((await store.consume(input(records[2]!))).outcome, "accepted");
});
it("FX-266-PRIMARY-OWNER-BOOTSTRAP-RESERVATION eight ordinary attempts leave both carve-outs intact", async () => {
  const store = new InProcessCounterStore(() => 0); const base = input(records[3]!);
  const ordinary = await Promise.all(Array.from({ length: 8 }, () => store.consume({ ...base, bootstrapStage: "ordinary" })));
  assert.equal(ordinary.filter((r) => r.outcome === "accepted").length, 6);
  for (const bootstrapStage of ["first_sign_in", "initial_space_create"] as const) {
    assert.equal((await store.consume({ ...base, bootstrapStage })).outcome, "accepted");
    assert.equal((await store.consume({ ...base, bootstrapStage })).outcome, "exhausted");
  }
});
it("FX-266-AUTHENTICATED-ACTOR-ISOLATION and FX-266-PUBLIC-COHORT-ISOLATION keep independent pools", async () => {
  const store = new InProcessCounterStore(() => 0); const keys = new CountingKeyDeriver();
  const read = records[1]!; const actor = (actorId: string) => keys.derive(read, { actorId, localCaller: true });
  const attacked = { ...input(read), keys: actor("attacker") };
  for (let i = 0; i < 70; i++) assert.equal((await store.consume(attacked)).outcome, "accepted");
  assert.equal((await store.consume(attacked)).outcome, "exhausted");
  assert.equal((await store.consume({ ...input(read), keys: actor("victim") })).outcome, "accepted");
  assert.equal((await store.consume(input(records[0]!))).outcome, "accepted");
  assert.throws(() => keys.derive(read, { localCaller: true, ...{ claimed_email: "victim" } }), /input_invalid/);
});
it("VT-94-068 rotation preserves exhaustion and reservations; backward clocks and ambiguity deny", async () => {
  let time = 0; const store = new InProcessCounterStore(() => time); const keys = new CountingKeyDeriver(new Uint8Array(32).fill(1), 1_200_000, () => time);
  const r = records[0]!; const context = { localCaller: true, networkCohort: "loopback" };
  for (let i = 0; i < 70; i++) await store.consume({ ...input(r), keys: keys.derive(r, context) });
  keys.rotate(new Uint8Array(32).fill(2));
  assert.equal((await store.consume({ ...input(r), keys: keys.derive(r, context) })).outcome, "exhausted");
  assert.throws(() => keys.rotate(new Uint8Array(32).fill(3)), /rotation_overlap/);
  time = -1; await assert.rejects(store.consume(input(r)), /counter_unavailable/);
});
it("missing records, unknown surfaces and store failure cannot grant protected effects; health stays public", async () => {
  const registry = loadPrototypeRegistry(); const registrations = loadRegistrations();
  let effects = 0; const engine = new RateLimitEngine(registry, registrations, { consume: async () => { throw new Error("unavailable"); } });
  for (const registrationId of ["api:POST:/new", "job:worker:new:1"]) {
    const decision = await engine.decide({ registrationId, surfaceId: "surf-266-budget-mutation", parameterRecordId: "missing", releaseSetDigest: registry.releaseSetDigest, requestOrJobUnit: 1, verifiedContext: { localCaller: true } });
    if (decision.outcome === "allow") effects++; assert.equal(decision.outcome, "deny_unregistered");
  }
  assert.equal(effects, 0);
  for (const method of ["GET", "HEAD"]) assert.equal((await engine.decide({ registrationId: `api:${method}:/health`, surfaceId: "surf-266-public-health", parameterRecordId: null, releaseSetDigest: registry.releaseSetDigest, requestOrJobUnit: 1, verifiedContext: { localCaller: true } })).outcome, "allow");
});
it("public health and openapi exceptions stay reachable when the release set carries diagnostics or a foreign digest", async () => {
  const registry = loadPrototypeRegistry(); const registrations = loadRegistrations();
  const corrupted = { ...registry, diagnostics: [...registry.diagnostics, { code: "record_schema_invalid", path: "/0/limit", detail: "synthetic corruption for the anti-lockout proof" }] } as typeof registry;
  const engine = new RateLimitEngine(corrupted, registrations, { consume: async () => { throw new Error("unavailable"); } });
  for (const method of ["GET", "HEAD"]) {
    assert.equal((await engine.decide({ registrationId: `api:${method}:/health`, surfaceId: "surf-266-public-health", parameterRecordId: null, releaseSetDigest: "c".repeat(64), requestOrJobUnit: 1, verifiedContext: { localCaller: true } })).outcome, "allow");
  }
  const protectedDecision = await engine.decide({ registrationId: "api:POST:/new", surfaceId: "surf-266-budget-mutation", parameterRecordId: "missing", releaseSetDigest: registry.releaseSetDigest, requestOrJobUnit: 1, verifiedContext: { localCaller: true } });
  assert.notEqual(protectedDecision.outcome, "allow");
});
