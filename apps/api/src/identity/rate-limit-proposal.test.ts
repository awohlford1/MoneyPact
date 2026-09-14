import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiIdentity, candidateDigest, PUBLIC_SURFACES, registrationErrors, RateLimitEngine, InProcessCounterStore, seal, SURFACE_CATALOG, validateRegistry } from "../../../../packages/rate-limit/src/index.ts";
import type { ParameterRecord, Registration } from "../../../../packages/rate-limit/src/index.ts";
import { createComposedApiApplication } from "../application.js";
import { testHistory } from "../authorization/test-support.js";
import { installedRoutes } from "../rate-limit/inventory.js";
import proposal from "./rate-limit-proposal.json" with { type: "json" };
import { createFakeIdentityClient, FakeIdentityDatabase } from "./test-support/fake-client.ts";
import { localConfig } from "./test-support/harness.ts";

const records = proposal.records as unknown as ParameterRecord[];
const registrations = proposal.registrations as unknown as Registration[];
const ACTOR = "executive:synthetic-test-actor";
const APPROVAL = "PROTO-IDENTITY-RATE-LIMIT-TEST-APPROVAL";
const DECIDED_AT = "2026-09-13T12:00:00.000Z";

/** The records as they would look once an Executive approval is projected onto them, with matching approval evidence. */
function approved(): { records: ParameterRecord[]; resolve: (id: string) => { approvalId: string; actorId: string; candidateDigests: string[]; conditions: string[]; decidedAt: string; expiresAt: null; revoked: false } | undefined } {
  const projected = records.map((record) => ({ ...record, product_owner_approval: { ...record.product_owner_approval, status: "approved" as const, approval_id: APPROVAL, approved_by_actor_id: ACTOR, decided_at: DECIDED_AT } }));
  const sealed = projected.map((record) => seal(record));
  const digests = sealed.map((record) => candidateDigest(record));
  return { records: sealed, resolve: (id) => (id === APPROVAL ? { approvalId: APPROVAL, actorId: ACTOR, candidateDigests: digests, conditions: ["prototype-only", "revisit before any hosted environment"], decidedAt: DECIDED_AT, expiresAt: null, revoked: false } : undefined) };
}

describe("CBD-266 registration proposal for the CBD-190 identity routes", () => {
  it("every proposed registration is schema-valid, bound to a catalog surface and to one of the two proposed records", () => {
    for (const registration of registrations) {
      assert.deepEqual(registrationErrors(registration), [], registration.registration_id);
      assert.ok(SURFACE_CATALOG[registration.surface_id], registration.surface_id);
      assert.equal(PUBLIC_SURFACES[registration.registration_id], undefined, "identity routes are bounded surfaces, never public exceptions");
      const record = records.find((candidate) => candidate.record_id === registration.parameter_record_id);
      assert.ok(record, registration.registration_id);
      assert.equal(record.surface_id, registration.surface_id);
    }
    const preAuthentication = registrations.filter((registration) => registration.surface_id === "surf-266-authentication");
    assert.equal(preAuthentication.length, 7);
    assert.ok(preAuthentication.every((registration) => registration.authorization_metadata_id === null));
    assert.ok(registrations.filter((registration) => registration.surface_id === "surf-266-session").every((registration) => registration.authorization_metadata_id !== null));
  });

  it("the proposed records validate with zero diagnostics, seal to their recorded digests, and stay pending (no approval invented here)", () => {
    const registry = validateRegistry(records, { now: new Date().toISOString(), environment: "local-prototype", singleProcess: true, resolve: () => undefined });
    assert.deepEqual(registry.diagnostics, []);
    assert.equal(registry.approved.size, 0, "pending records are never runtime-approved");
    for (const record of records) {
      assert.equal(record.product_owner_approval.status, "pending");
      assert.equal(record.product_owner_approval.approval_id, null);
      assert.equal(seal(record).record_digest, record.record_digest);
      assert.equal(record.quota.ceiling, record.threshold + record.burst.additional_units);
    }
    const ceremony = records.find((record) => record.record_id === "rlp-266-identity-ceremony-v1")!;
    assert.equal(ceremony.safe_counting_key.phase, "pre_authentication");
    assert.deepEqual(ceremony.safe_counting_key.components, ["privacy_network_cohort_v1", "exact_surface_id"]);
    assert.deepEqual(ceremony.anti_lockout_rule.victim_bound_dimensions, []);
  });

  it("registration ids are exactly the routes the local adapter installs (nothing missing, nothing stale)", async () => {
    const { app } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(new FakeIdentityDatabase()) });
    try {
      await app.init();
      const server = app.getHttpAdapter().getInstance();
      await server.ready();
      const installed = installedRoutes(server).map((route) => route.id).filter((id) => id.includes("/v1/identity/")).sort();
      assert.deepEqual(installed, registrations.map((registration) => registration.registration_id).sort());
      for (const registration of registrations) {
        const [, method, ...path] = registration.registration_id.split(":");
        assert.equal(apiIdentity(method!, path.join(":")), registration.registration_id);
      }
    } finally { await app.close(); }
  });

  it("once an authenticated Executive approval is projected, the ceremony record approves and the engine allows a loopback pre-authentication request under its pool", async () => {
    const { records: sealed, resolve } = approved();
    const registry = validateRegistry(sealed, { now: new Date().toISOString(), environment: "local-prototype", singleProcess: true, resolve });
    assert.deepEqual(registry.diagnostics, []);
    assert.ok(registry.approved.has("rlp-266-identity-ceremony-v1"), "the pre-authentication record needs no recovery pool and approves on its own");
    // The session record names surf-266-recovery as its independent recovery pool, exactly like the merged proto-authenticated-read-v1 record; it approves only once a recovery record exists (OPEN-266 follow-up), never silently.
    assert.equal(registry.approved.has("rlp-266-identity-session-v1"), false);
    const engine = new RateLimitEngine(registry, registrations, new InProcessCounterStore());
    const begin = registrations.find((registration) => registration.registration_id === "api:POST:/v1/identity/begin")!;
    const decision = await engine.decide({ registrationId: begin.registration_id, surfaceId: begin.surface_id, parameterRecordId: begin.parameter_record_id, releaseSetDigest: registry.releaseSetDigest, requestOrJobUnit: 1, verifiedContext: { localCaller: true, networkCohort: "loopback" } });
    assert.equal(decision.outcome, "allow");
    const missingCohort = await engine.decide({ registrationId: begin.registration_id, surfaceId: begin.surface_id, parameterRecordId: begin.parameter_record_id, releaseSetDigest: registry.releaseSetDigest, requestOrJobUnit: 1, verifiedContext: { localCaller: true } });
    assert.equal(missingCohort.outcome, "deny_input_invalid", "without the cohort the key cannot be derived and the surface denies");
  });
});
