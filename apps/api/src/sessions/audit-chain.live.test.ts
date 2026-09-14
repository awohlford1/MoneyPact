/**
 * PROTO-ACTIVATION-001 A4 live PostgreSQL proof: across a multi-route journey with committed
 * mutations, a rolled-back mutation and interleaved concurrent mutations, the in-process restricted
 * audit chain publishes exactly one allow event per committed effect, none for the rollback, and
 * every event's digest closes over its prepared content at its real chain position.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_activation npx tsx --test src/sessions/audit-chain.live.test.ts
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { sha256 } from "@cobudget/contracts/authorization";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";

const configured = loadLocalDatabaseConfig().database !== "cobudget_dev";
const DRAFT = { name: "Chain", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };

describe("PROTO-ACTIVATION-001 A4: audit chain across commits, a rollback and interleaving (live PostgreSQL)", { skip: !configured }, () => {
  it("publishes one allow per committed effect, nothing for the rollback, with a valid digest chain", async () => {
    const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
    const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
    const pool = createApiConnection();
    const client = bindClient(pool, true);
    const port = 20_000 + Math.floor(Math.random() * 40_000);
    const config = localConfig({ NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development", COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
    const { app, runtime } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, scheduler: null });
    await app.init();
    await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
    /** One browser per subject: the approved mutation record admits one in-flight mutation per actor, so interleaving needs two actors. */
    const browser = async (scenario: "subject-a" | "subject-b") => {
      const cookies: Record<string, string> = {};
      const inject = async (method: "GET" | "POST" | "PUT", url: string, headers: Record<string, string> = {}, payload?: Record<string, unknown>) => {
        const response = await app.inject({ method, url, headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
        const raw = response.headers["set-cookie"];
        for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
        return response;
      };
      const begin = await inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
      const authorize = new URL(begin.json().navigateTo);
      const chooser = await inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${port}` });
      const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&").replace("subject-a", scenario);
      const choice = await inject("GET", link, { host: `127.0.0.1:${port}` });
      const callback = new URL(choice.headers.location as string);
      assert.equal((await inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" })).statusCode, 303);
      const me = await inject("GET", "/v1/identity/me");
      assert.equal(me.statusCode, 200, me.body);
      const mutation = { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.json().csrfValue as string, "content-type": "application/json" };
      return { inject, mutation };
    };
    try {
      const a = await browser("subject-a");
      const b = await browser("subject-b");
      const { inject, mutation } = a;
      const allowsBefore = runtime.audit!.snapshot().filter((event) => event.outcome === "allow").length;

      // Two interleaved proposal creations by two actors (separate serializable transactions in flight together).
      const [one, two] = await Promise.all([
        a.inject("POST", "/v1/budget-creation-proposals", { ...a.mutation, "idempotency-key": randomUUID() }, DRAFT),
        b.inject("POST", "/v1/budget-creation-proposals", { ...b.mutation, "idempotency-key": randomUUID() }, { ...DRAFT, name: "Chain two" }),
      ]);
      assert.equal(one.statusCode, 201, one.body); assert.equal(two.statusCode, 201, two.body);
      // A committed confirmation (space.create through the creation store), then a rolled-back mutation.
      const confirmed = await inject("POST", `/v1/budget-creation-proposals/${one.json().proposalId}/confirm`, { ...mutation, "idempotency-key": randomUUID() }, { confirmationBinding: one.json().confirmationBinding });
      assert.equal(confirmed.statusCode, 201, confirmed.body);
      const budgetSpaceId = confirmed.json().budgetSpaceId as string;
      const rolledBack = await inject("PUT", `/v1/budget-spaces/${budgetSpaceId}/categories`, mutation, { categories: [{ label: "" }] });
      assert.equal(rolledBack.statusCode, 400, rolledBack.body);
      const committed = await inject("PUT", `/v1/budget-spaces/${budgetSpaceId}/categories`, mutation, { categories: [{ label: "Groceries" }] });
      assert.equal(committed.statusCode, 200, committed.body);

      const events = runtime.audit!.snapshot();
      const allows = events.filter((event) => event.outcome === "allow").slice(allowsBefore);
      assert.deepEqual(allows.map((event) => event.actionCode).sort(), ["4.edit_category", "proposal.create", "proposal.create", "space.create"], "one allow per committed effect; the rolled-back categories write published nothing");
      assert.deepEqual(allows.slice(2).map((event) => event.actionCode), ["space.create", "4.edit_category"], "the sequential effects publish in commit order");
      assert.equal(runtime.audit!.reserved, 0, "no reservation survives a rollback");
      let previous = "0".repeat(64);
      for (const [index, event] of events.entries()) {
        const { eventDigest, ...body } = event;
        assert.equal(event.sequence, index + 1);
        assert.equal(event.previousEventDigest, previous);
        assert.equal(eventDigest, sha256(body), `event ${index + 1} digest closes over its content at its chain position`);
        previous = eventDigest!;
      }
    } finally { await app.close(); await pool.end(); }
  });
});
