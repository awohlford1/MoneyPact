/**
 * PK7B-01 process-level proof of the whole Primary transfer over HTTP on a
 * live PostgreSQL 17 (PROTO-INVITATIONS-PK7B-TRANSFER-API-001; CBD-234 design
 * sections 10.2, 10.3, 10.4 and 15 PK-7 row; CBD-73 section 12).
 *
 * Opt-in exactly like `../invitations/ceremony.live.test.ts`:
 * `COBUDGET_DB_NAME` must name a migrated scratch database other than
 * `cobudget_dev` or `cobudget_demo`, created fresh and hosting no other
 * package's live suite (PK6-F05: the local delivery surface fails closed on an
 * outbox row written under another key version). Nothing here starts Docker,
 * resets, or cleans up; every identifier is fresh.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_pk7b npx tsx --test src/primary-transfer/transfer.live.test.ts
 *
 * What is real here: the whole composed API (`createComposedApiApplication`
 * with the production `sessions/runtime.ts` wiring -- the real
 * `ApiAuthorizationBoundary`, the real fact assembler with the `membership`
 * target reader, the real rate limits, the real CBD-191 sessions and CSRF,
 * the real CBD-190 local identity chooser and the real PK-4 step-up), the
 * real PK-7A module over the real PK-2 schema through the real CBD-246 seam,
 * the real `ApiTransactionStore` spending the real
 * `account_session_fresh_assurance` grant and the real
 * `PrimaryTransferAuthorizationStore` composed over it. The Primary signs in
 * as `subject-a`, invites a Co-owner (a pending permission-26 invitation of
 * their own) and proposes the transfer to the Co-owner `subject-b`, who
 * accepts; the Primary's confirm at session assurance is denied; the Primary
 * steps up through the local step-up ceremony bound to
 * `29.transfer_primary_ownership` and this space and confirms; the commit
 * swaps the roles and the consent rows, advances both `authorization_version`s
 * and `primary_ownership_version`, records the consumed grant's own
 * identifier as the evidence reference (`SEC-PK7A-F2`), cancels the former
 * Primary's permission-26 invitation, writes both `MSG-73-042` notices, and
 * the members list shows the new Primary; the spent grant authorizes nothing
 * further.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { SESSION_COOKIE_NAME, findUsableFreshAssurance } from "@cobudget/sessions";
import type { DataAccessClient } from "@cobudget/data-access";
import { createComposedApiApplication } from "../application.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";
import { STEP_UP_REQUIRED, TRANSFER_ACTIONS } from "./http.ts";

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
  /** The restricted audit stream: the only place a denial's reason class is readable (CBD-236 section 5.2). */
  readonly lastReason: () => string | undefined;
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
  // SEC-PK6-F5: the pre-authentication locator statements read from their own connection, as the production composition does.
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
  const lastReason = () => { const last = runtime.audit?.snapshot().at(-1) as { reasonClass?: string; reason_class?: string } | undefined; return last?.reasonClass ?? last?.reason_class; };
  return { client, app, port, cookies, inject, lastReason, close: async () => { await app.close(); await pool.end(); await locatorPool.end(); } };
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
  assert.equal(delivered.headers["set-cookie"], undefined, "a step-up never delivers a session cookie");
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
      [spaceId, `PK-7B ${spaceId.slice(0, 8)}`, membershipId, scheduleId, periodId, subject]);
    await query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membershipId, spaceId, profileId, subject]);
    await query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p5',$6,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [scheduleId, spaceId, JSON.stringify({ cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } })]);
    await query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,'active','2099-01-01','2099-01-31')", [periodId, spaceId, scheduleId]);
  });
  return { spaceId, membershipId };
}

/** A second active member with a `current` consent row, as an accepted Co-owner invitation would have left them. */
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

describe("PK7B-01 live: the whole Primary transfer over HTTP on real PostgreSQL", { skip: !configured }, () => {
  it("Primary proposes to a Co-owner, the Co-owner accepts, the Primary steps up and confirms; the commit swaps roles and consent, the members list shows the new Primary, the permission-26 invitation is cancelled and the grant is consumed", async (t) => {
    const h = await harness();
    try {
      const primary = await signIn(h, "subject-a");
      const space = await seedSpace(primary.accountSubjectId);
      const coOwnerIdentity = await signIn(h, "subject-b");
      assert.notEqual(coOwnerIdentity.accountSubjectId, primary.accountSubjectId);
      const coOwner = await seedCoOwner(space.spaceId, primary.accountSubjectId, coOwnerIdentity.accountSubjectId);
      const base = `/v1/budget-spaces/${space.spaceId}/primary-transfers`;
      let transferId = ""; let invitationId = ""; let owner = primary; let grantId = "";

      await t.test("the Primary holds a pending permission-26 invitation and proposes the transfer to the Co-owner on 29.propose_primary_transfer", async () => {
        owner = await signIn(h, "subject-a");
        const invited = await h.inject("POST", `/v1/budget-spaces/${space.spaceId}/invitations`, mutation(owner.csrfValue), { channel: "email", destination: "another-coowner@example.com", proposedRole: "co_owner", idempotencyKey: randomUUID() });
        assert.equal(invited.statusCode, 201, invited.body);
        invitationId = invited.json().invitation.invitationId;
        const invitation = await h.client.tenantSelect({ table: "budget_space_invitation", budgetSpaceId: space.spaceId, columns: ["state", "required_permission"], conditions: [{ column: "invitation_id", value: invitationId }] });
        assert.deepEqual(invitation.rows[0], { state: "pending", required_permission: "26" });
        // A Co-owner cannot propose (no Co-owner column on the Primary cell): the uniform denial.
        const proposed = await h.inject("POST", base, mutation(owner.csrfValue), { recipientMembershipId: coOwner.membershipId });
        assert.equal(proposed.statusCode, 201, proposed.body);
        assert.equal(proposed.json().outcome, "proposed");
        assert.equal(proposed.json().messageCode, "MSG-73-040");
        transferId = proposed.json().transfer.transferId;
        const row = await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "state_version", "proposer_membership_id", "recipient_membership_id", "policy_version", "primary_assurance_ref"], conditions: [{ column: "transfer_id", value: transferId }] });
        assert.deepEqual(row.rows[0], { state: "proposed", state_version: 1, proposer_membership_id: space.membershipId, recipient_membership_id: coOwner.membershipId, policy_version: "p5", primary_assurance_ref: null });
        // SEC-PK7A-F5: a malformed identifier never reaches a statement.
        const malformed = await h.inject("POST", `${base}/not-a-transfer/accept`, mutation(owner.csrfValue), {});
        assert.equal(malformed.statusCode, 404); assert.deepEqual(malformed.json(), { error: "transfer_not_found" });
      });

      await t.test("the Co-owner reads the status and accepts on 29.accept_primary_transfer; a second Co-owner-shaped request by the Primary on the recipient's leg is denied by the handler", async () => {
        const recipient = await signIn(h, "subject-b");
        const view = await h.inject("GET", `${base}/${transferId}`);
        assert.equal(view.statusCode, 200, view.body);
        assert.equal(view.json().transfer.state, "proposed");
        assert.ok(!view.body.includes("ssurance"), "no assurance material on the wire");
        // PK8-F01: the MSG-73-040 row reached the recipient through the subject-self notices route; the stamp is set once.
        const notices = await h.inject("GET", "/v1/notices");
        assert.equal(notices.statusCode, 200, notices.body);
        const proposalNotice = (notices.json().notices as { noticeId: string; budgetSpaceId: string | null; messageCode: string; readAt: string | null }[]).find((row) => row.budgetSpaceId === space.spaceId && row.messageCode === "MSG-73-040");
        assert.ok(proposalNotice, notices.body);
        assert.equal(proposalNotice.readAt, null);
        const marked = await h.inject("POST", `/v1/notices/${proposalNotice.noticeId}/read`, mutation(recipient.csrfValue), {});
        assert.equal(marked.statusCode, 200, marked.body);
        assert.ok(marked.json().notice.readAt);
        assert.deepEqual((await h.inject("POST", `/v1/notices/${proposalNotice.noticeId}/read`, mutation(recipient.csrfValue), {})).json(), marked.json(), "set-once: the repeat answers the stamped row");
        const accepted = await h.inject("POST", `${base}/${transferId}/accept`, mutation(recipient.csrfValue), {});
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal(accepted.json().outcome, "recipient_accepted");
        assert.equal(accepted.json().messageCode, "MSG-73-025");
        const row = await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "state_version", "recipient_accepted_version"], conditions: [{ column: "transfer_id", value: transferId }] });
        assert.deepEqual(row.rows[0], { state: "recipient_accepted", state_version: 2, recipient_accepted_version: 2 });
        // SEC-P5-F1: the Primary is not the recipient; the accept cell has no Primary column, so the policy denies before the handler.
        owner = await signIn(h, "subject-a");
        const wrongParty = await h.inject("POST", `${base}/${transferId}/accept`, mutation(owner.csrfValue), {});
        assert.equal(wrongParty.statusCode, 403, wrongParty.body);
        assert.deepEqual(wrongParty.json(), { outcome: "deny", reason: "denied" });
        // PK8-F01 tenant safety: the recipient's notice is not in the Primary's list and cannot be stamped by the Primary.
        const ownersNotices = await h.inject("GET", "/v1/notices");
        assert.equal(ownersNotices.statusCode, 200, ownersNotices.body);
        assert.ok(!ownersNotices.body.includes(proposalNotice!.noticeId), "another person's row is not listed");
        const foreign = await h.inject("POST", `/v1/notices/${proposalNotice!.noticeId}/read`, mutation(owner.csrfValue), {});
        assert.equal(foreign.statusCode, 404, foreign.body); assert.deepEqual(foreign.json(), { error: "notice_not_found" });
      });

      await t.test("at session assurance the protected confirm is denied and nothing moves; no grant exists to consume", async () => {
        const denied = await h.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(denied.statusCode, 403, denied.body);
        assert.deepEqual(denied.json(), { outcome: "deny", reason: "denied" });
        const row = await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "primary_assurance_ref"], conditions: [{ column: "transfer_id", value: transferId }] });
        assert.deepEqual(row.rows[0], { state: "recipient_accepted", primary_assurance_ref: null });
        const grants = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: owner.sessionRef }] });
        assert.equal(grants.rows.length, 0);
      });

      await t.test("the Primary steps up bound to 29.transfer_primary_ownership and this space, and the confirm commits TR-73-43 inside the boundary's transaction", async () => {
        assert.equal(await stepUp(h, owner.csrfValue, "subject-a", TRANSFER_ACTIONS.confirm, space.spaceId), 303);
        const issued = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: owner.sessionRef }] });
        assert.equal(issued.rows.length, 1, "one grant");
        const grant = issued.rows[0] as Record<string, unknown>;
        assert.deepEqual({ bound_action: grant.bound_action, bound_space_id: grant.bound_space_id, state: grant.state }, { bound_action: TRANSFER_ACTIONS.confirm, bound_space_id: space.spaceId, state: "issued" });
        grantId = String(grant.fresh_assurance_id);

        const confirmed = await h.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        assert.equal(confirmed.json().outcome, "committed");
        assert.equal(confirmed.json().messageCode, "MSG-73-042");
        assert.equal(confirmed.json().freshAssurance, "consumed");
        const receipt = confirmed.json().receipt;
        assert.equal(receipt.newPrimaryMembershipId, coOwner.membershipId);
        assert.equal(receipt.formerPrimaryMembershipId, space.membershipId);
        assert.ok(!confirmed.body.includes(grantId), "the evidence reference never reaches the wire");

        // The grant was consumed by this very action, and the reference the commit recorded is the consumed row's own identifier (SEC-PK7A-F2).
        const spent = (await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "fresh_assurance_id", value: grantId }] })).rows[0] as Record<string, unknown>;
        assert.equal(spent.state, "consumed");
        assert.equal(spent.consumed_by_action, TRANSFER_ACTIONS.confirm);
        const transfer = (await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "primary_assurance_ref", "recipient_consent_id", "outgoing_consent_id", "committed_at"], conditions: [{ column: "transfer_id", value: transferId }] })).rows[0] as Record<string, unknown>;
        assert.equal(transfer.state, "committed");
        assert.equal(transfer.primary_assurance_ref, grantId);
        assert.ok(transfer.committed_at);
        // Roles swapped, both authorization versions advanced (SEC-PK6-R1), the space moved and its ownership version advanced (design 10.3 step 4).
        const memberships = await h.client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: space.spaceId, columns: ["membership_id", "role", "status", "authorization_version"] });
        const byId = Object.fromEntries((memberships.rows as Record<string, unknown>[]).map((row) => [row.membership_id, row]));
        assert.deepEqual(byId[space.membershipId], { membership_id: space.membershipId, role: "co_owner", status: "active", authorization_version: 2 });
        assert.deepEqual(byId[coOwner.membershipId], { membership_id: coOwner.membershipId, role: "primary_owner", status: "active", authorization_version: 2 });
        const spaceRow = (await h.client.tenantSelect({ table: "budget_space", budgetSpaceId: space.spaceId, columns: ["primary_owner_membership_id", "primary_ownership_version"] })).rows[0];
        assert.deepEqual(spaceRow, { primary_owner_membership_id: coOwner.membershipId, primary_ownership_version: 2 });
        // Consent: both prior rows superseded with the transfer reason class; two new current rows of the transfer source; the outgoing row carries the reference.
        const consents = (await h.client.tenantSelect({ table: "budget_space_consent", budgetSpaceId: space.spaceId, columns: ["consent_id", "membership_id", "role", "state", "source", "disclosure_kind", "ended_reason_class", "assurance_ref", "supersedes_consent_id"] })).rows as Record<string, unknown>[];
        const current = consents.filter((row) => row.state === "current");
        assert.deepEqual(current.map((row) => [row.membership_id, row.role, row.source, row.disclosure_kind]).sort(), [
          [coOwner.membershipId, "primary_owner", "primary_transfer", "primary_transfer_recipient"], [space.membershipId, "co_owner", "primary_transfer", "primary_transfer_outgoing"],
        ].sort());
        assert.equal(current.find((row) => row.membership_id === space.membershipId)!.assurance_ref, grantId);
        assert.equal(current.find((row) => row.membership_id === coOwner.membershipId)!.assurance_ref, null);
        assert.equal(current.find((row) => row.membership_id === space.membershipId)!.consent_id, transfer.outgoing_consent_id);
        assert.equal(current.find((row) => row.membership_id === coOwner.membershipId)!.consent_id, transfer.recipient_consent_id);
        const superseded = consents.filter((row) => row.state === "superseded");
        assert.equal(superseded.length, 2);
        for (const row of superseded) assert.equal(row.ended_reason_class, "primary_transfer");
        for (const row of current) assert.ok(superseded.some((prior) => prior.consent_id === row.supersedes_consent_id), "each new row names the row it supersedes");
        // The former Primary's permission-26 invitation was cancelled through PK-5's system path (design 10.3 step 6).
        const invitation = await h.client.tenantSelect({ table: "budget_space_invitation", budgetSpaceId: space.spaceId, columns: ["state", "projection_state"], conditions: [{ column: "invitation_id", value: invitationId }] });
        assert.deepEqual(invitation.rows[0], { state: "cancelled", projection_state: "pending" }, "restricted cause: the customer projection is untouched");
        // Two MSG-73-042 notices, one per party, written in the causing transaction (CBD-280-AC06).
        const notices = await withAdmin((query) => query("SELECT account_subject_id FROM account_lifecycle_notice WHERE budget_space_id = $1 AND message_code = 'MSG-73-042'", [space.spaceId]));
        assert.deepEqual((notices.rows as { account_subject_id: string }[]).map((row) => row.account_subject_id).sort(), [primary.accountSubjectId, coOwnerIdentity.accountSubjectId].sort());
        // The AE-73-25 transfer_committed row and the audited enqueue children.
        const audit = await h.client.tenantSelect({ table: "budget_space_lifecycle_audit", budgetSpaceId: space.spaceId, columns: ["event_code", "event_subtype"], conditions: [{ column: "target_id", value: transferId }] });
        assert.ok((audit.rows as { event_subtype: string }[]).some((row) => row.event_subtype === "transfer_committed"));
      });

      await t.test("the members list shows the new Primary, the spent grant authorizes nothing further, and the former Primary is no longer allowed the protected cell", async () => {
        // The former Primary is a Co-owner now: 1.view_members carries a Co-owner column, so the list reads under the swapped role.
        const members = await h.inject("GET", `/v1/budget-spaces/${space.spaceId}/members`);
        assert.equal(members.statusCode, 200, `${members.body} ${h.lastReason()}`);
        assert.deepEqual((members.json().members as { membershipId: string; role: string }[]).map((m) => [m.membershipId, m.role]).sort(), [[space.membershipId, "co_owner"], [coOwner.membershipId, "primary_owner"]].sort());
        assert.equal(await findUsableFreshAssurance(h.client, { sessionRef: owner.sessionRef, boundAction: TRANSFER_ACTIONS.confirm, boundSpaceId: space.spaceId, now: new Date() }), undefined, "the spent grant is gone");
        // SEC-P5-F1: a former Primary confirming after the role change. The released policy has no Co-owner column on
        // 29.transfer_primary_ownership, and there is no grant either way: the uniform denial, nothing written.
        const repeat = await h.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(repeat.statusCode, 403, repeat.body);
        assert.deepEqual(repeat.json(), { outcome: "deny", reason: "denied" });
        const view = await h.inject("GET", `${base}/${transferId}`);
        assert.equal(view.statusCode, 200, view.body);
        assert.equal(view.json().transfer.state, "committed");
        assert.ok(!view.body.includes(grantId));
      });
    } finally {
      await h.close();
    }
  });
});

describe("PK7B-01/02 live: the Primary-first order and the grant's fate on the real stack", { skip: !configured }, () => {
  it("a boundary denial returns the grant with its rollback; a recorded leg consumes it; the recipient's accept completes the pair on the stored reference", async (t) => {
    const h = await harness();
    try {
      // Six identity ceremonies at most per harness: the bootstrap record's ordinary sub-pool is what `begin` counts on.
      const primary = await signIn(h, "subject-a");
      const space = await seedSpace(primary.accountSubjectId);
      const recipientIdentity = await signIn(h, "subject-b");
      const recipient = await seedCoOwner(space.spaceId, primary.accountSubjectId, recipientIdentity.accountSubjectId);
      const base = `/v1/budget-spaces/${space.spaceId}/primary-transfers`;
      const owner = await signIn(h, "subject-a");
      const usable = () => findUsableFreshAssurance(h.client, { sessionRef: owner.sessionRef, boundAction: TRANSFER_ACTIONS.confirm, boundSpaceId: space.spaceId, now: new Date() });
      let transferId = "";

      await t.test("a confirm naming a withdrawn workflow is denied at the boundary and the rollback returns the grant unspent", async () => {
        const first = await h.inject("POST", base, mutation(owner.csrfValue), { recipientMembershipId: recipient.membershipId });
        assert.equal(first.statusCode, 201, first.body);
        assert.equal(await stepUp(h, owner.csrfValue, "subject-a", TRANSFER_ACTIONS.confirm, space.spaceId), 303);
        assert.ok(await usable(), "one live grant");
        const withdrawn = await h.inject("POST", `${base}/${first.json().transfer.transferId}/withdraw`, mutation(owner.csrfValue), {});
        assert.equal(withdrawn.statusCode, 200, withdrawn.body);
        assert.equal(withdrawn.json().outcome, "withdrawn");
        // No live workflow: the transfer store cannot begin its ledger, the boundary denies before the handler, and the spend rolls back.
        const denied = await h.inject("POST", `${base}/${first.json().transfer.transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(denied.statusCode, 403, denied.body);
        assert.deepEqual(denied.json(), { outcome: "deny", reason: "denied" });
        assert.ok(await usable(), "the grant is still usable: a rolled-back spend is no spend");
      });

      await t.test("the Primary-first confirm records the leg under the grant and consumes it; a repeat under a new grant is refused by the confirm discharge and the new grant is returned", async () => {
        const proposed = await h.inject("POST", base, mutation(owner.csrfValue), { recipientMembershipId: recipient.membershipId });
        assert.equal(proposed.statusCode, 201, proposed.body);
        transferId = proposed.json().transfer.transferId;
        const confirmed = await h.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        assert.equal(confirmed.json().outcome, "primary_confirmed");
        assert.deepEqual({ freshAssurance: confirmed.json().freshAssurance, next: confirmed.json().next }, { freshAssurance: "consumed", next: STEP_UP_REQUIRED });
        assert.equal(await usable(), undefined, "the leg consumed the grant");
        const row = (await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "primary_assurance_ref"], conditions: [{ column: "transfer_id", value: transferId }] })).rows[0] as { state: string; primary_assurance_ref: string | null };
        assert.equal(row.state, "primary_confirmed");
        const spent = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: owner.sessionRef }, { column: "state", value: "consumed" }] });
        assert.deepEqual((spent.rows as { fresh_assurance_id: string }[]).map((grant) => grant.fresh_assurance_id), [row.primary_assurance_ref], "the reference is the consumed grant's own identifier");
        // Without a new step-up the repeat is denied at session assurance. With a new grant, the repeat arrives with a
        // reference other than the one the row stored, so the boundary's `confirm` discharge refuses before the handler
        // (obligations.ts: the stored reference is authoritative), the transaction rolls back and the new grant is
        // returned unspent -- the row is untouched and the first reference stays authoritative (PK7AFIX-F02 at the route).
        assert.equal((await h.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {})).statusCode, 403);
        assert.equal(await stepUp(h, owner.csrfValue, "subject-a", TRANSFER_ACTIONS.confirm, space.spaceId), 303);
        const repeat = await h.inject("POST", `${base}/${transferId}/confirm`, mutation(owner.csrfValue), {});
        assert.equal(repeat.statusCode, 403, repeat.body);
        assert.deepEqual(repeat.json(), { outcome: "deny", reason: "denied" });
        assert.ok(await usable(), "the second grant was returned by the rollback");
        const after = (await h.client.tenantSelect({ table: "budget_space_primary_transfer", budgetSpaceId: space.spaceId, columns: ["state", "state_version", "primary_assurance_ref"], conditions: [{ column: "transfer_id", value: transferId }] })).rows[0] as Record<string, unknown>;
        assert.deepEqual(after, { state: "primary_confirmed", state_version: 2, primary_assurance_ref: row.primary_assurance_ref }, "nothing written by the repeat; the stored reference stays authoritative");
      });

      await t.test("the recipient's accept completes the pair on the stored reference: TR-73-43 runs in the accept's transaction without any grant of its own", async () => {
        const accepting = await signIn(h, "subject-b");
        const accepted = await h.inject("POST", `${base}/${transferId}/accept`, mutation(accepting.csrfValue), {});
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal(accepted.json().outcome, "committed");
        assert.equal(accepted.json().receipt.newPrimaryMembershipId, recipient.membershipId);
        assert.equal(accepted.json().freshAssurance, undefined, "the accept route says nothing about a grant it never spent");
        const memberships = await h.client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: space.spaceId, columns: ["membership_id", "role", "authorization_version"] });
        assert.deepEqual((memberships.rows as Record<string, unknown>[]).map((row) => [row.membership_id, row.role, row.authorization_version]).sort(), [[recipient.membershipId, "primary_owner", 2], [space.membershipId, "co_owner", 2]].sort());
        const members = await h.inject("GET", `/v1/budget-spaces/${space.spaceId}/members`);
        assert.equal(members.statusCode, 200, members.body);
        assert.deepEqual((members.json().members as { membershipId: string; role: string }[]).find((m) => m.membershipId === recipient.membershipId)?.role, "primary_owner");
        const grants = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: accepting.sessionRef }] });
        assert.equal(grants.rows.length, 0, "the recipient never held a grant");
      });
    } finally {
      await h.close();
    }
  });
});
