/**
 * PK4-02 and PK4-03 live PostgreSQL proof (PROTO-INVITATIONS-PK4-STEPUP-001).
 *
 * Opt-in exactly like `revocation-fence.live.test.ts` and
 * `mapping.live.test.ts`: `COBUDGET_DB_NAME` must name a migrated scratch
 * database other than `cobudget_dev`. This test never starts Docker, never
 * resets, and cleans nothing up -- every identifier is fresh.
 *
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_stepup npx tsx --test src/sessions/fresh-assurance.live.test.ts
 *
 * What is real here: the browser signs in over HTTP through the real
 * ceremony, walks the real step-up over the real local issuer, and the grant
 * that lands is the real `account_session_fresh_assurance` row with the real
 * triggers, constraints and partial unique index behind it. The protected
 * decision then runs through the real `AuthorizationBoundary`, the real
 * `FactAssembler`, the real `decide`, the real fact source and the real
 * `ApiTransactionStore` -- the assembler and boundary are constructed here
 * from the same exported pieces `runtime.ts` composes, because the protected
 * cell has no route of its own in this increment (the transfer routes are
 * PK-7) and a boundary is the honest way to exercise a cell without one.
 *
 * Two deliberate test-only substitutions, both named where they happen:
 *
 *   * `29.transfer_primary_ownership` binds a `membership` target, and the
 *     merged datastore reader produces `resource.*` only for space-set and
 *     row resource types it already owns. The membership row's own columns
 *     are supplied here through the composition's existing `extend` hook.
 *   * the cell's obligation list is `fresh_assurance, confirm, invalidate,
 *     notify, preserve`. The last four are PK-7's to discharge; this packet
 *     does not invent them, so the store used by `execute` below treats
 *     exactly those four as free and delegates `fresh_assurance` to the real
 *     `ApiTransactionStore`. The consumption proved here is therefore the
 *     production one, inside the production transaction.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { SESSION_COOKIE_NAME, consumeFreshAssurance, findUsableFreshAssurance } from "@cobudget/sessions";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput } from "@cobudget/contracts/authorization";
import { createComposedApiApplication } from "../application.js";
import { AuthorizationBoundary } from "../authorization/boundary.js";
import type { AuthorizationTransactionStore } from "../authorization/boundary.js";
import { RestrictedAudit } from "../authorization/audit.js";
import { readReleaseHistory } from "../authorization/compatibility.js";
import { FactAssembler } from "../authorization/facts.js";
import type { FactLookup } from "../authorization/facts.js";
import { APPLICATION_ORIGIN, localConfig } from "../identity/test-support/harness.ts";
import { InProcessRestrictedAuditStore } from "./audit.ts";
import { budgetFactReader } from "./budget-facts.ts";
import { createApiFactSource } from "./fact-source.ts";
import type { FactReader } from "./fact-source.ts";
import { buildSessionFactSourceAdapter } from "./index.js";
import { ApiTransactionStore } from "./transaction-store.ts";

const configured = loadLocalDatabaseConfig().database !== "cobudget_dev";
const ACTION = "29.transfer_primary_ownership";
const ENVIRONMENT = "development";
/** Fixture-only digests: opaque to every assertion here, and the consent trigger requires non-empty values. */
const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";
/** PK-7 owns these four; see the file comment. */
const PK7_OBLIGATIONS: ReadonlySet<Obligation["kind"]> = new Set(["confirm", "invalidate", "notify", "preserve"] as Obligation["kind"][]);

interface Harness {
  readonly client: DataAccessClient;
  readonly app: Awaited<ReturnType<typeof createComposedApiApplication>>["app"];
  readonly boundary: AuthorizationBoundary;
  readonly audit: InProcessRestrictedAuditStore;
  readonly cookie: () => string | undefined;
  readonly close: () => Promise<void>;
  readonly inject: (method: "GET" | "POST", url: string, headers?: Record<string, string>, payload?: Record<string, unknown>) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown>; json: () => any }>;
}

/**
 * The membership row's own columns as `resource.*`, for the one resource type
 * the merged datastore reader does not yet produce. It is a tenant-scoped
 * read keyed on the acting space, so it can only ever answer for a row inside
 * the space the request already named.
 */
function membershipResourceReader(): FactReader {
  return async (source, lookup, client) => {
    if (source !== "datastore") return null;
    const { operation } = lookup;
    if (operation.resourceType !== "membership" || typeof operation.resourceId !== "string" || typeof operation.actingSpaceId !== "string") return null;
    const result = await client.tenantSelect({
      table: "budget_space_membership", budgetSpaceId: operation.actingSpaceId,
      columns: ["membership_id", "budget_space_id", "authorization_version", "status"],
      conditions: [{ column: "membership_id", value: operation.resourceId }],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return { "resource.owningSpaceId": row.budget_space_id, "resource.version": Number(row.authorization_version), "resource.lifecycle": "active" };
  };
}

/** Delegates everything to the real store; only PK-7's four obligations are treated as free. */
function storeWithoutPk7Obligations(real: ApiTransactionStore): AuthorizationTransactionStore {
  return {
    transaction: (work) => real.transaction(work),
    discharge: (transaction, input, obligation) => PK7_OBLIGATIONS.has(obligation.kind) ? Promise.resolve(true) : real.discharge(transaction, input, obligation),
    verify: (transaction, input, obligations) => real.verify(transaction, input, obligations.filter((obligation) => !PK7_OBLIGATIONS.has(obligation.kind))),
  };
}

async function harness(): Promise<Harness> {
  const { createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const pool = createApiConnection();
  const client = bindClient(pool, true);
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  const config = localConfig({ NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: ENVIRONMENT, COBUDGET_IDENTITY_CEREMONY_ORIGIN: `http://127.0.0.1:${port}`, COBUDGET_IDENTITY_ISSUER: `http://127.0.0.1:${port}/v1/identity/local` });
  const extend = membershipResourceReader();
  const { app } = await createComposedApiApplication(config, () => undefined, readReleaseHistory(), { client, scheduler: null, extendFacts: extend });
  await app.init();
  await (app.getHttpAdapter().getInstance() as FastifyInstance).ready();

  const sessions = buildSessionFactSourceAdapter(await import("./runtime.ts").then((m) => m.resolveApiSessionConfiguration(config).session), ENVIRONMENT, client, true);
  const budgetFacts = budgetFactReader(ENVIRONMENT);
  const layered: FactReader = async (source, lookup, scoped) => {
    const facts = { ...(await budgetFacts(source, lookup, scoped) ?? {}), ...(await extend(source, lookup, scoped) ?? {}) };
    return Object.keys(facts).length ? facts : null;
  };
  const audit = new InProcessRestrictedAuditStore();
  const boundary = new AuthorizationBoundary(
    new FactAssembler("api", createApiFactSource({ sessions, client, extend: layered }), () => new Date(), 5_000, undefined, { environmentId: ENVIRONMENT }),
    storeWithoutPk7Obligations(new ApiTransactionStore(client, audit)),
    new RestrictedAudit(audit, { retentionClass: "restricted_security_evidence:in_process_prototype", deletionPolicyVersion: "prototype-in-process-v1", retentionApprovalRef: "PROTOTYPE-SLICE-001", reasonVocabularyApprovalRef: "CBD236-P1-RELEASE-001" }),
    () => undefined,
  );

  const cookies: Record<string, string> = {};
  const inject: Harness["inject"] = async (method, url, headers = {}, payload) => {
    const response = await app.inject({ method, url, headers: { host: "localhost:3000", ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const raw = response.headers["set-cookie"];
    for (const header of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) { const [pair] = header.split(";"); const i = pair!.indexOf("="); cookies[pair!.slice(0, i)] = pair!.slice(i + 1); }
    return response as unknown as Awaited<ReturnType<Harness["inject"]>>;
  };
  Object.assign(inject, { port });
  return {
    client, app, boundary, audit, inject,
    cookie: () => cookies[SESSION_COOKIE_NAME],
    close: async () => { await app.close(); await pool.end(); },
  };
}

/** Signs in over HTTP exactly as a browser does, and returns the identity bootstrap. */
async function signIn(h: Harness, port: number): Promise<{ accountSubjectId: string; sessionRef: string; csrfValue: string }> {
  const begin = await h.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  const authorize = new URL(begin.json().navigateTo);
  const chooser = await h.inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${port}` });
  const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&");
  const choice = await h.inject("GET", link, { host: `127.0.0.1:${port}` });
  const callback = new URL(choice.headers.location as string);
  const done = await h.inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
  assert.equal(done.statusCode, 303, done.body);
  assert.ok(h.cookie(), "the sign-in delivered a session cookie");
  const me = await h.inject("GET", "/v1/identity/me");
  assert.equal(me.statusCode, 200, me.body);
  return { accountSubjectId: me.json().accountSubjectId, sessionRef: me.json().sessionRef, csrfValue: me.json().csrfValue };
}

/** A live budget space whose Primary Owner is `subject`, with the consent row the landing requires. */
async function seedSpace(subject: string): Promise<{ spaceId: string; membershipId: string; profileId: string }> {
  const { createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const seed = await admin.connect();
  const spaceId = randomUUID(); const membershipId = randomUUID(); const scheduleId = randomUUID(); const periodId = randomUUID();
  try {
    const profiles = await seed.query("SELECT profile_id FROM financial_profile WHERE account_subject_id = $1 AND profile_state = 'active'", [subject]);
    const profileId = String(profiles.rows[0]!.profile_id);
    await seed.query("BEGIN");
    await seed.query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,'America/New_York','2026a','USD','cbd-231/0.1',$3,$4,$4,$5,$6)",
      [spaceId, `Step-up ${spaceId.slice(0, 8)}`, membershipId, scheduleId, periodId, subject]);
    await seed.query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membershipId, spaceId, profileId, subject]);
    await seed.query("INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p3',$6,'current',$4)",
      [randomUUID(), spaceId, membershipId, subject, DISCLOSURE_DIGEST, POLICY_DIGEST]);
    await seed.query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [scheduleId, spaceId, JSON.stringify({ cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } })]);
    await seed.query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,'active','2099-01-01','2099-01-31')", [periodId, spaceId, scheduleId]);
    await seed.query("COMMIT");
    return { spaceId, membershipId, profileId };
  } catch (error) { await seed.query("ROLLBACK"); throw error; } finally { seed.release(); await admin.end(); }
}

/** The whole step-up, over HTTP, as a browser walks it. Returns the callback's status. */
async function stepUp(h: Harness, port: number, csrfValue: string, action: string, budgetSpaceId: string): Promise<number> {
  const begin = await h.inject("POST", "/v1/identity/step-up/begin",
    { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrfValue, "content-type": "application/json" },
    { action, budgetSpaceId, postResultDestinationId: "home" });
  if (begin.statusCode !== 200) return begin.statusCode;
  const authorize = new URL(begin.json().navigateTo);
  const chooser = await h.inject("GET", `${authorize.pathname}${authorize.search}`, { host: `127.0.0.1:${port}` });
  const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)![1]!.replaceAll("&amp;", "&");
  const choice = await h.inject("GET", link, { host: `127.0.0.1:${port}` });
  const callback = new URL(choice.headers.location as string);
  const delivered = await h.inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
  assert.equal(delivered.statusCode, 303, delivered.body);
  assert.equal(delivered.headers["set-cookie"], undefined, "a step-up never delivers a session cookie");
  return delivered.statusCode;
}

function lookupFor(spaceId: string, membershipId: string, credential: string | undefined): FactLookup {
  return {
    operation: { action: ACTION, purpose: "user_delegated", mode: "user_delegated", fieldSet: "default", resourceType: "membership", resourceId: membershipId, actingSpaceId: spaceId, actingMembershipId: membershipId },
    credential,
  };
}

/**
 * A denial's external response is uniform by contract (CBD-236 section 5.2):
 * the reason class is restricted security evidence and reaches only the audit
 * stream. The test therefore reads the class the boundary actually recorded,
 * which is also the only place a reviewer could check it in production.
 */
async function decisionFor(h: Harness, lookup: FactLookup): Promise<{ allowed: boolean; reasonClass: string | undefined }> {
  try {
    const context = await h.boundary.authorize(lookup);
    return { allowed: true, reasonClass: context.decision.reasonClass };
  } catch {
    const last = h.audit.snapshot().at(-1) as { reasonClass?: string; reason_class?: string } | undefined;
    return { allowed: false, reasonClass: last?.reasonClass ?? last?.reason_class };
  }
}

describe("PK4-02/PK4-03 live: a protected cell allows only with a matching fresh grant, and the grant is write-once and consumed once", { skip: !configured }, () => {
  it("drives the whole path on real PostgreSQL", async (t) => {
    const h = await harness();
    const port = Number((h.inject as unknown as { port: number }).port);
    try {
      const me = await signIn(h, port);
      const space = await seedSpace(me.accountSubjectId);
      const otherSpace = await seedSpace(me.accountSubjectId);
      const lookup = lookupFor(space.spaceId, space.membershipId, h.cookie());

      await t.test("PK4-02: at session assurance the protected cell denies assurance_required", async () => {
        const decision = await decisionFor(h, lookup);
        assert.equal(decision.allowed, false);
        assert.equal(decision.reasonClass, "assurance_required");
      });

      await t.test("PK4-03: the step-up writes exactly one grant, bound to the requested action and space, and no session", async () => {
        const sessionsBefore = await h.client.platformSelect({ table: "account_session", conditions: [{ column: "session_ref", value: me.sessionRef }] });
        assert.equal(await stepUp(h, port, me.csrfValue, ACTION, space.spaceId), 303);
        const grants = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: me.sessionRef }] });
        assert.equal(grants.rows.length, 1, "one grant");
        const grant = grants.rows[0] as Record<string, unknown>;
        assert.equal(grant.bound_action, ACTION);
        assert.equal(grant.bound_space_id, space.spaceId);
        assert.equal(grant.state, "issued");
        assert.equal(grant.ceremony, "step_up");
        const sessionsAfter = await h.client.platformSelect({ table: "account_session", conditions: [{ column: "session_ref", value: me.sessionRef }] });
        assert.equal(sessionsAfter.rows.length, sessionsBefore.rows.length, "no session was minted or rotated");
        assert.equal((sessionsAfter.rows[0] as Record<string, unknown> | undefined)?.session_version, (sessionsBefore.rows[0] as Record<string, unknown> | undefined)?.session_version);
      });

      await t.test("PK4-02: a grant bound to another space leaves that other space at assurance_required", async () => {
        const decision = await decisionFor(h, lookupFor(otherSpace.spaceId, otherSpace.membershipId, h.cookie()));
        assert.equal(decision.allowed, false);
        assert.equal(decision.reasonClass, "assurance_required", "the grant for one space never travels to another");
      });

      await t.test("PK4-02: with the matching grant the protected cell allows, and the allow consumes it", async () => {
        const context = await h.boundary.authorize(lookup);
        assert.equal(context.decision.outcome, "allow");
        assert.ok(context.decision.obligations.some((obligation) => obligation.kind === "fresh_assurance"));
        assert.equal((context.input as PolicyInput).assurance?.level, "fresh");
        const executed = await h.boundary.execute(context, async (effect) => {
          assert.equal(effect.decision.outcome, "allow");
          return "committed";
        });
        assert.equal(executed, "committed");
        const grants = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: me.sessionRef }] });
        const grant = grants.rows[0] as Record<string, unknown>;
        assert.equal(grant.state, "consumed", "the allow spent the grant");
        assert.equal(grant.consumed_by_action, ACTION);
        assert.ok(grant.consumed_at);
      });

      await t.test("PK4-02: the spent grant authorizes nothing further -- the next attempt is assurance_required again", async () => {
        const decision = await decisionFor(h, lookup);
        assert.equal(decision.allowed, false);
        assert.equal(decision.reasonClass, "assurance_required");
        assert.equal(await findUsableFreshAssurance(h.client, { sessionRef: me.sessionRef, boundAction: ACTION, boundSpaceId: space.spaceId, now: new Date() }), undefined);
      });

      await t.test("PK4-03: consumed once -- a second consumption of the same grant writes nothing", async () => {
        const grants = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "session_ref", value: me.sessionRef }] });
        const id = String((grants.rows[0] as Record<string, unknown>).fresh_assurance_id);
        assert.equal(await consumeFreshAssurance(h.client, { freshAssuranceId: id, action: ACTION, now: new Date() }), false);
      });

      await t.test("PK4-03: write-once -- the database refuses to re-point, extend or un-consume a grant", async () => {
        const { createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
        const admin = createMigrationConnection();
        const seed = await admin.connect();
        try {
          const row = (await seed.query("SELECT * FROM account_session_fresh_assurance WHERE session_ref = $1", [me.sessionRef])).rows[0]!;
          const rewrites: readonly { readonly sql: string; readonly params: readonly unknown[]; readonly why: string }[] = [
            { sql: "UPDATE account_session_fresh_assurance SET bound_action = $2 WHERE fresh_assurance_id = $1", params: [row.fresh_assurance_id, "27.remove_coowner"], why: "re-point the action" },
            { sql: "UPDATE account_session_fresh_assurance SET bound_space_id = $2 WHERE fresh_assurance_id = $1", params: [row.fresh_assurance_id, randomUUID()], why: "re-point the space" },
            { sql: "UPDATE account_session_fresh_assurance SET expires_at = now() + interval '1 day' WHERE fresh_assurance_id = $1", params: [row.fresh_assurance_id], why: "extend the window" },
            { sql: "UPDATE account_session_fresh_assurance SET state = 'issued', consumed_at = NULL, consumed_by_action = NULL WHERE fresh_assurance_id = $1", params: [row.fresh_assurance_id], why: "un-consume" },
          ];
          for (const rewrite of rewrites) {
            await assert.rejects(seed.query(rewrite.sql, [...rewrite.params]), (error: unknown) => String((error as { message?: string }).message ?? "").length > 0, rewrite.why);
          }
          // Write-once also means one grant per ceremony: the unique challenge_id refuses a second.
          await assert.rejects(seed.query(
            "INSERT INTO account_session_fresh_assurance (session_ref, account_subject_id, environment_id, challenge_id, bound_action, bound_space_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '5 minutes')",
            [row.session_ref, row.account_subject_id, row.environment_id, row.challenge_id, ACTION, space.spaceId]));
        } finally { seed.release(); await admin.end(); }
      });

      await t.test("PK4-03: a second live grant for the same session, action and space is refused by the partial unique index", async () => {
        const { createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
        const admin = createMigrationConnection();
        const seed = await admin.connect();
        try {
          const insert = (challengeId: string) => seed.query(
            "INSERT INTO account_session_fresh_assurance (session_ref, account_subject_id, environment_id, challenge_id, bound_action, bound_space_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '5 minutes')",
            [me.sessionRef, me.accountSubjectId, ENVIRONMENT, challengeId, ACTION, space.spaceId]);
          await insert(randomUUID());
          await assert.rejects(insert(randomUUID()), "a second live grant for the same pair is refused");
        } finally { seed.release(); await admin.end(); }
      });

      await t.test("PK4-03: a step-up for an unprotected action or a space the caller is not a member of is refused before the provider", async () => {
        const unprotected = await h.inject("POST", "/v1/identity/step-up/begin",
          { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.csrfValue, "content-type": "application/json" },
          { action: "1.view_space", budgetSpaceId: space.spaceId, postResultDestinationId: "home" });
        assert.equal(unprotected.statusCode, 403, unprotected.body);
        const foreign = await h.inject("POST", "/v1/identity/step-up/begin",
          { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.csrfValue, "content-type": "application/json" },
          { action: ACTION, budgetSpaceId: randomUUID(), postResultDestinationId: "home" });
        assert.equal(foreign.statusCode, 403, foreign.body);
        const noCsrf = await h.inject("POST", "/v1/identity/step-up/begin",
          { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" },
          { action: ACTION, budgetSpaceId: space.spaceId, postResultDestinationId: "home" });
        assert.equal(noCsrf.statusCode, 403, noCsrf.body);
      });
      await t.test("SEC-PK4-F3: a revoked session's ref finds no grant, and the finder is what refuses it", async () => {
        // The partial-index case above left one live grant on this session for
        // this action and space, so there is something to lose. Signing out
        // revokes the session row and nothing sweeps the grants; the reader
        // itself requires the session live, which is what the migration header
        // and the module doc say and what SEC-PK4-F3 found was only true in
        // composition. This is the module boundary: a bare `sessionRef`, no
        // resolved session anywhere in the call.
        const before = await findUsableFreshAssurance(h.client, { sessionRef: me.sessionRef, boundAction: ACTION, boundSpaceId: space.spaceId, now: new Date() });
        assert.ok(before, "a live grant on a live session is usable");
        const signedOut = await h.inject("POST", "/v1/identity/logout", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": me.csrfValue });
        assert.equal(signedOut.statusCode, 200, signedOut.body);
        const session = await h.client.platformSelect({ table: "account_session", conditions: [{ column: "session_ref", value: me.sessionRef }] });
        assert.equal((session.rows[0] as Record<string, unknown>).state, "revoked");
        assert.equal(await findUsableFreshAssurance(h.client, { sessionRef: me.sessionRef, boundAction: ACTION, boundSpaceId: space.spaceId, now: new Date() }), undefined, "the grant died with its session");
        const grants = await h.client.platformSelect({ table: "account_session_fresh_assurance", conditions: [{ column: "fresh_assurance_id", value: before!.freshAssuranceId }] });
        assert.equal((grants.rows[0] as Record<string, unknown>).state, "issued", "nothing was swept or rewritten; the row is simply unreachable");
      });
    } finally {
      await h.close();
    }
  });
});
