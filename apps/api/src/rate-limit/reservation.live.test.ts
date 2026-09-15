/**
 * PROTO-ACTIVATION-001 B1 (review R2-02, SEC-ACT-R2-F02) live proof through the real CBD-266 gate
 * (config/rate-limit) and PostgreSQL: the ceremony's reserved initial `space.create` unit is consumed
 * only by an eligible confirmation. A confirm denied at the session gate (missing CSRF value) or by
 * its locator (unknown proposal) spends nothing reserved and the following valid confirm succeeds; the
 * committed confirm consumes exactly one reserved unit (its authenticated replay consumes none, a second
 * creation on the same ceremony is `deny_exhausted` at the surface).
 *
 * Before B1 the reserved unit was consumed in the preHandler, ahead of CSRF, replay and locator
 * validation: the first denied attempt spent it and the valid attempt that followed was `deny_exhausted`.
 *
 * PROTO-QA-FIXES-001 F1 (QA finding PROTO-E2E-QA-001 F1): a confirm that passes every gate but is denied
 * inside its effect (altered binding or expired proposal, 409 proposal_not_current) committed nothing, so
 * the reserved unit it was admitted on is refunded to the ceremony and the corrected confirm on the same
 * session commits; the committed confirm still consumes exactly one unit and a second creation on the
 * same ceremony is `deny_exhausted`. Before F1 the denied attempt kept the unit and the subject had to
 * sign in again.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_activation npx tsx --test src/rate-limit/reservation.live.test.ts
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";

const configured = loadLocalDatabaseConfig().database !== "cobudget_dev";
const DRAFT = { name: "Reserved", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };
type Enforcement = { earliest_decisive_gate: string; safe_reason_class: string; parameter_record_id: string | null; counter_store_evidence: string };

describe("PROTO-ACTIVATION-001 B1: the reserved initial space.create unit is consumed only by an eligible confirmation (live PostgreSQL, real surface gate)", { skip: !configured }, () => {
  it("denied confirms spend nothing reserved; the committed confirm consumes exactly one unit; its replay none", async () => {
    const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
    const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
    const pool = createApiConnection();
    const client = bindClient(pool, true);
    const port = 20_000 + Math.floor(Math.random() * 40_000);
    const config = localConfig({ NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development", COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
    const { app, runtime } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, scheduler: null });
    await app.init();
    await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
    const cookies: Record<string, string> = {};
    const inject = async (method: "GET" | "POST" | "PUT", url: string, headers: Record<string, string> = {}, payload?: Record<string, unknown>) => {
      const response = await app.inject({ method, url, headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
      const raw = response.headers["set-cookie"];
      for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
      return response;
    };
    const lastEnforcement = () => (runtime.audit!.snapshot().at(-1) as { enforcement?: Enforcement } | undefined)?.enforcement;
    try {
      const begin = await inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
      const authorize = new URL(begin.json().navigateTo);
      const chooser = await inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${port}` });
      const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&");
      const choice = await inject("GET", link, { host: `127.0.0.1:${port}` });
      const callback = new URL(choice.headers.location as string);
      assert.equal((await inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" })).statusCode, 303);
      const me = await inject("GET", "/v1/identity/me");
      assert.equal(me.statusCode, 200, me.body);
      const mutation = { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.json().csrfValue as string, "content-type": "application/json" };
      const one = await inject("POST", "/v1/budget-creation-proposals", { ...mutation, "idempotency-key": randomUUID() }, DRAFT);
      const two = await inject("POST", "/v1/budget-creation-proposals", { ...mutation, "idempotency-key": randomUUID() }, { ...DRAFT, name: "Reserved two" });
      assert.equal(one.statusCode, 201, one.body); assert.equal(two.statusCode, 201, two.body);
      const confirmOne = `/v1/budget-creation-proposals/${one.json().proposalId}/confirm`;
      // PROTO-HARDENING-001 (CL-F02 sweep): CBD-233 SS3.3 denies `stale_disclosure`
      // when the confirm does not echo the registry's current disclosure, so the
      // fixture echoes the one the proposal response carries. Fixture repair only.
      const claim = (proposal: { currentDisclosure: { kind: string; version: number } }) => ({ kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version });
      const acknowledgedDisclosure = claim(one.json());
      const bindingOne = { confirmationBinding: one.json().confirmationBinding as string, acknowledgedDisclosure };

      // 1. Missing CSRF value: denied at the session gate, nothing consumed.
      const { "x-cobudget-csrf": _omitted, ...withoutCsrf } = mutation;
      const noCsrf = await inject("POST", confirmOne, { ...withoutCsrf, "idempotency-key": randomUUID() }, bindingOne);
      assert.equal(noCsrf.statusCode, 403, noCsrf.body);
      assert.equal(lastEnforcement()?.earliest_decisive_gate, "session");
      assert.equal(lastEnforcement()?.counter_store_evidence, "not_consumed", "a session-gate denial spends no reserved unit and says so");

      // 2. Unknown proposal (well-formed locator, no such row for this subject): denied by the locator, nothing consumed.
      const unknown = await inject("POST", `/v1/budget-creation-proposals/bcp_${"f".repeat(32)}/confirm`, { ...mutation, "idempotency-key": randomUUID() }, bindingOne);
      assert.equal(unknown.statusCode, 404, unknown.body);
      assert.equal(lastEnforcement()?.safe_reason_class, "deny_input_invalid");
      assert.equal(lastEnforcement()?.counter_store_evidence, "not_consumed");

      // 3. The valid confirm that follows the two denials succeeds: the reserved unit was still intact.
      const key = randomUUID();
      const committed = await inject("POST", confirmOne, { ...mutation, "idempotency-key": key }, bindingOne);
      assert.equal(committed.statusCode, 201, committed.body);

      // 4. Its authenticated replay consumes nothing: it is answered although the reserved unit is now spent.
      const replay = await inject("POST", confirmOne, { ...mutation, "idempotency-key": key }, bindingOne);
      assert.equal(replay.statusCode, committed.statusCode, replay.body);
      assert.deepEqual(replay.json(), committed.json(), "exact replay of the committed confirmation, answered without a surface decision");

      // 5. A second creation on the same ceremony finds the one reserved unit consumed: exactly one per ceremony.
      const second = await inject("POST", `/v1/budget-creation-proposals/${two.json().proposalId}/confirm`, { ...mutation, "idempotency-key": randomUUID() }, { confirmationBinding: two.json().confirmationBinding as string, acknowledgedDisclosure: claim(two.json()) });
      assert.equal(second.statusCode, 403, second.body);
      assert.equal(lastEnforcement()?.earliest_decisive_gate, "surface");
      assert.equal(lastEnforcement()?.safe_reason_class, "deny_exhausted");
      assert.equal(lastEnforcement()?.parameter_record_id, "rlp-266-bootstrap-v1");
      assert.equal(lastEnforcement()?.counter_store_evidence, "exhausted");
    } finally { await app.close(); await pool.end(); }
  });

  it("PROTO-QA-FIXES-001 F1: a confirm denied inside its effect (altered binding, expired proposal) refunds the reserved unit; the corrected confirm commits on the same ceremony; the committed confirm consumes exactly one", async () => {
    const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
    const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
    const { proposalUuid } = await import("../../../../packages/budget-application/src/persistence/proposal-store.ts");
    const pool = createApiConnection();
    const client = bindClient(pool, true);
    const port = 20_000 + Math.floor(Math.random() * 40_000);
    const config = localConfig({ NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development", COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
    const { app, runtime } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, scheduler: null });
    await app.init();
    await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
    let cookies: Record<string, string> = {};
    const inject = async (method: "GET" | "POST", url: string, headers: Record<string, string> = {}, payload?: Record<string, unknown>) => {
      const response = await app.inject({ method, url, headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
      const raw = response.headers["set-cookie"];
      for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
      return response;
    };
    const lastEnforcement = () => (runtime.audit!.snapshot().at(-1) as { enforcement?: Enforcement } | undefined)?.enforcement;
    /** One ceremony: sign in as subject-a and return the mutation headers for this session. */
    const ceremony = async () => {
      cookies = {};
      const begin = await inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
      const authorize = new URL(begin.json().navigateTo);
      const chooser = await inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${port}` });
      const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&");
      const choice = await inject("GET", link, { host: `127.0.0.1:${port}` });
      const callback = new URL(choice.headers.location as string);
      assert.equal((await inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" })).statusCode, 303);
      const me = await inject("GET", "/v1/identity/me");
      assert.equal(me.statusCode, 200, me.body);
      return { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.json().csrfValue as string, "content-type": "application/json" };
    };
    const propose = async (mutation: Record<string, string>, name: string) => {
      const response = await inject("POST", "/v1/budget-creation-proposals", { ...mutation, "idempotency-key": randomUUID() }, { ...DRAFT, name });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as { proposalId: string; confirmationBinding: string; currentDisclosure: { kind: string; version: number } };
    };
    // PROTO-HARDENING-001 (CL-F02 sweep): every confirm echoes the registry's current
    // disclosure, which CBD-233 SS3.3 requires; without it the confirm is `stale_disclosure`.
    const confirm = (mutation: Record<string, string>, proposal: { proposalId: string; confirmationBinding: string; currentDisclosure: { kind: string; version: number } }, binding = proposal.confirmationBinding) =>
      inject("POST", `/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { ...mutation, "idempotency-key": randomUUID() }, { confirmationBinding: binding, acknowledgedDisclosure: { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version } });
    const budgets = async () => Number((await pool.query("select count(*)::int as n from budget_space")).rows[0].n);
    try {
      // Ceremony A: an altered binding is denied inside the effect (409); the corrected confirm then commits.
      const a = await ceremony();
      const one = await propose(a, "Refund altered");
      const spare = await propose(a, "Refund spare");
      const before = await budgets();
      const altered = await confirm(a, one, `${one.confirmationBinding.slice(0, -2)}zz`);
      assert.equal(altered.statusCode, 409, altered.body); assert.deepEqual(altered.json(), { error: "proposal_not_current" });
      assert.equal(await budgets(), before, "the denied effect committed nothing");
      // A second denied attempt is admitted too: the first refund returned the unit, this attempt consumes and refunds again.
      const alteredAgain = await confirm(a, one, `${one.confirmationBinding.slice(0, -2)}zz`);
      assert.equal(alteredAgain.statusCode, 409, alteredAgain.body);
      const corrected = await confirm(a, one);
      assert.equal(corrected.statusCode, 201, `the corrected confirm after two effect denials commits on the same ceremony: ${corrected.body}`);
      assert.equal(await budgets(), before + 1);
      // The committed confirm consumed exactly one reserved unit: a second creation on the same ceremony is exhausted at the surface.
      const second = await confirm(a, spare);
      assert.equal(second.statusCode, 403, second.body);
      assert.equal(lastEnforcement()?.earliest_decisive_gate, "surface");
      assert.equal(lastEnforcement()?.safe_reason_class, "deny_exhausted");
      assert.equal(lastEnforcement()?.parameter_record_id, "rlp-266-bootstrap-v1");
      assert.equal(await budgets(), before + 1, "no second budget on the same ceremony");

      // Ceremony B: an expired proposal is denied inside the effect (409); a regenerated proposal then commits.
      const b = await ceremony();
      const stale = await propose(b, "Refund expired");
      await pool.query("update budget_creation_proposal set proposal_payload = jsonb_set(proposal_payload, '{expiresAt}', to_jsonb((now() - interval '1 second')::timestamptz)) where proposal_id = $1", [proposalUuid(stale.proposalId)]);
      const expired = await confirm(b, stale);
      assert.equal(expired.statusCode, 409, expired.body); assert.deepEqual(expired.json(), { error: "proposal_not_current" });
      const fresh = await propose(b, "Refund regenerated");
      const committed = await confirm(b, fresh);
      assert.equal(committed.statusCode, 201, `the confirm after an expiry denial commits on the same ceremony: ${committed.body}`);
      assert.equal(await budgets(), before + 2);
      const third = await confirm(b, stale);
      assert.equal(third.statusCode, 403, third.body);
      assert.equal(lastEnforcement()?.safe_reason_class, "deny_exhausted", "exactly one creation per ceremony after the refund");
    } finally { await app.close(); await pool.end(); }
  });
});
