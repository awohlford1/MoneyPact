/**
 * PROTO-ACTIVATION-001 A1 (review R01, CBD-191 section 5.1): every cookie-authenticated mutation
 * proves the exact Origin, `Sec-Fetch-Site: same-origin` and the `X-CoBudget-CSRF` bootstrap value
 * before any replay lookup, policy evaluation or effect. Driven through the composed runtime and the
 * real Fastify instance: a browser signs in on the local adapter, receives the bootstrap value, and
 * then POSTs a proposal, a confirmation, and PUTs categories and targets with each signal missing or
 * wrong in turn. Each is the uniform denial at the session gate, the route handlers and the policy
 * boundary are never reached, and the same request with the right signals passes the guard.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { createComposedApiApplication } from "../application.js";
import type { ApiSurfaceGate } from "../rate-limit/http.js";
import { testHistory } from "./test-support.js";
import { createFakeIdentityClient, FakeIdentityDatabase } from "../identity/test-support/fake-client.ts";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";

const PROPOSAL = "bcp_" + "a".repeat(32);
const SPACE = "11111111-1111-4111-8111-111111111111";
const MUTATIONS = [
  ["POST", "/v1/budget-creation-proposals", { name: "Plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } }],
  ["POST", `/v1/budget-creation-proposals/${PROPOSAL}/confirm`, { confirmationBinding: "binding" }],
  ["PUT", `/v1/budget-spaces/${SPACE}/categories`, { categories: [{ label: "Groceries" }] }],
  ["PUT", `/v1/budget-spaces/${SPACE}/targets`, { targets: [] }],
] as const;

/** The surface gate is not under test here; the real one reserves exactly one initial `space.create` per ceremony (bootstrap set), which these eight confirm attempts would exhaust. */
const permissiveGate: ApiSurfaceGate = {
  evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url ?? "/"), "api_route", "test-only", "test-only"),
  enforce: async () => ({ outcome: "allow", provenance: "test-only", release: async () => undefined }),
};

async function browserSession() {
  const db = new FakeIdentityDatabase();
  const { app, runtime } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), rateLimit: permissiveGate, scheduler: null });
  await app.init();
  const server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  const cookies: Record<string, string> = {};
  const inject = async (method: "GET" | "POST" | "PUT", url: string, headers: Record<string, string> = {}, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const raw = response.headers["set-cookie"];
    for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return response;
  };
  const begin = await inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  const authorize = new URL(begin.json().navigateTo);
  const chooser = await inject("GET", `${authorize.pathname}${authorize.search}`, { host: "127.0.0.1:3001" });
  const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&");
  const choice = await inject("GET", link, { host: "127.0.0.1:3001" });
  const callback = new URL(choice.headers.location as string);
  const done = await inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
  assert.equal(done.statusCode, 303, done.body);
  assert.ok(cookies[SESSION_COOKIE_NAME]);
  const me = await inject("GET", "/v1/identity/me");
  assert.equal(me.statusCode, 200, me.body);
  const csrf = me.json().csrfValue as string;
  assert.ok(csrf);
  return { app, runtime, inject, csrf };
}

describe("PROTO-ACTIVATION-001 A1: CSRF enforcement on every cookie-authenticated mutation", () => {
  for (const [method, url, payload] of MUTATIONS) it(`${method} ${url}: denies uniformly at the session gate for a missing header, a wrong header, cross-site fetch metadata and a wrong origin, without reaching the policy boundary`, async () => {
    const { app, runtime, inject, csrf } = await browserSession();
    try {
      const good = { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrf, "content-type": "application/json", "idempotency-key": "1111111111111111" };
      const variants: [string, Record<string, string>][] = [
        ["missing header", { ...good, "x-cobudget-csrf": "" }],
        ["wrong header", { ...good, "x-cobudget-csrf": csrf.split("").reverse().join("") }],
        ["cross-site fetch metadata", { ...good, "sec-fetch-site": "cross-site" }],
        ["no fetch metadata", { ...good, "sec-fetch-site": "" }],
        ["wrong origin", { ...good, origin: "https://evil.example" }],
        ["no origin", { ...good, origin: "" }],
      ];
      {
        for (const [label, headers] of variants) {
          const clean = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ""));
          const before = runtime.audit!.snapshot().length;
          const response = await inject(method, url, clean, payload as Record<string, unknown>);
          assert.equal(response.statusCode, 403, `${method} ${url} with ${label}: ${response.body}`);
          assert.deepEqual(response.json(), { outcome: "deny", reason: "denied" }, `${method} ${url} with ${label}: uniform denial body`);
          const events = runtime.audit!.snapshot().slice(before) as { enforcement?: { earliest_decisive_gate: string; authorization_evaluation: string } }[];
          assert.equal(events.length, 1, `${label}: exactly one enforcement denial recorded`);
          assert.equal(events[0]!.enforcement?.earliest_decisive_gate, "session", `${label}: denied at the session gate (${JSON.stringify(events[0]!.enforcement)})`);
          assert.equal(events[0]!.enforcement?.authorization_evaluation, "not_run", `${label}: policy was never evaluated`);
        }
        // The same request with every signal correct passes the CSRF guard: whatever happens next is the policy's
        // decision (this fake database has no budget tables), never the session gate's.
        const before = runtime.audit!.snapshot().length;
        const passed = await inject(method, url, good, payload as Record<string, unknown>);
        const events = runtime.audit!.snapshot().slice(before) as { enforcement?: { earliest_decisive_gate: string } }[];
        assert.ok(passed.statusCode !== 403 || events.every((event) => event.enforcement?.earliest_decisive_gate !== "session"), `${method} ${url}: correct signals are not stopped by the CSRF guard (${passed.statusCode} ${passed.body})`);
      }
      // Safe methods need no CSRF value: a GET without any CSRF signal is never stopped at the session gate.
      const before = runtime.audit!.snapshot().length;
      await inject("GET", "/v1/budget-spaces");
      const reads = runtime.audit!.snapshot().slice(before) as { enforcement?: { earliest_decisive_gate: string } }[];
      assert.ok(reads.every((event) => event.enforcement?.earliest_decisive_gate !== "session"), "a safe method is not subject to the CSRF guard");
    } finally { await app.close(); }
  });
});
