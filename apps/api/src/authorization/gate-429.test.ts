/**
 * EXEC-POV-C200F01-001 item 3 (PROTO-CBD266-CONCURRENCY-429-001, G429-01): a verified actor's second in-flight
 * mutation on `rlp-266-mutation-v1` (`concurrency=1`) answers 429 with Retry-After instead of the uniform 403;
 * every other refusal keeps the uniform denial; and the 429 is unreachable before session verification.
 *
 * The last point is the CBD-268 uniform-denial proof for this answer: an unauthenticated caller is rejected at
 * the session gate before the counter store is consulted, so whether the actor's bucket is idle or busy changes
 * neither the bytes nor the work done for that caller. The structural assertion (zero store consumes for the
 * unauthenticated class in both states; identical status, body and header set) is the load-bearing one; the
 * timing sample is recorded against a generous tolerance so the harness cannot flake under load while still
 * catching a counter lookup or an audit write added to the unauthenticated path.
 */
import { apiIdentity, InProcessCounterStore, invocation, loadPrototypeRegistry } from "../../../../packages/rate-limit/src/index.ts";
import type { CounterStore, Registration } from "../../../../packages/rate-limit/src/index.ts";
import { ApiRateLimits } from "../rate-limit/http.js";
import "reflect-metadata";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { Controller, HttpException, Post } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module.js";
import { loadApiConfigFrom } from "../config.js";
import { Authorization, Authorize, PreAuthenticationSurface } from "./http.js";
import type { EffectContext } from "./boundary.js";
import { Harness, testHistory } from "./test-support.js";
import type { TestState } from "./test-support.js";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "gate-429-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const MUTATION: Registration = { registration_id: "api:POST:/protected/held", executor_kind: "api_route", source_locator: "gate-429.test.ts#held", surface_id: "surf-266-budget-mutation", parameter_record_id: "rlp-266-mutation-v1", registration_lifecycle: "active", introduced_by: "PROTO-CBD266-CONCURRENCY-429-001", authorization_metadata_id: "space.create" };
let handlerCalls = 0;
let release: () => void = () => undefined;
const UNIFORM = { outcome: "deny", reason: "denied" };

@Controller("protected")
class HeldController {
  /** Holds inside its effect until the test releases it, so a second attempt by the same actor arrives in flight. */
  @Post("held")
  @Authorize({ action: "space.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
  async held(@Authorization() effect: EffectContext): Promise<unknown> {
    handlerCalls++;
    await new Promise<void>((resolve) => { release = resolve; });
    (effect.transaction as TestState).spaces.push(effect.input.bootstrap!.candidateSpaceId);
    return { created: true };
  }
}
@Controller("protected")
class BootstrapController {
  @Post("bootstrap")
  @Authorize({ action: "space.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
  create(@Authorization() effect: EffectContext): unknown { handlerCalls++; (effect.transaction as TestState).spaces.push(effect.input.bootstrap!.candidateSpaceId); return { created: true }; }
}
@Controller("v1/identity")
class PreController { @Post("begin") @PreAuthenticationSurface() begin(): unknown { handlerCalls++; return { never: true }; } }

async function heldApplication(h: Harness) {
  const inner = new InProcessCounterStore(); let consumes = 0;
  const store: CounterStore = { consume: async (input) => { consumes++; return inner.consume(input); } };
  const gate = new ApiRateLimits("test-only", loadPrototypeRegistry(), [MUTATION], store);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true, rateLimit: gate,
      sessionLocator: (request) => request.headers.cookie,
      deny: (response) => { throw new HttpException(response, 403); }, // Synthetic response contract for this test only.
    }, testHistory)],
    controllers: [HeldController],
  }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  return { app, consumes: () => consumes };
}
const enforcement = (h: Harness) => (h.state.audits.at(-1) as unknown as { enforcement?: { earliest_decisive_gate: string; safe_reason_class: string; authorization_evaluation: string; counter_store_evidence: string } }).enforcement;
const shape = (response: { statusCode: number; body: string; headers: Record<string, unknown> }) => ({ status: response.statusCode, body: response.body, headers: Object.keys(response.headers).filter((k) => !["content-length", "date"].includes(k)).sort() });
async function untilHandler(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (handlerCalls < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(handlerCalls, count, `handler call ${count} reached`);
}

describe("EXEC-POV-C200F01-001 item 3: a verified actor's second in-flight mutation answers 429 Retry-After; nothing else changes shape", () => {
  it("G429-01: the second in-flight mutation is 429 {outcome: retry, reason: in_flight} with Retry-After: 1, audited as the surface gate, nothing written; the retry after release succeeds", async () => {
    handlerCalls = 0; const h = new Harness(); const { app, consumes } = await heldApplication(h);
    try {
      const first = app.inject({ method: "POST", url: "/protected/held", headers: { cookie: "opaque" } });
      await untilHandler(1);
      const second = await app.inject({ method: "POST", url: "/protected/held", headers: { cookie: "opaque" } });
      assert.equal(second.statusCode, 429); assert.deepEqual(second.json(), { outcome: "retry", reason: "in_flight" });
      assert.equal(second.headers["retry-after"], "1");
      assert.equal(handlerCalls, 1, "the second attempt never reached the handler");
      assert.equal(consumes(), 2, "the store was asked once per attempt and refused the second");
      const audit = enforcement(h);
      assert.deepEqual({ gate: audit?.earliest_decisive_gate, reason: audit?.safe_reason_class, policy: audit?.authorization_evaluation, store: audit?.counter_store_evidence },
        { gate: "surface", reason: "deny_in_flight", policy: "not_run", store: "exhausted" });
      assert.equal(h.state.spaces.length, 0, "nothing is written while the first is still in flight");
      release(); const completed = await first;
      assert.equal(completed.statusCode, 201); assert.equal(h.state.spaces.length, 1);
      const retry = app.inject({ method: "POST", url: "/protected/held", headers: { cookie: "opaque" } });
      await untilHandler(2); release();
      assert.equal((await retry).statusCode, 201, "released: the retry is admitted on the same actor's bucket");
      assert.equal(h.state.spaces.length, 2);
    } finally { release(); await app.close(); }
  });
  it("G429-01 / CBD-268: an unauthenticated caller cannot reach the 429 -- same status, body and header set as when idle, the counter store never consulted, timing within tolerance", async (t) => {
    handlerCalls = 0; const h = new Harness(); const { app, consumes } = await heldApplication(h);
    const unauthenticated = () => app.inject({ method: "POST", url: "/protected/held" });
    const median = async (): Promise<number> => {
      const durations: number[] = [];
      for (let i = 0; i < 10; i++) await unauthenticated();
      for (let i = 0; i < 60; i++) { const started = performance.now(); await unauthenticated(); durations.push(performance.now() - started); }
      return durations.sort((a, b) => a - b)[30]!;
    };
    try {
      const idle = await unauthenticated();
      assert.equal(idle.statusCode, 403); assert.deepEqual(idle.json(), UNIFORM);
      assert.equal(consumes(), 0, "the session gate rejects before the counter is consulted");
      const idleMedian = await median();
      const first = app.inject({ method: "POST", url: "/protected/held", headers: { cookie: "opaque" } });
      await untilHandler(1);
      const consumedByActor = consumes(); assert.equal(consumedByActor, 1);
      const busy = await unauthenticated();
      assert.deepEqual(shape(busy), shape(idle), "the unauthenticated denial is the same bytes and header set whether the actor's bucket is idle or busy");
      assert.equal(busy.headers["retry-after"], undefined);
      const busyMedian = await median();
      assert.equal(consumes(), consumedByActor, "no unauthenticated request touched the counter store while the actor's mutation was in flight");
      assert.equal(enforcement(h)?.safe_reason_class, "not_authenticated");
      // Tolerance: 5 ms absolute on the median of 60 in-process injections after 10 warm-ups, per class. Both classes do
      // identical work (session rejection, one audit append, the uniform body); a counter lookup would add a key
      // derivation, an atomic consume and a different audit shape, and an in-flight answer would change the bytes --
      // both are caught structurally above, so the sample is a recorded observation rather than the sole guard.
      t.diagnostic(`CBD-268 sample: unauthenticated median idle ${idleMedian.toFixed(3)} ms, busy ${busyMedian.toFixed(3)} ms, tolerance 5 ms, 60 samples after 10 warm-ups per class`);
      assert.ok(Math.abs(busyMedian - idleMedian) <= 5, `unauthenticated median idle ${idleMedian.toFixed(3)} ms vs busy ${busyMedian.toFixed(3)} ms exceeds the 5 ms tolerance`);
      release(); assert.equal((await first).statusCode, 201);
    } finally { release(); await app.close(); }
  });
  it("G429-01: the same actor's sliding-ceiling exhaustion stays the uniform 403 with no Retry-After", async () => {
    handlerCalls = 0; const h = new Harness(); const { app } = await heldApplication(h);
    try {
      for (let i = 0; i < 15; i++) {
        const pending = app.inject({ method: "POST", url: "/protected/held", headers: { cookie: "opaque" } });
        await untilHandler(i + 1); release();
        assert.equal((await pending).statusCode, 201, `unit ${i + 1}`);
      }
      const exhausted = await app.inject({ method: "POST", url: "/protected/held", headers: { cookie: "opaque" } });
      assert.equal(exhausted.statusCode, 403); assert.deepEqual(exhausted.json(), UNIFORM);
      assert.equal(exhausted.headers["retry-after"], undefined);
      assert.equal(enforcement(h)?.safe_reason_class, "deny_exhausted");
      assert.equal(handlerCalls, 15); assert.equal(h.state.spaces.length, 15);
    } finally { release(); await app.close(); }
  });
  it("G429-01: deny_in_flight is answered 429 only after a resolved session; a pre-authentication surface or an anonymous caller never receives it even when the gate reports it", async () => {
    handlerCalls = 0; const h = new Harness();
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config, () => undefined, {
        boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true,
        // A synthetic gate that reports deny_in_flight for every request.
        rateLimit: { evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"), enforce: async () => ({ outcome: "deny_in_flight" }) },
        sessionLocator: (request) => request.headers.cookie,
        deny: (response) => { throw new HttpException(response, 403); },
      }, testHistory)],
      controllers: [BootstrapController, PreController],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    try {
      await app.init(); await app.getHttpAdapter().getInstance().ready();
      const verified = await app.inject({ method: "POST", url: "/protected/bootstrap", headers: { cookie: "opaque" } });
      assert.equal(verified.statusCode, 429); assert.equal(verified.headers["retry-after"], "1");
      const pre = await app.inject({ method: "POST", url: "/v1/identity/begin" });
      assert.equal(pre.statusCode, 403); assert.deepEqual(pre.json(), UNIFORM); assert.equal(pre.headers["retry-after"], undefined);
      const anonymous = await app.inject({ method: "POST", url: "/protected/bootstrap" });
      assert.equal(anonymous.statusCode, 403); assert.deepEqual(anonymous.json(), UNIFORM); assert.equal(anonymous.headers["retry-after"], undefined);
      assert.equal(handlerCalls, 0);
      // The 429 and the 403 differ in header set only by Retry-After.
      const difference = shape(verified).headers.filter((k) => !shape(anonymous).headers.includes(k));
      assert.deepEqual(difference, ["retry-after"]);
    } finally { await app.close(); }
  });
  it("SEC-G429-F1: a verified actor without the CSRF/origin proof is answered the uniform 403 with no Retry-After even when the gate reports deny_in_flight", async () => {
    handlerCalls = 0; const h = new Harness();
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config, () => undefined, {
        boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => false,
        rateLimit: { evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"), enforce: async () => ({ outcome: "deny_in_flight" }) },
        sessionLocator: (request) => request.headers.cookie,
        deny: (response) => { throw new HttpException(response, 403); },
      }, testHistory)],
      controllers: [BootstrapController],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    try {
      await app.init(); await app.getHttpAdapter().getInstance().ready();
      const unproven = await app.inject({ method: "POST", url: "/protected/bootstrap", headers: { cookie: "opaque" } });
      assert.equal(unproven.statusCode, 403); assert.deepEqual(unproven.json(), UNIFORM); assert.equal(unproven.headers["retry-after"], undefined);
      assert.equal(handlerCalls, 0);
    } finally { await app.close(); }
  });
});
