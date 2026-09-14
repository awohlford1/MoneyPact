import assert from "node:assert/strict";
import { it } from "node:test";
import type { FastifyRequest } from "fastify";
import { ApiRateLimits } from "./http.ts";
import { loadPrototypeRegistry } from "../../../../packages/rate-limit/src/index.ts";

it("allows a registered approved surface and denies an unregistered route", async () => {
  const gate = new ApiRateLimits("test", loadPrototypeRegistry(), [{
    registration_id: "api:GET:/approval-fixture", executor_kind: "api_route", source_locator: "fixture.ts#read",
    surface_id: "surf-266-budget-read", parameter_record_id: "rlp-266-authenticated-read-v1",
    registration_lifecycle: "active", introduced_by: "test", authorization_metadata_id: "test",
  }]);
  const request = (url: string) => ({ method: "GET", routeOptions: { url }, ip: "127.0.0.1" }) as FastifyRequest;
  const allowed = await gate.enforce(request("/approval-fixture"), "test-actor");
  assert.equal(allowed.outcome, "allow");
  if (allowed.outcome === "allow") await allowed.release();
  assert.equal((await gate.enforce(request("/unregistered"), "test-actor")).outcome, "deny_unregistered");
});

it("PROTO-ACTIVATION-001: an identity ceremony surface bound to the approved bootstrap record is admitted on loopback as an ordinary stage decision, bounded per exact surface, and refused off loopback", async () => {
  const registration = (id: string) => ({
    registration_id: id, executor_kind: "api_route" as const, source_locator: "fixture.ts#ceremony",
    surface_id: "surf-266-authentication", parameter_record_id: "rlp-266-bootstrap-v1",
    registration_lifecycle: "active" as const, introduced_by: "test", authorization_metadata_id: null,
  });
  const gate = new ApiRateLimits("test", loadPrototypeRegistry(), [registration("api:POST:/v1/identity/begin"), registration("api:GET:/v1/identity/callback")]);
  const request = (url: string, method = "POST", ip = "127.0.0.1") => ({ method, routeOptions: { url }, ip }) as FastifyRequest;
  // Six ordinary units per window for the loopback cohort on this exact surface; the two reserved completion units stay untouched.
  for (let attempt = 0; attempt < 6; attempt++) {
    const decision = await gate.enforce(request("/v1/identity/begin"), undefined);
    assert.equal(decision.outcome, "allow", `attempt ${attempt}`);
    if (decision.outcome === "allow") await decision.release();
  }
  assert.equal((await gate.enforce(request("/v1/identity/begin"), undefined)).outcome, "deny_exhausted");
  // A sibling ceremony surface has its own pool.
  assert.equal((await gate.enforce(request("/v1/identity/callback", "GET"), undefined)).outcome, "allow");
  // Off loopback there is no observable cohort or ceremony: denied as invalid input, never admitted.
  assert.equal((await gate.enforce(request("/v1/identity/begin", "POST", "203.0.113.9"), undefined)).outcome, "deny_input_invalid");
});
