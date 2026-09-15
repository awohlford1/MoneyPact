/**
 * SEC-C200-F1 live PostgreSQL proof (PROTO-API-HARDENING-003; CBD-200-AC05;
 * migration 20260915T160000Z; the security result
 * PROTO-CBD200-SEC-001-RESULT SEC-C200-F1).
 *
 * The manual-transaction idempotency replay hook runs before policy
 * (`apps/api/src/transactions/http.ts`, `authorize().replay`), so a
 * membership that stayed active through a role change was still served its
 * own earlier response even though a fresh write under the new role was
 * refused. The row is now bound to `budget_space_membership.
 * authorization_version` at write time, and the replay hook refuses a
 * stored row whose bound version is behind the membership's *current* one
 * with the same uniform denial a fresh denied request receives -- before
 * the stored response is ever read back, so nothing about its content is
 * disclosed.
 *
 * Two probe shapes, proved end to end over the real HTTP routes on real
 * PostgreSQL (no route grants a role change yet, so the demotion and the
 * revocation are seeded directly in the database, as the security result's
 * probes did):
 *
 *   P5-DEMOTED  the Primary Owner is demoted to Viewer (role changed, a
 *               fresh `current` consent row for the new role as
 *               `budget_space_membership_role_change_requires_consent`
 *               requires at COMMIT, `authorization_version` advanced --
 *               exactly the shape a real role-change transaction would
 *               leave). The membership stays active. The stored key's
 *               replay is refused the uniform denial; a fresh write under
 *               the new role is refused too (Viewer holds no row 9 cell).
 *   P5-REVOKED  the membership is revoked outright. `dependencies.
 *               membership()` finds no active row, so `identityOf` never
 *               builds an identity and the idempotency lookup never runs --
 *               refused before the lookup, exactly as before this change.
 *
 * Opt-in exactly like the sibling live suites: `COBUDGET_DB_NAME` must name
 * a migrated scratch database other than `cobudget_dev` or `cobudget_demo`,
 * created fresh. Nothing here starts Docker, resets, or cleans up.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_ah3 npx tsx --test src/transactions/idempotency-authorization-version.live.test.ts
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

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";
const ENVIRONMENT = "development";
/** Fixture-only digests: opaque to every assertion here; the consent trigger requires non-empty values. */
const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";

type Response = { statusCode: number; body: string; headers: Record<string, unknown>; json: () => any };
interface Harness {
  readonly client: DataAccessClient;
  readonly port: number;
  readonly cookies: Record<string, string>;
  readonly inject: (method: "GET" | "POST", url: string, headers?: Record<string, string>, payload?: Record<string, unknown>) => Promise<Response>;
  readonly close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  const locatorPool = createApiConnection();
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  const config = localConfig({ NODE_ENV: "development", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 13).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "ah3-live-v1", COBUDGET_IDENTITY_ENVIRONMENT_ID: ENVIRONMENT, COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
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

/** Signs in over HTTP exactly as a browser does, replacing the session cookie in the jar. */
async function signIn(h: Harness, scenario: "subject-a" | "subject-b"): Promise<{ accountSubjectId: string; csrfValue: string }> {
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

/** A live budget space whose Primary Owner is `subject`, with a live category, account and open period so a manual transaction can be created. */
async function seedSpace(subject: string): Promise<{ spaceId: string; membershipId: string; categoryId: string; accountId: string }> {
  const spaceId = randomUUID(); const membershipId = randomUUID(); const scheduleId = randomUUID(); const periodId = randomUUID();
  const categoryId = randomUUID(); const accountId = randomUUID();
  await withAdmin(async (query) => {
    const profiles = await query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    const profileId = String(profiles.rows[0]!.profile_id);
    await query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,'America/New_York','2026a','USD','cbd-231/0.1',$3,$4,$4,$5,$6)",
      [spaceId, `AH3 ${spaceId.slice(0, 8)}`, membershipId, scheduleId, periodId, subject]);
    await query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membershipId, spaceId, profileId, subject]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p5',$6,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [scheduleId, spaceId, JSON.stringify({ cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } })]);
    await query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,'active','2026-09-01','2026-09-30')", [periodId, spaceId, scheduleId]);
    await query("INSERT INTO budget_category (category_id, budget_space_id, label, position) VALUES ($1,$2,'Groceries',0)", [categoryId, spaceId]);
    await query(
      "INSERT INTO financial_account (account_id, budget_space_id, origin, account_type, label, currency_code, minor_unit_precision, opening_balance_minor_units, owner_subject_id, created_by_subject_id, version, created_at, updated_at)"
      + " VALUES ($1,$2,'manual','checking','Everyday','USD',2,0,$3,$3,1,now(),now())",
      [accountId, spaceId, subject],
    );
  });
  return { spaceId, membershipId, categoryId, accountId };
}

/** Demotes an active membership's role in place, with the current-consent-for-the-new-role row COMMIT requires
 * (`budget_space_membership_role_change_requires_consent`) and an advanced `authorization_version`, exactly the
 * shape a real role-change transaction (not yet routed) would leave. */
async function demote(subject: string, spaceId: string, membershipId: string, role: "viewer"): Promise<void> {
  await withAdmin(async (query) => {
    await query("UPDATE budget_space_consent SET state = 'superseded', ended_at = now() WHERE membership_id = $1 AND state = 'current'", [membershipId]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,$5,'full','membership_change',$3,1,'membership_change',1,$6,'p5',$7,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, role, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await query("UPDATE budget_space_membership SET role = $2, authorization_version = authorization_version + 1 WHERE membership_id = $1", [membershipId, role]);
  });
}

async function revoke(membershipId: string): Promise<void> {
  await withAdmin(async (query) => { await query("UPDATE budget_space_membership SET status = 'revoked', authorization_version = authorization_version + 1, ended_at = now() WHERE membership_id = $1", [membershipId]); });
}

const mutation = (csrf: string, key?: string) => ({ origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrf, "content-type": "application/json", ...(key === undefined ? {} : { "idempotency-key": key }) });

describe("SEC-C200-F1 live: a manual-transaction idempotency replay is bound to the acting membership's authorization_version", { skip: !configured }, () => {
  it("P5-DEMOTED: a replay by a demoted-but-active membership is refused the uniform denial; P5-REVOKED stays refused before the lookup", async () => {
    const h = await harness();
    try {
      const primary = await signIn(h, "subject-a");
      const space = await seedSpace(primary.accountSubjectId);
      const base = `/v1/budget-spaces/${space.spaceId}/transactions`;
      const key = "sec-c200-f1-" + randomUUID();
      const body = { accountId: space.accountId, amountMinorUnits: -1_250, budgetDate: "2026-09-15", description: "Corner shop", allocations: [{ categoryId: space.categoryId, amountMinorUnits: -1_250 }] };

      const created = await h.inject("POST", base, mutation(primary.csrfValue, key), body);
      assert.equal(created.statusCode, 201, created.body);

      // The row is bound to the membership's authorization_version at write time (still 1, the M1 default).
      const written = (await h.client.tenantSelect({ table: "manual_transaction_idempotency", budgetSpaceId: space.spaceId, columns: ["authorization_version"], conditions: [{ column: "idempotency_key", value: key }] })).rows[0] as { authorization_version: unknown };
      assert.equal(Number(written.authorization_version), 1);

      // Sanity: before any role change, the same key still answers the stored response.
      const replaySame = await h.inject("POST", base, mutation(primary.csrfValue, key), body);
      assert.equal(replaySame.statusCode, 201, replaySame.body);
      assert.deepEqual(replaySame.json(), created.json());

      // P5-DEMOTED: the membership stays active but its role -- and authorization_version -- moves.
      await demote(primary.accountSubjectId, space.spaceId, space.membershipId, "viewer");

      const replayDemoted = await h.inject("POST", base, mutation(primary.csrfValue, key), body);
      assert.equal(replayDemoted.statusCode, 403, replayDemoted.body);
      assert.deepEqual(replayDemoted.json(), { outcome: "deny", reason: "denied" }, "the uniform denial: nothing about the stored response is disclosed");
      // A fresh write under the new role is refused too (CBD-72 row 9: Viewer holds no add_manual_transaction cell) --
      // the same shape of refusal the security result found for the history read.
      const freshDenied = await h.inject("POST", base, mutation(primary.csrfValue), { ...body, description: "a fresh write under the demoted role" });
      assert.equal(freshDenied.statusCode, 403, freshDenied.body);
      // The stored row itself is untouched (append-only): still bound to authorization_version 1.
      const stillWritten = (await h.client.tenantSelect({ table: "manual_transaction_idempotency", budgetSpaceId: space.spaceId, columns: ["authorization_version"], conditions: [{ column: "idempotency_key", value: key }] })).rows[0] as { authorization_version: unknown };
      assert.equal(Number(stillWritten.authorization_version), 1);
      assert.equal((await h.client.tenantSelect({ table: "manual_transaction", budgetSpaceId: space.spaceId })).rowCount, 1, "the demoted replay wrote no second version");

      // P5-REVOKED: revoking the membership refuses the replay before the idempotency lookup ever runs
      // (`dependencies.membership()` finds no active row, so `identityOf` never builds an identity).
      await revoke(space.membershipId);
      const replayRevoked = await h.inject("POST", base, mutation(primary.csrfValue, key), body);
      assert.equal(replayRevoked.statusCode, 403, replayRevoked.body);
      assert.deepEqual(replayRevoked.json(), { outcome: "deny", reason: "denied" });
    } finally { await h.close(); }
  });
});
