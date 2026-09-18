/**
 * CBD-35 / P01-AC01: `MOCK_ROUTE_MODULES` dispatches in the order it is registered; a module that returns
 * `undefined` for a request it does not own falls through to the next one, and finally to whatever the caller
 * does when every module has passed (the existing ladder in `mock-server.ts`, in production).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMockInvitationRequest } from "./mock-invitations.ts";
import { handleMockReportsRequest } from "./mock-reports.ts";
import { handleMockGoalsRequest } from "./mock-goals.ts";
import type { MockRouteModule } from "./mock-registry.ts";
import { MOCK_ROUTE_MODULES } from "./mock-registry.ts";

const session = { accountSubjectId: "subject", csrf: "csrf" };
const request = new Request("http://localhost/api/mock/v1/whatever");

/** Exactly the loop `mock-server.ts` runs over `MOCK_ROUTE_MODULES`, exercised here against a throwaway registry. */
async function dispatch(modules: readonly MockRouteModule[], path: string[]): Promise<Response | undefined> {
  for (const routeModule of modules) {
    const owned = await routeModule({} as never, session, request, path, {}, Date.now);
    if (owned) return owned;
  }
  return undefined;
}

test("registers handleMockInvitationRequest first, then UI-P04's handleMockReportsRequest, then UI-P05's handleMockGoalsRequest, and no more (yet)", () => {
  assert.equal(MOCK_ROUTE_MODULES[0], handleMockInvitationRequest);
  assert.equal(MOCK_ROUTE_MODULES[1], handleMockReportsRequest);
  assert.equal(MOCK_ROUTE_MODULES[2], handleMockGoalsRequest);
  assert.equal(MOCK_ROUTE_MODULES.length, 3, "the next packet after UI-P05 appends the next entry");
});

test("a module returning undefined falls through to the next one", async () => {
  const first: MockRouteModule = async () => undefined;
  const second: MockRouteModule = async () => new Response(null, { status: 204 });
  const response = await dispatch([first, second], ["anything"]);
  assert.equal(response?.status, 204);
});

test("every module returning undefined falls through to the existing ladder (undefined, here)", async () => {
  const passes: MockRouteModule = async () => undefined;
  const response = await dispatch([passes, passes], ["anything"]);
  assert.equal(response, undefined);
});

test("the first module to answer wins; a later module in the registry is never consulted", async () => {
  let secondCalled = false;
  const first: MockRouteModule = async () => new Response(null, { status: 200 });
  const second: MockRouteModule = async () => { secondCalled = true; return undefined; };
  const response = await dispatch([first, second], ["anything"]);
  assert.equal(response?.status, 200);
  assert.equal(secondCalled, false);
});
