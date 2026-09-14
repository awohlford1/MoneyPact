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

it("PROTO-ACTIVATION-001 A7: a surface bound to the bootstrap record counts the ceremony the runtime resolves -- per-ceremony buckets, the initial space.create reservation once per ceremony, and nothing without a resolvable ceremony", async () => {
  const registration = (id: string, surface = "surf-266-authentication") => ({
    registration_id: id, executor_kind: "api_route" as const, source_locator: "fixture.ts#ceremony",
    surface_id: surface, parameter_record_id: "rlp-266-bootstrap-v1",
    registration_lifecycle: "active" as const, introduced_by: "test", authorization_metadata_id: surface === "surf-266-authentication" ? null : "space.create",
  });
  const contexts: Record<string, { ceremonyId?: string; bootstrapStage?: "ordinary" | "initial_space_create"; primaryOwnerVerified?: boolean }> = {
    "/v1/identity/callback?a": { ceremonyId: "ceremony-a", bootstrapStage: "ordinary" },
    "/v1/identity/callback?b": { ceremonyId: "ceremony-b", bootstrapStage: "ordinary" },
    "/v1/identity/callback?none": {},
    "/confirm-a": { ceremonyId: "ceremony-a", bootstrapStage: "initial_space_create", primaryOwnerVerified: true },
  };
  const gate = new ApiRateLimits("test", loadPrototypeRegistry(), [registration("api:GET:/v1/identity/callback"), registration("api:POST:/confirm", "surf-266-authentication")], undefined, async (request) => contexts[request.url] ?? {});
  const request = (url: string, routeUrl: string, method = "GET", ip = "127.0.0.1") => ({ method, url, routeOptions: { url: routeUrl }, ip }) as FastifyRequest;
  // Six ordinary units per ceremony; a sibling ceremony has its own bucket, so one ceremony's traffic cannot block another's completion.
  for (let attempt = 0; attempt < 6; attempt++) {
    const decision = await gate.enforce(request("/v1/identity/callback?a", "/v1/identity/callback"), undefined);
    assert.equal(decision.outcome, "allow", `ceremony a attempt ${attempt}`);
    if (decision.outcome === "allow") await decision.release();
  }
  assert.equal((await gate.enforce(request("/v1/identity/callback?a", "/v1/identity/callback"), undefined)).outcome, "deny_exhausted");
  assert.equal((await gate.enforce(request("/v1/identity/callback?b", "/v1/identity/callback"), undefined)).outcome, "allow");
  // The reserved initial space.create unit is separate from the ordinary units and consumed once per ceremony.
  const first = await gate.enforce(request("/confirm-a", "/confirm", "POST"), "actor-a");
  assert.equal(first.outcome, "allow", "the reservation is intact after the ordinary pool was exhausted");
  if (first.outcome === "allow") await first.release();
  assert.equal((await gate.enforce(request("/confirm-a", "/confirm", "POST"), "actor-a")).outcome, "deny_exhausted", "one initial create per ceremony");
  // No resolvable ceremony (unknown state), or off loopback: never admitted.
  assert.equal((await gate.enforce(request("/v1/identity/callback?none", "/v1/identity/callback"), undefined)).outcome, "deny_input_invalid");
  assert.equal((await gate.enforce(request("/v1/identity/callback?a", "/v1/identity/callback", "GET", "203.0.113.9"), undefined)).outcome, "deny_input_invalid");
});
