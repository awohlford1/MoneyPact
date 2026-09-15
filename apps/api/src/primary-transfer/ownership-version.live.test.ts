/**
 * POV-N09 live PostgreSQL proof (PROTO-CONTRACTS-POV-IMPL-001; EXEC-POV-C200F01-001;
 * docs/cbd-236-primary-ownership-version-amendment-proposal.md section 5;
 * CBD-236 v0.13 sections 6.1 and 9.7).
 *
 * A bystander Collaborator's non-read decision, prechecked before a committed
 * Primary transfer and rechecked at commit after it, denies `stale_version`
 * because the captured set -- not only the section 6 step-3 input digest --
 * observed `budget_space.primary_ownership_version` move for a member whose
 * own `authorization_version` did not. The precheck's captured record names
 * the pre-transfer column value; the allow events the restricted audit stream
 * writes before and after the transfer carry the column value of their moment;
 * the denial is inert (no `capturedVersions`, no `cellRef`, `audit` only).
 *
 * Opt-in exactly like `transfer.live.test.ts`: `COBUDGET_DB_NAME` must name a
 * migrated scratch database other than `cobudget_dev` or `cobudget_demo`,
 * created fresh. Nothing here starts Docker, resets, or cleans up; every
 * identifier is fresh.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_pov npx tsx --test src/primary-transfer/ownership-version.live.test.ts
 *
 * What is real here: two composed API applications over one database, each
 * with the production `sessions/runtime.ts` wiring (the real
 * `ApiAuthorizationBoundary`, the real fact assembler and `spaceFacts`, the
 * real CBD-191 sessions, the real local identity chooser and step-up). The
 * transfer commits through the first application's HTTP routes exactly as
 * `transfer.live.test.ts` drives them. The bystander signs in through the
 * second application, whose local issuer is a different origin, so the same
 * chooser scenario maps to a third account subject (CBD-190 bindings are keyed
 * on the issuer); the bystander's decision runs through that application's
 * composed boundary, which is the honest way to hold a precheck open across
 * another party's committed transfer (`fresh-assurance.live.test.ts` precedent).
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import type { DataAccessClient } from "@cobudget/data-access";
import { sha256 } from "@cobudget/contracts/authorization";
import type { PolicyAuditEvent } from "@cobudget/contracts/authorization";
import { createComposedApiApplication } from "../application.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { AuthorizationBoundary } from "../authorization/boundary.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import type { FactLookup } from "../authorization/facts.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";
import { TRANSFER_ACTIONS } from "./http.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";
const ENVIRONMENT = "development";
/** The bystander's non-read cell: p5 maps a Collaborator column on `4.edit_category` (CBD-236 section 8.8.1 group 4). */
const BYSTANDER_ACTION = "4.edit_category";
/** Fixture-only digests: opaque to every assertion here, and the consent trigger requires non-empty values. */
const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";

type Response = { statusCode: number; body: string; headers: Record<string, unknown>; json: () => any };
interface Harness {
  readonly client: DataAccessClient;
  readonly boundary: AuthorizationBoundary;
  readonly events: () => readonly Readonly<Partial<PolicyAuditEvent>>[];
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
  const config = localConfig({ NODE_ENV: "development", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 11).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "pk5-live-v1", COBUDGET_IDENTITY_ENVIRONMENT_ID: ENVIRONMENT, COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
  const { app, runtime } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, locator: locatorPool, scheduler: null });
  await app.init();
  await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();
  const cookies: Record<string, string> = {};
  const inject: Harness["inject"] = async (method, url, headers = {}, payload) => {
    const response = await app.inject({ method, url, remoteAddress: "127.0.0.1", headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const raw = response.headers["set-cookie"];
    for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return response as unknown as Response;
  };
  return {
    client, boundary: runtime.authorization.boundary, events: () => runtime.audit?.snapshot() ?? [], port, cookies, inject,
    close: async () => { await app.close(); await pool.end(); await locatorPool.end(); },
  };
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

/** Signs in over HTTP exactly as a browser does, replacing the session cookie in the jar, and returns the identity bootstrap. */
async function signIn(h: Harness, scenario: "subject-a" | "subject-b"): Promise<{ accountSubjectId: string; sessionRef: string; csrfValue: string }> {
  delete h.cookies[SESSION_COOKIE_NAME];
  const begin = await h.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  assert.equal(begin.statusCode, 200, begin.body);
  const done = await walkChooser(h, begin.json().navigateTo, scenario);
  assert.equal(done.statusCode, 303, done.body);
  assert.ok(h.cookies[SESSION_COOKIE_NAME], "the sign-in delivered a session cookie");
  const me = await h.inject("GET", "/v1/identity/me");
  assert.equal(me.statusCode, 200, me.body);
  return { accountSubjectId: me.json().accountSubjectId, sessionRef: me.json().sessionRef, csrfValue: me.json().csrfValue };
}

/** The whole PK-4 step-up over HTTP, as a browser walks it, for the signed-in subject. Returns the callback's status. */
async function stepUp(h: Harness, csrfValue: string, scenario: "subject-a" | "subject-b", action: string, budgetSpaceId: string): Promise<number> {
  const begin = await h.inject("POST", "/v1/identity/step-up/begin", mutation(csrfValue), { action, budgetSpaceId, postResultDestinationId: "home" });
  if (begin.statusCode !== 200) return begin.statusCode;
  const delivered = await walkChooser(h, begin.json().navigateTo, scenario);
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

/** A live budget space whose Primary Owner is `subject`, with the consent row the landing requires. */
async function seedSpace(subject: string): Promise<{ spaceId: string; membershipId: string }> {
  const spaceId = randomUUID(); const membershipId = randomUUID(); const scheduleId = randomUUID(); const periodId = randomUUID();
  await withAdmin(async (query) => {
    const profiles = await query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    const profileId = String(profiles.rows[0]!.profile_id);
    await query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,'America/New_York','2026a','USD','cbd-231/0.1',$3,$4,$4,$5,$6)",
      [spaceId, `POV ${spaceId.slice(0, 8)}`, membershipId, scheduleId, periodId, subject]);
    await query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membershipId, spaceId, profileId, subject]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p5',$6,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [scheduleId, spaceId, JSON.stringify({ cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } })]);
    await query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,'active','2099-01-01','2099-01-31')", [periodId, spaceId, scheduleId]);
  });
  return { spaceId, membershipId };
}

/** A further active member with a `current` consent row, as an accepted invitation of that role would have left them. */
async function seedMember(spaceId: string, primarySubject: string, subject: string, role: "co_owner" | "collaborator"): Promise<{ membershipId: string }> {
  const membershipId = randomUUID();
  const kind = role === "co_owner" ? "invitation_co_owner" : "invitation_collaborator";
  await withAdmin(async (query) => {
    const profiles = await query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    await query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,$5,'active',$6)", [membershipId, spaceId, String(profiles.rows[0]!.profile_id), subject, role, primarySubject]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,$5,'full','invitation_acceptance',$6,1,$7,1,$8,'p5',$9,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, role, randomUUID(), kind, DISCLOSURE_DIGEST, POLICY_DIGEST]);
  });
  return { membershipId };
}

const mutation = (csrf: string) => ({ origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrf, "content-type": "application/json" });

/** The bystander's non-read lookup: the whole category set of the acting space, keyed on the bystander's own membership. */
function bystanderLookup(spaceId: string, membershipId: string, credential: string | undefined): FactLookup {
  return { credential, operation: { action: BYSTANDER_ACTION, purpose: "user_delegated", mode: "user_delegated", fieldSet: "default", resourceType: "category", resourceId: spaceId, actingSpaceId: spaceId, actingMembershipId: membershipId } };
}
const captured = (value: unknown): Record<string, unknown> => (value ?? {}) as Record<string, unknown>;

async function ownershipVersion(client: DataAccessClient, spaceId: string): Promise<number> {
  const row = (await client.tenantSelect({ table: "budget_space", budgetSpaceId: spaceId, columns: ["primary_ownership_version"] })).rows[0] as { primary_ownership_version: unknown };
  return Number(row.primary_ownership_version);
}
async function membershipVersion(client: DataAccessClient, spaceId: string, membershipId: string): Promise<number> {
  const row = (await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: spaceId, columns: ["authorization_version"], conditions: [{ column: "membership_id", value: membershipId }] })).rows[0] as { authorization_version: unknown };
  return Number(row.authorization_version);
}

describe("POV-N09 live: a bystander Collaborator's captured set observes a committed Primary transfer on real PostgreSQL", { skip: !configured }, () => {
  it("prechecked before the transfer and rechecked after it, the bystander denies stale_version with the pre-transfer column value captured; the allow events before and after carry the column of their moment", async (t) => {
    const parties = await harness();
    const bystanderApp = await harness();
    try {
      // Three subjects: the Primary and the recipient through the first application; the bystander through the second, whose
      // local issuer is another origin, so the chooser's `subject-a` binds to a third account subject and profile (CBD-190).
      const recipientIdentity = await signIn(parties, "subject-b");
      const primary = await signIn(parties, "subject-a");
      const bystanderIdentity = await signIn(bystanderApp, "subject-a");
      assert.notEqual(bystanderIdentity.accountSubjectId, primary.accountSubjectId, "the bystander is a third subject");
      assert.notEqual(bystanderIdentity.accountSubjectId, recipientIdentity.accountSubjectId);
      const space = await seedSpace(primary.accountSubjectId);
      const recipient = await seedMember(space.spaceId, primary.accountSubjectId, recipientIdentity.accountSubjectId, "co_owner");
      const bystander = await seedMember(space.spaceId, primary.accountSubjectId, bystanderIdentity.accountSubjectId, "collaborator");
      const lookup = () => bystanderLookup(space.spaceId, bystander.membershipId, bystanderApp.cookies[SESSION_COOKIE_NAME]);
      const before = await ownershipVersion(parties.client, space.spaceId);
      assert.equal(before, 1, "the M1 default");
      const base = `/v1/budget-spaces/${space.spaceId}/primary-transfers`;
      let held: Awaited<ReturnType<AuthorizationBoundary["authorize"]>> | undefined;

      await t.test("before the transfer, the bystander's allowed mutation captures the column value and the allow event carries it", async () => {
        const context = await bystanderApp.boundary.authorize(lookup());
        assert.equal(context.decision.outcome, "allow");
        assert.deepEqual(context.decision.cellRef, { kind: "user", permission: "4", role: "collaborator" });
        assert.equal(context.input.space?.primaryOwnershipVersion, before, "the leaf is the column");
        assert.equal(context.input.provenance["space.primaryOwnershipVersion"], "datastore");
        assert.equal(captured(context.decision.capturedVersions).primaryOwnershipVersion, before);
        assert.equal(captured(context.decision.capturedVersions).authorizationVersion, 1, "the bystander's own membership version");
        await bystanderApp.boundary.execute(context, async () => undefined);
        const event = bystanderApp.events().at(-1)!;
        assert.equal(event.outcome, "allow"); assert.equal(event.actionCode, BYSTANDER_ACTION);
        assert.equal(captured(event.capturedVersions).primaryOwnershipVersion, before, "the restricted audit event carries the column");
        // The precheck held open across the transfer: captured now, executed only after the commit below.
        held = await bystanderApp.boundary.authorize(lookup());
        assert.equal(captured(held.decision.capturedVersions).primaryOwnershipVersion, before);
      });

      await t.test("the Primary proposes, the recipient accepts, the Primary steps up and confirms: the column and both parties' versions advance, the bystander's does not", async () => {
        const proposed = await parties.inject("POST", base, mutation(primary.csrfValue), { recipientMembershipId: recipient.membershipId });
        assert.equal(proposed.statusCode, 201, proposed.body);
        const transferId = proposed.json().transfer.transferId as string;
        const recipientSession = await signIn(parties, "subject-b");
        const accepted = await parties.inject("POST", `${base}/${transferId}/accept`, mutation(recipientSession.csrfValue), {});
        assert.equal(accepted.statusCode, 200, accepted.body);
        const owner = await signIn(parties, "subject-a");
        assert.equal(await stepUp(parties, owner.csrfValue, "subject-a", TRANSFER_ACTIONS.confirm, space.spaceId), 303);
        const confirmed = await parties.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        assert.equal(confirmed.json().outcome, "committed");
        assert.equal(await ownershipVersion(parties.client, space.spaceId), before + 1, "TR-73-43 advanced the column");
        // PC-236-015 (SEC-PK6-R1, standing): both parties' authorization_version advanced in the same transaction; the bystander's did not.
        assert.equal(await membershipVersion(parties.client, space.spaceId, space.membershipId), 2);
        assert.equal(await membershipVersion(parties.client, space.spaceId, recipient.membershipId), 2);
        assert.equal(await membershipVersion(parties.client, space.spaceId, bystander.membershipId), 1);
      });

      await t.test("the held precheck denies stale_version at its commit-time recheck; the denial is inert and the precheck's record names the pre-transfer value", async () => {
        assert.ok(held, "the precheck was captured before the transfer");
        const after = await ownershipVersion(parties.client, space.spaceId);
        const eventsBefore = bystanderApp.events().length;
        await assert.rejects(bystanderApp.boundary.execute(held, async () => { throw new Error("the handler must never run"); }), (error: unknown) => error instanceof AuthorizationDenied);
        const event = bystanderApp.events().at(-1)!;
        assert.equal(bystanderApp.events().length, eventsBefore + 1, "one restricted denial record");
        assert.equal(event.outcome, "deny"); assert.equal(event.reasonClass, "stale_version"); assert.equal(event.actionCode, BYSTANDER_ACTION);
        assert.equal(event.capturedVersions, undefined, "inert: no captured set on a denial (PC-236-018)");
        assert.equal(event.cellRef, undefined);
        assert.deepEqual(event.obligations, ["audit"]);
        // The value the precheck captured is the column as it stood before the transfer, and it differs from the column now,
        // while the bystander's own membership version is the same on both sides: the captured set, not only the digest, moved.
        assert.equal(captured(held.decision.capturedVersions).primaryOwnershipVersion, before);
        assert.notEqual(captured(held.decision.capturedVersions).primaryOwnershipVersion, after);
        assert.equal(captured(held.decision.capturedVersions).authorizationVersion, 1);
      });

      await t.test("a fresh precheck after the transfer captures the advanced column with the bystander's unchanged membership version, and its allow event carries it", async () => {
        assert.ok(held);
        const earlier = captured(held.decision.capturedVersions);
        const after = await ownershipVersion(parties.client, space.spaceId);
        const context = await bystanderApp.boundary.authorize(lookup());
        assert.equal(context.decision.outcome, "allow");
        assert.equal(captured(context.decision.capturedVersions).primaryOwnershipVersion, after);
        assert.equal(captured(context.decision.capturedVersions).authorizationVersion, 1);
        assert.notEqual(sha256(context.decision.capturedVersions), sha256(earlier));
        const differing = Object.keys(captured(context.decision.capturedVersions)).filter((key) => captured(context.decision.capturedVersions)[key] !== earlier[key]);
        assert.deepEqual(differing, ["primaryOwnershipVersion"], "the one dimension that moved for the bystander");
        await bystanderApp.boundary.execute(context, async () => undefined);
        const event = bystanderApp.events().at(-1)!;
        assert.equal(event.outcome, "allow");
        assert.equal(captured(event.capturedVersions).primaryOwnershipVersion, after);
      });
    } finally {
      await bystanderApp.close();
      await parties.close();
    }
  });
});
