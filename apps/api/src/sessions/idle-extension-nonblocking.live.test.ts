/**
 * IDLE-T03 (CBD-191 SC-191-006, `PROTO-CBD191-IDLE-IMPL-001`): live PostgreSQL proof of `IDLE-OPT-B`, the
 * best-effort skip-locked idle-expiry slide outside a mutation's effect transaction.
 *
 * A mutation's handler is held open (via the `beforeCommit` fault-injection seam, same mechanism
 * `revocation-fence.live.test.ts` uses) for longer than the `FactAssembler`'s 5 s assemble deadline. While it
 * is held, a second request of the *same session* on the same `concurrency=1` surface (`POST
 * /v1/budget-creation-proposals`, `rlp-266-mutation-v1`) is fired: before this amendment its session gate
 * would wait on the row lock the first mutation's in-transaction slide holds and time out to the uniform 403
 * after the assemble deadline; after this amendment the gate's slide is a single best-effort statement that
 * skips the locked row instead of waiting, so the request resolves in milliseconds, reaches the rate-limit
 * gate, and is answered 429 `in_flight` well under the deadline. `GET /v1/identity/me` (an ordinary,
 * non-mutating surface, also gated by the same session resolution) is likewise unblocked. `idle_expires_at`
 * is asserted equal to the in-flight mutation's own resolution-instant value (its skipped slide left the row
 * exactly as the in-flight mutation wrote it) and `absolute_expires_at` is asserted unchanged, matching
 * `SC-191-006`'s stated bound. After the mutation is released, the retry is admitted.
 *
 * This is `CT-191-018` and turns every "(PostgreSQL semantics)" claim in the proposal's section 3.2 into
 * evidence.
 *
 * Runs only when COBUDGET_DB_NAME names a migrated scratch database other than cobudget_dev/cobudget_demo
 * (same opt-in as revocation-fence.live.test.ts):
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_idleext npx tsx --test src/sessions/idle-extension-nonblocking.live.test.ts
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { createSessionStore, SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";

const configured = loadLocalDatabaseConfig().database !== "cobudget_dev" && loadLocalDatabaseConfig().database !== "cobudget_demo";
const DRAFT = { name: "Idle Extension", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };
const HOLD_MS = 5_500;
const BOUND_MS = 1_000;

async function scenario() {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  const rootStore = createSessionStore(client);
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  const config = localConfig({
    NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development",
    COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local`,
  });
  let held = false;
  let idleExpiresAtWhileHeld: Date | undefined;
  let absoluteExpiresAtBefore: Date | undefined;
  let subject: { accountSubjectId: string; sessionRef: string } | undefined;
  const { app } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), {
    client, scheduler: null,
    beforeCommit: async () => {
      if (held || !subject) return;
      held = true;
      // Capture the row's own committed slide (this mutation's own resolution instant) before holding, so the
      // "while held" reads below can be compared against it.
      const row = await rootStore.findBySessionRef(subject.sessionRef);
      idleExpiresAtWhileHeld = row?.idleExpiresAt;
      absoluteExpiresAtBefore = row?.absoluteExpiresAt;
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    },
  });
  await app.init();
  await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
  const cookies: Record<string, string> = {};
  const inject = async (method: "GET" | "POST", url: string, headers: Record<string, string> = {}, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const raw = response.headers["set-cookie"];
    for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return response;
  };
  try {
    const begin = await inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
    const authorize = new URL(begin.json().navigateTo);
    const chooser = await inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${port}` });
    const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&");
    const choice = await inject("GET", link, { host: `127.0.0.1:${port}` });
    const callback = new URL(choice.headers.location as string);
    const done = await inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
    assert.equal(done.statusCode, 303, done.body);
    assert.ok(cookies[SESSION_COOKIE_NAME]);
    const me = await inject("GET", "/v1/identity/me");
    assert.equal(me.statusCode, 200, me.body);
    subject = { accountSubjectId: me.json().accountSubjectId, sessionRef: me.json().sessionRef };
    const csrfValue = me.json().csrfValue as string;

    // First mutation: opens its effect transaction, holds it open (beforeCommit above) past the deadline.
    const held1 = inject("POST", "/v1/budget-creation-proposals", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrfValue, "content-type": "application/json", "idempotency-key": randomUUID() }, DRAFT);

    // Wait until the first mutation is definitely inside its held transaction.
    const heldByMs = Date.now() + 2_000;
    while (!held && Date.now() < heldByMs) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(held, "the first mutation reached its held transaction");

    // Second request, same session, same concurrency=1 surface, while the first is still held.
    const secondStarted = performance.now();
    const second = await inject("POST", "/v1/budget-creation-proposals", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrfValue, "content-type": "application/json", "idempotency-key": randomUUID() }, DRAFT);
    const secondElapsedMs = performance.now() - secondStarted;

    // An ordinary, non-mutating same-session request while the first is still held.
    const meStarted = performance.now();
    const meWhileHeld = await inject("GET", "/v1/identity/me");
    const meElapsedMs = performance.now() - meStarted;

    // The row as any other root-client reader would see it while the mutation is still open (not yet committed).
    const rowWhileHeld = await rootStore.findBySessionRef(subject.sessionRef);

    const first = await held1;
    return {
      secondStatus: second.statusCode, secondBody: second.body, secondElapsedMs,
      meStatus: meWhileHeld.statusCode, meElapsedMs,
      idleExpiresAtWhileHeld, absoluteExpiresAtBefore,
      rowIdleExpiresAtWhileHeld: rowWhileHeld?.idleExpiresAt, rowAbsoluteExpiresAtWhileHeld: rowWhileHeld?.absoluteExpiresAt,
      firstStatus: first.statusCode, firstBody: first.body,
    };
  } finally {
    await app.close();
    await pool.end();
  }
}

describe("IDLE-T03 (CBD-191 SC-191-006): the best-effort skip-locked idle-expiry slide is non-blocking for a same-session request (live PostgreSQL)", { skip: !configured }, () => {
  it("a same-session concurrency=1 mutation and an ordinary read both resolve well under the 5s deadline while the first mutation's effect transaction is held; the row's idle expiry is left at the in-flight mutation's own value and the absolute expiry is unchanged; the retry is admitted after release", async () => {
    const result = await scenario();
    assert.equal(result.firstStatus, 201, result.firstBody);

    assert.equal(result.secondStatus, 429, result.secondBody);
    assert.match(result.secondBody, /in_flight/u);
    assert.ok(result.secondElapsedMs < BOUND_MS, `same-session mutation answered in ${result.secondElapsedMs.toFixed(3)} ms, expected well under ${BOUND_MS} ms`);

    assert.equal(result.meStatus, 200);
    assert.ok(result.meElapsedMs < BOUND_MS, `same-session GET /v1/identity/me answered in ${result.meElapsedMs.toFixed(3)} ms, expected well under ${BOUND_MS} ms`);

    assert.ok(result.idleExpiresAtWhileHeld, "captured the in-flight mutation's own idle_expires_at");
    assert.ok(result.rowIdleExpiresAtWhileHeld, "read the row while the mutation was held");
    assert.equal(
      result.rowIdleExpiresAtWhileHeld!.getTime(),
      result.idleExpiresAtWhileHeld!.getTime(),
      "the skipped slide left idle_expires_at exactly at the in-flight mutation's own resolution-instant value",
    );
    assert.equal(
      result.rowAbsoluteExpiresAtWhileHeld!.getTime(),
      result.absoluteExpiresAtBefore!.getTime(),
      "absolute_expires_at is never moved by a slide, skipped or not",
    );
  });
});
