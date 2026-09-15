/**
 * CBD-236 p6 live PostgreSQL proof (docs/cbd-236-p6-subject-self-amendment-proposal.md
 * `P6-E04`, `P6-D02`; `PROTO-CONTRACTS-P6-IMPL-001`).
 *
 * `PUT /v1/identity/me/display-name`, run through the real Fastify
 * application, the real `ApiAuthorizationBoundary`, the real fact assembler,
 * the real `profile.set_display_name` p6 subject-self cell and the real
 * `financial_profile.display_name`/`version` columns: a real subject signs
 * in through the local issuer, sets a display name, and the write is proven
 * against the actual row -- the version advances, `GET /v1/identity/me`
 * reflects it, the 1..80-code-point bound denies `400` without a second
 * write, and a request with no CSRF value is denied before any write. The
 * `version_conflict` (`409`) branch is proven directly against a fake
 * `ProfileStatementClient` in `display-name-write.test.ts`, not here:
 * `recheck_at_commit` re-reads `profile.profileVersion` inside the same
 * SERIALIZABLE transaction the handler runs in, immediately before
 * `writeDisplayName`'s own compare-and-set, so a stale `expectedVersion` is
 * not reachable from two sequential HTTP requests against this route.
 *
 * Opt-in exactly like `primary-transfer/ownership-version.live.test.ts`:
 * `COBUDGET_DB_NAME` must name a migrated scratch database other than
 * `cobudget_dev` or `cobudget_demo`, created fresh (owner
 * `cobudget_migration`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`).
 * Nothing here starts Docker, resets, or cleans up.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_p6_live npx tsx --test src/identity/display-name.live.test.ts
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import type { DataAccessClient } from "@cobudget/data-access";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "./test-support/harness.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";

type Response = { statusCode: number; body: string; headers: Record<string, unknown>; json: () => any };
interface Harness {
  readonly client: DataAccessClient;
  readonly port: number;
  readonly cookies: Record<string, string>;
  readonly inject: (method: "GET" | "PUT" | "POST", url: string, headers?: Record<string, string>, payload?: Record<string, unknown>) => Promise<Response>;
  readonly close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  const locatorPool = createApiConnection();
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  const config = localConfig({ NODE_ENV: "development", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 11).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "p6-live-v1", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development", COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
  const { app } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, locator: locatorPool, scheduler: null });
  await app.init();
  await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
  const cookies: Record<string, string> = {};
  const inject: Harness["inject"] = async (method, url, headers = {}, payload) => {
    const response = await app.inject({ method, url, remoteAddress: "127.0.0.1", headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const raw = response.headers["set-cookie"];
    for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return response as unknown as Response;
  };
  return { client, port, cookies, inject, close: async () => { await app.close(); await pool.end(); await locatorPool.end(); } };
}

/** Walks the local chooser as `scenario` from an already-begun ceremony URL, and returns the terminating callback's status. */
async function walkChooser(h: Harness, navigateTo: string, scenario: "subject-a" | "subject-b"): Promise<Response> {
  const authorize = new URL(navigateTo);
  const chooser = await h.inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${h.port}` });
  const link = new RegExp(`href="([^"]+scenario=${scenario})"`).exec(chooser.body)![1]!.replaceAll("&amp;", "&");
  const choice = await h.inject("GET", link, { host: `127.0.0.1:${h.port}` });
  const callback = new URL(choice.headers.location as string);
  return h.inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
}

async function signIn(h: Harness, scenario: "subject-a" | "subject-b" = "subject-a"): Promise<{ accountSubjectId: string; csrfValue: string }> {
  delete h.cookies[SESSION_COOKIE_NAME];
  const begin = await h.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  assert.equal(begin.statusCode, 200, begin.body);
  const done = await walkChooser(h, begin.json().navigateTo, scenario);
  assert.equal(done.statusCode, 303, done.body);
  assert.ok(h.cookies[SESSION_COOKIE_NAME], "the sign-in delivered a session cookie");
  const me = await h.inject("GET", "/v1/identity/me");
  assert.equal(me.statusCode, 200, me.body);
  return { accountSubjectId: me.json().accountSubjectId, csrfValue: me.json().csrfValue };
}

const mutation = (csrf: string) => ({ origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrf, "content-type": "application/json" });

async function displayColumn(client: DataAccessClient, accountSubjectId: string): Promise<{ display_name: string | null; version: number }> {
  const result = await client.profileSelect!({ table: "financial_profile", accountSubjectId, columns: ["display_name", "version"] });
  const row = result.rows[0] as { display_name: string | null; version: unknown };
  return { display_name: row.display_name, version: Number(row.version) };
}

describe("CBD-236 p6 live: PUT /v1/identity/me/display-name against real PostgreSQL", { skip: !configured }, () => {
  it("sets the caller's own display_name, advances version, is served back from GET /v1/identity/me, denies the 1..80-code-point bound as 400 without a second write, and denies a request with no CSRF value", async () => {
    const h = await harness();
    try {
      // CBD-190 identity amendments proposal §2: subject-b carries no local-issuer name claim, so this
      // route-focused live test stays independent of the first-sign-in display-name write (covered
      // separately in first-sign-in-name.live.test.ts).
      const { accountSubjectId, csrfValue } = await signIn(h, "subject-b");
      const before = await displayColumn(h.client, accountSubjectId);
      assert.equal(before.display_name, null, "unset until this route writes it (P6-F01)");

      const initialMe = await h.inject("GET", "/v1/identity/me");
      assert.equal(initialMe.json().displayName, null, "the me view serves the unset display name as null");

      const set = await h.inject("PUT", "/v1/identity/me/display-name", mutation(csrfValue), { displayName: "  Alex W.  " });
      assert.equal(set.statusCode, 200, set.body);
      assert.deepEqual(set.json(), { displayName: "Alex W.", version: before.version + 1 });
      const afterFirst = await displayColumn(h.client, accountSubjectId);
      assert.equal(afterFirst.display_name, "Alex W.", "trimmed and persisted on the real row");
      assert.equal(afterFirst.version, before.version + 1, "the compare-and-set advanced version (SEC-PK2-F08)");

      const meAfter = await h.inject("GET", "/v1/identity/me");
      assert.equal(meAfter.json().displayName, "Alex W.", "the me route now serves the display name (P6-D03)");

      // The 1..80-code-point bound denies 400 and writes nothing.
      const empty = await h.inject("PUT", "/v1/identity/me/display-name", mutation(csrfValue), { displayName: "   " });
      assert.equal(empty.statusCode, 400, empty.body);
      assert.equal((await displayColumn(h.client, accountSubjectId)).version, afterFirst.version, "nothing written by the empty rejection");

      const tooLong = await h.inject("PUT", "/v1/identity/me/display-name", mutation(csrfValue), { displayName: "x".repeat(81) });
      assert.equal(tooLong.statusCode, 400, tooLong.body);
      assert.equal((await displayColumn(h.client, accountSubjectId)).version, afterFirst.version, "nothing written by the over-length rejection");

      const eighty = await h.inject("PUT", "/v1/identity/me/display-name", mutation(csrfValue), { displayName: "y".repeat(80) });
      assert.equal(eighty.statusCode, 200, eighty.body);
      const afterEighty = await displayColumn(h.client, accountSubjectId);
      assert.equal(afterEighty.display_name, "y".repeat(80));
      assert.equal(afterEighty.version, afterFirst.version + 1);

      // The route's own version_conflict (409) branch -- writeDisplayName's expectedVersion mismatch -- is proven
      // directly against a fake ProfileStatementClient in display-name-write.test.ts, not raced through this HTTP
      // route: apps/api/src/authorization/boundary.ts#execute re-reads profile.profileVersion (recheck_at_commit)
      // inside the same SERIALIZABLE transaction the handler runs in, immediately before setDisplayName's own
      // writeDisplayName call, so a stale expectedVersion is not reachable from two sequential HTTP requests here.
      const afterConflict = afterEighty;

      // No CSRF, or the wrong origin: the route's own CSRF guard (same as every other mutation) denies before any write.
      const noCsrf = await h.inject("PUT", "/v1/identity/me/display-name", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { displayName: "No CSRF" });
      assert.ok([400, 403].includes(noCsrf.statusCode), noCsrf.body);
      assert.equal((await displayColumn(h.client, accountSubjectId)).version, afterConflict.version, "nothing written without CSRF");
    } finally { await h.close(); }
  });
});
