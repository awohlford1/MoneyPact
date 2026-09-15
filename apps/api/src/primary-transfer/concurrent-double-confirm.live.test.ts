/**
 * PK9-02 / PK7B-F03: the concurrent double-confirm the PK7B transfer packet named as carried to PK-9
 * (PROTO-INVITATIONS-PK7B-TRANSFER-API-001-RESULT.r3, finding PK7B-F03) -- "prove the concurrent double-confirm
 * with two sessions of the same Primary Owner (the second is 429 in_flight or the uniform 403 depending on whether
 * the first has reached its session write; record which)."
 *
 * This is an observation case, not a fix: whichever answer the loser gets, no rule is broken (CBD-266 SEC-G429-F2,
 * PROTO-CBD266-429-SEC-001-RESULT.r1, records both are legitimate depending on whether the winner's serializable
 * effect transaction has already extended the session's idle expiry and fenced the revocation epoch by the time the
 * loser's request reaches the gate). The case fires two concurrent `confirm` requests for the *same* live transfer
 * from two independent sessions belonging to the same Primary Owner (`subject-a` signed in twice, matching a
 * two-tab or two-device scenario), each holding its own fresh-assurance grant from its own step-up, and records the
 * loser's exact status and body.
 *
 * Same harness pattern as ./transfer.live.test.ts (opt-in on COBUDGET_DB_NAME, never cobudget_dev/cobudget_demo).
 * Identity-ceremony budget: this file spends five `begin`s (subject-a session A, subject-b, subject-a session B,
 * step-up A, step-up B) against the six-per-process bootstrap sub-pool on rlp-266-bootstrap-v1, one process, one
 * harness, asserted below so a later addition that crosses the budget fails here by name.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_pk9transfer npx tsx --test src/primary-transfer/concurrent-double-confirm.live.test.ts
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import type { DataAccessClient } from "@cobudget/data-access";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";
import { loadConsentDisclosureRegistry } from "../budget-creation/consent-registry.ts";
import { TRANSFER_ACTIONS } from "./http.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";
const ENVIRONMENT = "development";
const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";
const REGISTRY = loadConsentDisclosureRegistry();
const claimOf = (kind: string) => { const entry = REGISTRY.current(kind); return { kind: entry.kind, version: entry.version, digest: entry.digest }; };
const ACCEPT_BODY = { acknowledgedDisclosure: claimOf("primary_transfer_recipient") };
const CONFIRM_BODY = { acknowledgedDisclosure: claimOf("primary_transfer_outgoing") };
const BEGIN_BUDGET = 6;

type Response = { statusCode: number; body: string; headers: Record<string, unknown>; json: () => any };
interface Jar { cookies: Record<string, string> }
interface Harness {
  readonly client: DataAccessClient;
  readonly app: Awaited<ReturnType<typeof createComposedApiApplication>>["app"];
  readonly port: number;
  /** Named cookie jars sharing one app instance, so two "sessions" of the same account can be held open together. */
  readonly inject: (jar: Jar, method: "GET" | "POST", url: string, headers?: Record<string, string>, payload?: Record<string, unknown>) => Promise<Response>;
  readonly close: () => Promise<void>;
}
let beginCount = 0;

async function harness(): Promise<Harness> {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  const locatorPool = createApiConnection();
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  const config = localConfig({ NODE_ENV: "development", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 13).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "pk9-live-v1", COBUDGET_IDENTITY_ENVIRONMENT_ID: ENVIRONMENT, COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
  const { app } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, locator: locatorPool, scheduler: null });
  await app.init();
  await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
  const inject: Harness["inject"] = async (jar, method, url, headers = {}, payload) => {
    const response = await app.inject({ method, url, remoteAddress: "127.0.0.1", headers: { host: "localhost:3000", ...(Object.keys(jar.cookies).length ? { cookie: Object.entries(jar.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const raw = response.headers["set-cookie"];
    for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); jar.cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return response as unknown as Response;
  };
  return { client, app, port, inject, close: async () => { await app.close(); await pool.end(); await locatorPool.end(); } };
}

async function walkChooser(h: Harness, jar: Jar, navigateTo: string, scenario: "subject-a" | "subject-b"): Promise<Response> {
  const authorize = new URL(navigateTo);
  const chooser = await h.inject(jar, "GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${h.port}` });
  const link = new RegExp(`href="([^"]+scenario=${scenario})"`).exec(chooser.body)![1]!.replaceAll("&amp;", "&");
  const choice = await h.inject(jar, "GET", link, { host: `127.0.0.1:${h.port}` });
  const callback = new URL(choice.headers.location as string);
  return h.inject(jar, "GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
}

async function signIn(h: Harness, jar: Jar, scenario: "subject-a" | "subject-b"): Promise<{ accountSubjectId: string; sessionRef: string; csrfValue: string }> {
  delete jar.cookies[SESSION_COOKIE_NAME];
  beginCount += 1;
  const begin = await h.inject(jar, "POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  assert.equal(begin.statusCode, 200, begin.body);
  const done = await walkChooser(h, jar, begin.json().navigateTo, scenario);
  assert.equal(done.statusCode, 303, done.body);
  assert.ok(jar.cookies[SESSION_COOKIE_NAME], "the sign-in delivered a session cookie");
  const me = await h.inject(jar, "GET", "/v1/identity/me");
  assert.equal(me.statusCode, 200, me.body);
  return { accountSubjectId: me.json().accountSubjectId, sessionRef: me.json().sessionRef, csrfValue: me.json().csrfValue };
}

async function stepUp(h: Harness, jar: Jar, csrfValue: string, scenario: "subject-a" | "subject-b", action: string, budgetSpaceId: string): Promise<number> {
  beginCount += 1;
  const begin = await h.inject(jar, "POST", "/v1/identity/step-up/begin", mutation(csrfValue), { action, budgetSpaceId, postResultDestinationId: "home" });
  if (begin.statusCode !== 200) return begin.statusCode;
  const delivered = await walkChooser(h, jar, begin.json().navigateTo, scenario);
  assert.equal(delivered.statusCode, 303, delivered.body);
  return delivered.statusCode;
}

async function withAdmin<T>(work: (query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  const { createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const seed = await admin.connect();
  try {
    await seed.query("BEGIN");
    try { const result = await work((sql, params) => seed.query(sql, params ?? [])); await seed.query("COMMIT"); return result; }
    catch (error) { await seed.query("ROLLBACK"); throw error; }
  } finally { seed.release(); await admin.end(); }
}

async function seedSpace(subject: string): Promise<{ spaceId: string; membershipId: string }> {
  const spaceId = randomUUID(); const membershipId = randomUUID(); const scheduleId = randomUUID(); const periodId = randomUUID();
  await withAdmin(async (query) => {
    const profiles = await query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    const profileId = String(profiles.rows[0]!.profile_id);
    await query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,'America/New_York','2026a','USD','cbd-231/0.1',$3,$4,$4,$5,$6)",
      [spaceId, `PK-9 concurrent ${spaceId.slice(0, 8)}`, membershipId, scheduleId, periodId, subject]);
    await query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membershipId, spaceId, profileId, subject]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p5',$6,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [scheduleId, spaceId, JSON.stringify({ cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } })]);
    await query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,'active','2099-01-01','2099-01-31')", [periodId, spaceId, scheduleId]);
  });
  return { spaceId, membershipId };
}

async function seedCoOwner(spaceId: string, primarySubject: string, subject: string): Promise<{ membershipId: string }> {
  const membershipId = randomUUID();
  await withAdmin(async (query) => {
    const profiles = await query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    await query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'co_owner','active',$5)", [membershipId, spaceId, String(profiles.rows[0]!.profile_id), subject, primarySubject]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'co_owner','full','invitation_acceptance',$5,1,'invitation_co_owner',1,$6,'p5',$7,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, randomUUID(), DISCLOSURE_DIGEST, POLICY_DIGEST]);
  });
  return { membershipId };
}

const mutation = (csrf: string) => ({ origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrf, "content-type": "application/json" });

describe("PK9-R PK7B-F03 live: concurrent confirm from two sessions of the same Primary Owner", { skip: !configured }, () => {
  it("both sessions hold their own fresh-assurance grant and confirm the same live transfer concurrently; one wins with a committed transfer and the loser is recorded", async () => {
    const h = await harness();
    try {
      const jarA1: Jar = { cookies: {} }; const jarA2: Jar = { cookies: {} }; const jarB: Jar = { cookies: {} };
      const primarySessionA = await signIn(h, jarA1, "subject-a");
      const space = await seedSpace(primarySessionA.accountSubjectId);
      const recipientIdentity = await signIn(h, jarB, "subject-b");
      const recipient = await seedCoOwner(space.spaceId, primarySessionA.accountSubjectId, recipientIdentity.accountSubjectId);
      const base = `/v1/budget-spaces/${space.spaceId}/primary-transfers`;

      // A second, independent session for the *same* Primary Owner account -- a second tab or device.
      const primarySessionB = await signIn(h, jarA2, "subject-a");
      assert.equal(primarySessionB.accountSubjectId, primarySessionA.accountSubjectId, "same account, two sessions");
      assert.notEqual(primarySessionB.sessionRef, primarySessionA.sessionRef, "distinct session rows");

      const proposed = await h.inject(jarA1, "POST", base, mutation(primarySessionA.csrfValue), { recipientMembershipId: recipient.membershipId });
      assert.equal(proposed.statusCode, 201, proposed.body);
      const transferId = proposed.json().transfer.transferId;
      const accepted = await h.inject(jarB, "POST", `${base}/${transferId}/accept`, mutation(recipientIdentity.csrfValue), ACCEPT_BODY);
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().outcome, "recipient_accepted");

      // Each session runs its own step-up and holds its own grant bound to the same action and space.
      assert.equal(await stepUp(h, jarA1, primarySessionA.csrfValue, "subject-a", TRANSFER_ACTIONS.confirm, space.spaceId), 303);
      assert.equal(await stepUp(h, jarA2, primarySessionB.csrfValue, "subject-a", TRANSFER_ACTIONS.confirm, space.spaceId), 303);

      assert.ok(beginCount <= BEGIN_BUDGET, `identity-ceremony budget: ${beginCount} begins in one composed process`);

      // Fire both confirms concurrently. PK7B-F03: the loser is 429 in_flight (the per-actor bucket, the ordinary
      // case) or the uniform 403 (the same-actor's other-session request refused at the session gate if the
      // winner's effect transaction has already reached its session write) -- record whichever this run produces.
      const [resultA1, resultA2] = await Promise.all([
        h.inject(jarA1, "POST", `${base}/${transferId}/confirm`, mutation(primarySessionA.csrfValue), CONFIRM_BODY),
        h.inject(jarA2, "POST", `${base}/${transferId}/confirm`, mutation(primarySessionB.csrfValue), CONFIRM_BODY),
      ]);

      const outcomes = [
        { session: "A1", status: resultA1.statusCode, body: resultA1.body },
        { session: "A2", status: resultA2.statusCode, body: resultA2.body },
      ];
      console.log(`PK7B-F03 OBSERVED: concurrent double-confirm outcomes: ${JSON.stringify(outcomes)}`);

      const winners = outcomes.filter((o) => o.status === 200);
      const losers = outcomes.filter((o) => o.status !== 200);
      assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify(outcomes)}`);
      assert.equal(losers.length, 1, `exactly one loser: ${JSON.stringify(outcomes)}`);
      const loser = losers[0]!;
      const loserIsRateLimited = loser.status === 429 && /in_flight/u.test(loser.body);
      const loserIsUniformDenial = loser.status === 403 && (() => { try { return JSON.parse(loser.body).reason === "denied"; } catch { return false; } })();
      assert.ok(loserIsRateLimited || loserIsUniformDenial, `loser must be 429 in_flight or the uniform 403: ${JSON.stringify(loser)}`);
      console.log(`PK7B-F03 OBSERVED: the loser received ${loserIsRateLimited ? "429 in_flight (the per-actor rate-limit bucket)" : "the uniform 403 (refused at the session gate)"}`);

      // Exactly one commit reached the row: no double-spend, whichever request lost. The recipient already accepted
      // above (TR-73-43), so the winning confirm both records the Primary's leg and completes the pair in the same
      // transaction: the row lands directly on "committed", not the intermediate "primary_confirmed".
      const row = (await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "state_version"], conditions: [{ column: "transfer_id", value: transferId }] })).rows[0] as { state: string; state_version: number };
      assert.equal(row.state, "committed");
      assert.equal(row.state_version, 4, "one winning confirm, not two");
    } finally {
      await h.close();
    }
  });
});
