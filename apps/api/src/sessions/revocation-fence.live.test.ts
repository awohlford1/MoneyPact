/**
 * PROTO-ACTIVATION-001 A2 (review R02) live PostgreSQL proof: a session revocation, or its subject's
 * revocation-epoch bump, can no longer land *between the commit-time session read and the
 * mutation's COMMIT*. The race is injected through the fact-source `extend` hook, which the boundary
 * calls inside the mutation transaction right after the session read: at that instant a second,
 * root-client store starts revoking the session (or bumping the epoch) and the hook waits long
 * enough to observe whether that revoke completed. With the fence the revoke is serialized behind
 * the mutation's own session-row and authority-row writes: it cannot complete until the mutation
 * committed, so the mutation was committed by a session that was still live at COMMIT. The negative
 * control runs the same race with the fence off (`revocationFence: false`): the revoke completes
 * *during* the transaction and the mutation still commits afterwards -- a budget written by an
 * already-revoked session, which is exactly R02. A revoke that completes before the commit-time
 * read denies outright in both modes.
 *
 * Runs only when COBUDGET_DB_NAME names a migrated scratch database other than `cobudget_dev`
 * (same opt-in as mapping.live.test.ts):
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_activation npx tsx --test src/sessions/revocation-fence.live.test.ts
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { createSessionStore, SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";

const configured = loadLocalDatabaseConfig().database !== "cobudget_dev";
const DRAFT = { name: "Fence", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };

async function scenario(kind: "revoke" | "bump" | "none", fence: boolean) {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  const rootStore = createSessionStore(client);
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  const config = localConfig({ NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development", COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
  let raced = 0;
  let revokeCompletedDuringTransaction: boolean | undefined;
  let pendingRevoke: Promise<unknown> | undefined;
  let subject: { accountSubjectId: string; sessionRef: string } | undefined;
  const { app, runtime } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), {
    client, revocationFence: fence, scheduler: null,
    beforeCommit: async () => {
      // Inside the mutation transaction, after every session read and right before COMMIT: start a revoke through a
      // *root* store and observe whether it completes while the transaction is still open.
      if (subject && kind !== "none" && raced === 0) {
        raced++;
        let settled = false;
        pendingRevoke = (kind === "revoke" ? rootStore.markRevoked(subject.sessionRef, "logout") : rootStore.bumpSubjectEpoch(subject.accountSubjectId, "security_action")).then(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 750));
        revokeCompletedDuringTransaction = settled;
      }
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
    const created = await inject("POST", "/v1/budget-creation-proposals", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.json().csrfValue, "content-type": "application/json", "idempotency-key": randomUUID() }, DRAFT);
    await pendingRevoke;
    const rows = await client.platformSelect({ table: "budget_creation_proposal", columns: ["proposal_id"], conditions: [{ column: "environment", value: "development" }, { column: "account_subject_id", value: subject.accountSubjectId }] });
    const stillResolvable = (await inject("GET", "/v1/identity/me")).statusCode === 200;
    return { status: created.statusCode, body: created.body, proposals: rows.rows.length, raced, revokeCompletedDuringTransaction, stillResolvable, lastAudit: runtime.audit!.snapshot().at(-1) as { outcome?: string; reasonClass?: string } | undefined };
  } finally {
    await app.close();
    await pool.end();
  }
}

describe("PROTO-ACTIVATION-001 A2: revocation is fenced by the mutation transaction (live PostgreSQL)", { skip: !configured }, () => {
  it("control: without a race the proposal commits", async () => {
    const result = await scenario("none", true);
    assert.equal(result.status, 201, result.body);
    assert.equal(result.proposals, 1);
  });

  it("a revoke started between the commit-time session read and COMMIT is serialized behind the mutation: it cannot complete while the transaction is open, so the committing session was live at COMMIT", async () => {
    const result = await scenario("revoke", true);
    assert.equal(result.raced, 1, "the revoke was started inside the transaction");
    assert.equal(result.revokeCompletedDuringTransaction, false, "fenced: the root revoke blocked on the mutation's session-row write until COMMIT");
    assert.equal(result.status, 201, result.body);
    assert.equal(result.proposals, 1);
    assert.equal(result.stillResolvable, false, "the revoke applied after the commit, in serial order");
  });

  it("a subject-wide revocation-epoch bump started between the commit-time session read and COMMIT is serialized behind the mutation the same way", async () => {
    const result = await scenario("bump", true);
    assert.equal(result.raced, 1);
    assert.equal(result.revokeCompletedDuringTransaction, false, "fenced: the epoch bump blocked on the authority-row fence write until COMMIT");
    assert.equal(result.status, 201, result.body);
    assert.equal(result.stillResolvable, false);
  });

  it("negative control (R02 as found): with the fence off the revoke completes during the transaction and the mutation still commits afterwards", async () => {
    const result = await scenario("revoke", false);
    assert.equal(result.raced, 1);
    assert.equal(result.revokeCompletedDuringTransaction, true, "unfenced: the root revoke completed while the mutation transaction was still open");
    assert.equal(result.status, 201, `the already-revoked session's mutation still committed: ${result.body}`);
    assert.equal(result.proposals, 1, "a budget row written by a session that was revoked before COMMIT");
    assert.equal(result.stillResolvable, false);
  });
});
