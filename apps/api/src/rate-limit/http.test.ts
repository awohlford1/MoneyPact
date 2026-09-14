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
