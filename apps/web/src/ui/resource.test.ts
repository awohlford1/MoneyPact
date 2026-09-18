/**
 * CBD-35: unit tests for the extracted hook and the failure classifier, both moved verbatim out of
 * `(app)/journey.tsx` and factored into `./resource-state.ts`.
 *
 * `./resource.tsx` itself (the JSX built from these two: `Failure`, `DeniedState`, `StaleNotice`,
 * `PartialNotice`, `EmptyState`, `StatusRegion`) cannot be imported here: it uses `next/link`, resolvable only
 * through a bundler's own resolver, and this workspace's plain `node --test` has neither a bundler nor a JSX
 * transform for a `.tsx` file. `resource-state.ts` holds exactly the parts that build no JSX, for that reason,
 * and `Failure`'s rendered content per classification (title, sentence, whether a retry is offered) is verified
 * end to end by the browser suite instead (P01-AC02, CBD-218-AC02's denied/recoverable/terminal subtests).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/client.ts";
import { classifyFailure, useResource } from "./resource-state.ts";

test("classifyFailure: 401 and 403 are denied", () => {
  assert.equal(classifyFailure(new ApiError(401, "authorization_denied")), "denied");
  assert.equal(classifyFailure(new ApiError(403, "authorization_denied")), "denied");
});

test("classifyFailure: 404, 410 and 502 are terminal", () => {
  for (const status of [404, 410, 502]) assert.equal(classifyFailure(new ApiError(status, "not_found")), "terminal");
});

test("classifyFailure: every other ApiError status, and a non-ApiError, is recoverable (defaults to 503)", () => {
  for (const status of [500, 503, 429, 400, 409]) assert.equal(classifyFailure(new ApiError(status, "x")), "recoverable");
  assert.equal(classifyFailure(new Error("network")), "recoverable");
  assert.equal(classifyFailure(undefined), "recoverable");
});

test("classifyFailure: the three kinds are exhaustive and mutually exclusive for every status in range", () => {
  for (let status = 400; status < 600; status++) {
    const kind = classifyFailure(new ApiError(status, "x"));
    assert.ok(kind === "denied" || kind === "terminal" || kind === "recoverable");
    assert.equal(kind === "denied", status === 401 || status === 403);
    assert.equal(kind === "terminal", status === 404 || status === 410 || status === 502);
  }
});

test("useResource is still a real hook: called outside a component render it throws, rather than having silently degraded into a plain cache lookup", () => {
  assert.throws(() => useResource("id", async () => "x"));
});
