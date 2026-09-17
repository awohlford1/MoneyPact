/**
 * PK6-01 process-level proof of the whole invitation ceremony over HTTP on a
 * live PostgreSQL 17 (PROTO-INVITATIONS-PK6-API-001; CBD-234 design section
 * 15 PK-6 row).
 *
 * Opt-in exactly like `../sessions/fresh-assurance.live.test.ts`:
 * `COBUDGET_DB_NAME` must name a migrated scratch database other than
 * `cobudget_dev` or `cobudget_demo`. Nothing here starts Docker, resets, or
 * cleans up; every identifier is fresh. The scratch database must not have
 * hosted another package's live suite: the PK-5 and PK-7A suites write
 * outbox rows under their own field-encryption key versions, and the local
 * delivery surface fails closed on a live row it cannot open (PK6-F05), so a
 * database shared with them blanks the surface this test reads.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_pk6api npx tsx --test src/invitations/ceremony.live.test.ts
 *
 * What is real here: the whole composed API (`createComposedApiApplication`
 * with the production `sessions/runtime.ts` wiring, the real
 * `ApiAuthorizationBoundary`, the real fact assembler with the ceremony fact
 * reader, the real rate limits with the pre-counter ceremony gate, the real
 * CBD-191 sessions and CSRF, the real CBD-190 local identity chooser), the
 * real PK-5 module over the real PK-2 schema through the real CBD-246 seam,
 * the real field-encryption provider and the real simulated delivery outbox.
 * The owner signs in through the local chooser as `subject-a`, creates the
 * invitation, and reads the simulated delivery; the link holder resolves it,
 * proves the channel with the delivered six-digit code, signs in through the
 * same chooser as `subject-b`, attaches, reads the disclosure and accepts; the
 * owner confirms; the membership and the consent rows are then present and
 * both members see each other on the members list. Every uniform outcome is
 * compared byte for byte, and the pre-counter gate is shown to deny an
 * unresolvable ceremony before any counter is touched.
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
import { INVITATION_CEREMONY_COOKIE_NAME } from "./cookie.ts";
import { UNIFORM_INVITATION_BODY, UNIFORM_INVITATION_STATUS } from "./http.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";
const ENVIRONMENT = "development";
/** Fixture-only digests: opaque to every assertion here, and the consent trigger requires non-empty values. */
const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";

type Response = { statusCode: number; body: string; headers: Record<string, unknown>; json: () => any };
interface Harness {
  readonly client: DataAccessClient;
  readonly app: Awaited<ReturnType<typeof createComposedApiApplication>>["app"];
  readonly port: number;
  readonly cookies: Record<string, string>;
  readonly inject: (method: "GET" | "POST" | "DELETE", url: string, headers?: Record<string, string>, payload?: Record<string, unknown>) => Promise<Response>;
  readonly close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  // SEC-PK6-F5: the three pre-authentication locator statements read from their own connection, as the
  // production composition does (runtime.ts lazyLocatorQueryable); sharing the transaction pool starves it
  // under concurrent ceremony transactions, since each open transaction holds a client and the locator
  // borrows a second one from the same pool.
  const locatorPool = createApiConnection();
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  // A stable field-encryption key and version, the same material the PK-5 live suite writes with: the harness
  // default is random per process, and every live outbox row on the scratch database -- an earlier run of this
  // test, or the PK-5 suite's -- must stay readable, because the delivery surface fails closed on a row it cannot
  // open (a real process holds one configured key; SEC-PK5-R09 covers rotation).
  const config = localConfig({ NODE_ENV: "development", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 11).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "pk5-live-v1", COBUDGET_IDENTITY_ENVIRONMENT_ID: ENVIRONMENT, COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
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
  return { client, app, port, cookies, inject, close: async () => { await app.close(); await pool.end(); await locatorPool.end(); } };
}

/** Signs in over HTTP exactly as a browser does, replacing the session cookie in the jar, and returns the identity bootstrap. */
async function signIn(h: Harness, scenario: "subject-a" | "subject-b"): Promise<{ accountSubjectId: string; csrfValue: string }> {
  delete h.cookies[SESSION_COOKIE_NAME];
  const begin = await h.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  assert.equal(begin.statusCode, 200, begin.body);
  const authorize = new URL(begin.json().navigateTo);
  const chooser = await h.inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${h.port}` });
  const link = new RegExp(`href="([^"]+scenario=${scenario})"`).exec(chooser.body)![1]!.replaceAll("&amp;", "&");
  const choice = await h.inject("GET", link, { host: `127.0.0.1:${h.port}` });
  const callback = new URL(choice.headers.location as string);
  const done = await h.inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
  assert.equal(done.statusCode, 303, done.body);
  assert.ok(h.cookies[SESSION_COOKIE_NAME], "the sign-in delivered a session cookie");
  const me = await h.inject("GET", "/v1/identity/me");
  assert.equal(me.statusCode, 200, me.body);
  return { accountSubjectId: me.json().accountSubjectId, csrfValue: me.json().csrfValue };
}

/** A live budget space whose Primary Owner is `subject`, with the consent row the landing requires. */
async function seedSpace(subject: string): Promise<{ spaceId: string; membershipId: string }> {
  const { createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const seed = await admin.connect();
  const spaceId = randomUUID(); const membershipId = randomUUID(); const scheduleId = randomUUID(); const periodId = randomUUID();
  try {
    const profiles = await seed.query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    const profileId = String(profiles.rows[0]!.profile_id);
    await seed.query("BEGIN");
    await seed.query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,'America/New_York','2026a','USD','cbd-231/0.1',$3,$4,$4,$5,$6)",
      [spaceId, `PK-6 ${spaceId.slice(0, 8)}`, membershipId, scheduleId, periodId, subject]);
    await seed.query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membershipId, spaceId, profileId, subject]);
    await seed.query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p5',$6,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await seed.query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [scheduleId, spaceId, JSON.stringify({ cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } })]);
    await seed.query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,'active','2099-01-01','2099-01-31')", [periodId, spaceId, scheduleId]);
    await seed.query("COMMIT");
    return { spaceId, membershipId };
  } catch (error) { await seed.query("ROLLBACK"); throw error; } finally { seed.release(); await admin.end(); }
}

const mutation = (csrf: string) => ({ origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrf, "content-type": "application/json" });
const ceremony = { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" };

describe("PK6-01 live: the whole invitation ceremony over HTTP on real PostgreSQL", { skip: !configured }, () => {
  it("owner creates, link holder resolves and verifies through the local delivery surface, signs in, attaches, reads, accepts; owner confirms; the rows exist and every uniform outcome is byte-identical", async (t) => {
    const h = await harness();
    try {
      const owner = await signIn(h, "subject-a");
      const space = await seedSpace(owner.accountSubjectId);
      const uniform = { status: UNIFORM_INVITATION_STATUS, body: JSON.stringify(UNIFORM_INVITATION_BODY) };
      const answers: Record<string, { status: number; body: string }> = {};
      const record = (name: string, response: Response) => { answers[name] = { status: response.statusCode, body: response.body }; };

      let invitationId = ""; let code = ""; let challenge = ""; let ceremonyId = ""; let invitee = { accountSubjectId: "", csrfValue: "" };

      await t.test("the owner creates a Collaborator invitation on 24.invite_nonowner and sees only the customer projection", async () => {
        const created = await h.inject("POST", `/v1/budget-spaces/${space.spaceId}/invitations`, mutation(owner.csrfValue), { channel: "email", destination: "Invitee@Example.com", proposedRole: "collaborator", idempotencyKey: randomUUID() });
        assert.equal(created.statusCode, 201, created.body);
        invitationId = created.json().invitation.invitationId;
        assert.deepEqual(Object.keys(created.json().invitation).sort(), ["destinationMasked", "inactiveAt", "invitationId", "issuedAt", "predecessorInvitationId", "proposedRole", "state"]);
        assert.equal(created.json().invitation.destinationMasked, "i***@example.com");
        const rows = await h.client.tenantSelect({ table: "budget_space_invitation", budgetSpaceId: space.spaceId, columns: ["state", "required_permission", "policy_version"], conditions: [{ column: "invitation_id", value: invitationId }] });
        assert.deepEqual(rows.rows[0], { state: "pending", required_permission: "24", policy_version: "p5" });
        const listed = await h.inject("GET", `/v1/budget-spaces/${space.spaceId}/invitations`);
        assert.equal(listed.statusCode, 200, listed.body);
        assert.equal(listed.json().invitations.length, 1);
      });

      await t.test("the simulated local delivery surface renders the link and the channel challenge (FIDELITY_LABEL simulated)", async () => {
        const deliveries = await h.inject("GET", "/v1/local/invitation-deliveries");
        assert.equal(deliveries.statusCode, 200, deliveries.body);
        assert.equal(deliveries.json().fidelityLabel, "simulated");
        const item = (deliveries.json().deliveries as { invitationId: string; code: string; channelChallenge: string; destinationMasked: string }[]).find((row) => row.invitationId === invitationId);
        assert.ok(item, "the delivery for the new invitation");
        // SEC-PK6-R8 condition 3: the decrypted address is masked on this surface; the raw one never leaves the adapter.
        assert.equal(item.destinationMasked, "i***@example.com");
        assert.ok(!deliveries.body.includes("invitee@example.com"), "the raw destination is not in the body");
        assert.match(item.channelChallenge, /^\d{6}$/u);
        // PK5-F02: the surface projects the whole `<selector>.<secret>` bearer; the link holder presents it unchanged.
        assert.match(item.code, /^[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u, "the delivered code is selector-shaped");
        code = item.code; challenge = item.channelChallenge;
      });

      await t.test("the link holder resolves the link (TR-73-08) and receives the ceremony cookie, then proves the channel (TR-73-09) after one wrong guess that commits", async () => {
        delete h.cookies[SESSION_COOKIE_NAME];
        const resolved = await h.inject("POST", "/v1/invitations/resolve", ceremony, { code });
        assert.equal(resolved.statusCode, 200, resolved.body);
        ceremonyId = resolved.json().ceremonyId;
        assert.deepEqual(Object.keys(resolved.json()).sort(), ["ceremonyExpiresAt", "ceremonyId", "channelType"], "the ceremony-entry minimum: no role, no space, no inviter");
        assert.ok(h.cookies[INVITATION_CEREMONY_COOKIE_NAME], "the ceremony cookie was delivered");
        assert.ok(!resolved.body.includes(h.cookies[INVITATION_CEREMONY_COOKIE_NAME]!), "the secret travels only in the cookie");
        const wrong = await h.inject("POST", `/v1/invitations/${ceremonyId}/verify-channel`, ceremony, { channelCode: challenge === "000000" ? "000001" : "000000" });
        assert.equal(wrong.statusCode, 400, wrong.body);
        assert.equal(wrong.json().error, "channel_challenge_invalid");
        const attempts = await h.client.tenantSelect({ table: "budget_space_invitation_ceremony", budgetSpaceId: space.spaceId, columns: ["channel_attempts", "channel_proof_state"], conditions: [{ column: "ceremony_id", value: ceremonyId }] });
        assert.deepEqual(attempts.rows[0], { channel_attempts: 1, channel_proof_state: "challenged" }, "PK5FIX-F01: the wrong guess committed its increment");
        const proved = await h.inject("POST", `/v1/invitations/${ceremonyId}/verify-channel`, ceremony, { channelCode: challenge });
        assert.equal(proved.statusCode, 200, proved.body);
        assert.equal(proved.json().outcome, "proved");
      });

      await t.test("the pre-counter gate denies a verify-channel naming no resolvable ceremony before any counter is touched", async () => {
        const unknown = await h.inject("POST", `/v1/invitations/${randomUUID()}/verify-channel`, ceremony, { channelCode: challenge });
        assert.equal(unknown.statusCode, 403, unknown.body);
        assert.deepEqual(unknown.json(), { outcome: "deny", reason: "denied" });
      });

      await t.test("the invitee signs in through the local chooser as subject-b and attaches (TR-73-10) on invitation.attach", async () => {
        invitee = await signIn(h, "subject-b");
        assert.notEqual(invitee.accountSubjectId, owner.accountSubjectId);
        assert.ok(h.cookies[INVITATION_CEREMONY_COOKIE_NAME], "the ceremony cookie survived the sign-in");
        const attached = await h.inject("POST", `/v1/invitations/${ceremonyId}/attach`, mutation(invitee.csrfValue), {});
        assert.equal(attached.statusCode, 200, attached.body);
        assert.deepEqual(attached.json(), { ceremonyId, attached: true });
        const row = await h.client.tenantSelect({ table: "budget_space_invitation_ceremony", budgetSpaceId: space.spaceId, columns: ["attached_subject_id", "attached_session_ref"], conditions: [{ column: "ceremony_id", value: ceremonyId }] });
        assert.equal((row.rows[0] as { attached_subject_id: string }).attached_subject_id, invitee.accountSubjectId);
        assert.ok((row.rows[0] as { attached_session_ref: string }).attached_session_ref, "SEC-PK2-F07: the session row id is recorded");
        assert.ok(!h.cookies[SESSION_COOKIE_NAME]!.includes((row.rows[0] as { attached_session_ref: string }).attached_session_ref), "never the session token");
      });

      await t.test("the invitee reads the disclosure on invitation.read_ceremony through the ceremony fact reader and accepts (TR-73-38) on invitation.accept", async () => {
        const view = await h.inject("GET", `/v1/invitations/${ceremonyId}`);
        assert.equal(view.statusCode, 200, view.body);
        assert.equal(view.json().disclosure.kind, "invitation_collaborator");
        assert.equal(view.json().disclosure.version, 1);
        assert.ok(view.json().disclosure.text.items.length > 0, "the approved text");
        assert.deepEqual(view.json().choice, { accept: false, decline: false });
        // PK8-F06: the space name from the budget_space row and the inviter's display label (the seeded name, or the neutral label).
        assert.equal(view.json().budgetSpaceName, `PK-6 ${space.spaceId.slice(0, 8)}`);
        assert.ok(typeof view.json().inviterDisplayName === "string" && view.json().inviterDisplayName.length > 0);
        assert.ok(!view.body.includes(owner.accountSubjectId), "never the inviter's subject id");
        const stale = await h.inject("POST", `/v1/invitations/${ceremonyId}/accept`, mutation(invitee.csrfValue), { acknowledgedDisclosure: { kind: "invitation_collaborator", version: 2 } });
        assert.equal(stale.statusCode, 409); assert.deepEqual(stale.json(), { error: "stale_disclosure" });
        const accepted = await h.inject("POST", `/v1/invitations/${ceremonyId}/accept`, mutation(invitee.csrfValue), { acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 } });
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal(accepted.json().state, "awaiting_confirmation");
        // Before confirmation the invitee is still not a member: no membership row, and the members list denies.
        const memberships = await h.client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: space.spaceId, columns: ["membership_id"], conditions: [{ column: "account_subject_id", value: invitee.accountSubjectId }] });
        assert.equal(memberships.rows.length, 0);
        assert.equal((await h.inject("GET", `/v1/budget-spaces/${space.spaceId}/members`)).statusCode, 403);
      });

      await t.test("the owner confirms (TR-73-39 + TR-73-13): the membership and the consent rows exist, the receipt replays, and both members see the list", async () => {
        const returning = await signIn(h, "subject-a");
        assert.equal(returning.accountSubjectId, owner.accountSubjectId);
        const key = randomUUID();
        const confirmed = await h.inject("POST", `/v1/budget-spaces/${space.spaceId}/invitations/${invitationId}/confirm`, mutation(returning.csrfValue), { confirmationIdempotencyKey: key });
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        const receipt = confirmed.json().receipt;
        assert.equal(receipt.role, "collaborator");
        const membership = await h.client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: space.spaceId, columns: ["membership_id", "role", "status"], conditions: [{ column: "account_subject_id", value: invitee.accountSubjectId }] });
        assert.deepEqual(membership.rows, [{ membership_id: receipt.membershipId, role: "collaborator", status: "active" }], "one active Collaborator membership");
        const consent = await h.client.tenantSelect({ table: "budget_space_consent", budgetSpaceId: space.spaceId, columns: ["state", "source", "source_ceremony_id", "recorded_by_subject_id", "disclosure_kind", "disclosure_version", "policy_version"], conditions: [{ column: "membership_id", value: receipt.membershipId }] });
        assert.deepEqual(consent.rows, [{ state: "current", source: "invitation_acceptance", source_ceremony_id: ceremonyId, recorded_by_subject_id: invitee.accountSubjectId, disclosure_kind: "invitation_collaborator", disclosure_version: 1, policy_version: "p5" }], "one current consent row recorded by the invitee");
        const invitation = await h.client.tenantSelect({ table: "budget_space_invitation", budgetSpaceId: space.spaceId, columns: ["state", "projection_state"], conditions: [{ column: "invitation_id", value: invitationId }] });
        assert.deepEqual(invitation.rows[0], { state: "accepted", projection_state: "accepted" });
        const codeRow = await h.client.tenantSelect({ table: "budget_space_invitation_code", budgetSpaceId: space.spaceId, columns: ["disposition"], conditions: [{ column: "invitation_id", value: invitationId }] });
        assert.deepEqual(codeRow.rows[0], { disposition: "consumed" });
        const replayed = await h.inject("POST", `/v1/budget-spaces/${space.spaceId}/invitations/${invitationId}/confirm`, mutation(returning.csrfValue), { confirmationIdempotencyKey: key });
        assert.equal(replayed.statusCode, 200); assert.deepEqual(replayed.json(), confirmed.json(), "CBD-275-AC03: the stored receipt");
        const ownerView = await h.inject("GET", `/v1/budget-spaces/${space.spaceId}/members`);
        assert.equal(ownerView.statusCode, 200, ownerView.body);
        assert.deepEqual((ownerView.json().members as { role: string }[]).map((m) => m.role), ["primary_owner", "collaborator"]);
        for (const member of ownerView.json().members) assert.deepEqual(Object.keys(member).sort(), ["displayName", "joinedAt", "membershipId", "role"]);
        await signIn(h, "subject-b");
        const inviteeView = await h.inject("GET", `/v1/budget-spaces/${space.spaceId}/members`);
        assert.equal(inviteeView.statusCode, 200, inviteeView.body);
        assert.equal(inviteeView.json().members.length, 2, "1.view_members allows the Collaborator");
        record("consumed link", await h.inject("POST", "/v1/invitations/resolve", ceremony, { code }));
      });

      await t.test("every unusable class answers byte-identically over the real stack", async () => {
        record("unknown code", await h.inject("POST", "/v1/invitations/resolve", ceremony, { code: "not-a-code" }));
        record("empty code", await h.inject("POST", "/v1/invitations/resolve", ceremony, {}));
        // PK5-F02: the consumed link's real selector with a wrong secret, and
        // an unknown selector with its real secret, over the real stack.
        const [consumedSelector, consumedSecret] = code.split(".");
        record("known selector, wrong secret", await h.inject("POST", "/v1/invitations/resolve", ceremony, { code: `${consumedSelector}.${"0".repeat(64)}` }));
        record("unknown selector, real secret", await h.inject("POST", "/v1/invitations/resolve", ceremony, { code: `${"A".repeat(43)}.${consumedSecret}` }));
        record("malformed selector half", await h.inject("POST", "/v1/invitations/resolve", ceremony, { code: `short.${consumedSecret}` }));
        record("verify on the consumed ceremony", await h.inject("POST", `/v1/invitations/${ceremonyId}/verify-channel`, ceremony, { channelCode: challenge }));
        record("decline on the consumed ceremony", await h.inject("POST", `/v1/invitations/${ceremonyId}/decline`, ceremony, {}));
        const again = await signIn(h, "subject-a");
        const second = await h.inject("POST", `/v1/budget-spaces/${space.spaceId}/invitations`, mutation(again.csrfValue), { channel: "email", destination: "second@example.com", proposedRole: "collaborator", idempotencyKey: randomUUID() });
        assert.equal(second.statusCode, 201, second.body);
        const deliveries = await h.inject("GET", "/v1/local/invitation-deliveries");
        const item = (deliveries.json().deliveries as { invitationId: string; code: string }[]).find((row) => row.invitationId === second.json().invitation.invitationId)!;
        const resolved = await h.inject("POST", "/v1/invitations/resolve", ceremony, { code: item.code });
        assert.equal(resolved.statusCode, 200);
        record("decline before the channel is proved (out of order)", await h.inject("POST", `/v1/invitations/${resolved.json().ceremonyId}/decline`, ceremony, {}));
        h.cookies[INVITATION_CEREMONY_COOKIE_NAME] = "0123456789abcdef0123456789abcdef";
        record("wrong ceremony cookie", await h.inject("POST", `/v1/invitations/${resolved.json().ceremonyId}/verify-channel`, ceremony, { channelCode: "000000" }));
        const { "content-type": _type, ...deleteHeaders } = mutation(again.csrfValue);
        const cancelled = await h.inject("DELETE", `/v1/budget-spaces/${space.spaceId}/invitations/${second.json().invitation.invitationId}`, deleteHeaders);
        assert.equal(cancelled.statusCode, 200, cancelled.body);
        record("cancelled link", await h.inject("POST", "/v1/invitations/resolve", ceremony, { code: item.code }));
        for (const [name, answer] of Object.entries(answers)) assert.deepEqual(answer, uniform, name);
        assert.ok(Object.keys(answers).length >= 11);
      });
    } finally {
      await h.close();
    }
  });
});
