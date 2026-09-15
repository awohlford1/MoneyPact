/**
 * PK4-01 (PROTO-INVITATIONS-PK4-STEPUP-001): what the real API fact source
 * emits for `idp_evidence`.
 *
 * CBD-236 section 8.2 makes a protected cell's allow depend on four leaves --
 * `assurance.level`, `boundAction`, `boundSpaceId`, `expiresAt` -- and
 * `decide` re-proves all four against the request's own action and acting
 * space. This suite drives `createApiFactSource` directly, with a real
 * `account_session_fresh_assurance` row behind it, and asserts the one rule
 * the criterion states: a completed step-up makes the fact source emit fresh
 * assurance for exactly that action and that space until expiry or
 * consumption, and every other case emits `session`.
 *
 * The negative cases are deliberately exhaustive about *which* fact is
 * emitted rather than about the eventual decision, because the difference
 * matters: this fact source never emits a `fresh` level that `decide` would
 * then reject. A grant for another action or space, an expired grant and a
 * spent grant are all simply absent, so the level is `session` and the deny
 * is `assurance_required`. `assurance_insufficient` exists in `decide` for
 * an input assembled by some other producer (a worker `delegation_store`,
 * or a future provider that asserts freshness itself); it is not reachable
 * from this adapter, which is a property worth pinning down rather than a
 * gap.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { DataAccessClient } from "@cobudget/data-access";
import { consumeFreshAssurance, issueFreshAssurance } from "@cobudget/sessions";
import type { MinimalFactSourceAdapter } from "@cobudget/sessions";
import { createApiFactSource } from "./fact-source.ts";
import type { FactLookup } from "../authorization/facts.js";
import { createFakeIdentityClient, FakeIdentityDatabase } from "../identity/test-support/fake-client.ts";

const ENVIRONMENT = "test";
const ACTION = "29.transfer_primary_ownership";

/** `session_store` is not under test here; the identity leaves are supplied by the lookup, exactly as the assembler supplies them. */
const noSessions: MinimalFactSourceAdapter = { read: async () => null };

function lookupFor(subjectId: string, sessionRef: string, action: string, actingSpaceId: string | undefined): FactLookup {
  return {
    operation: { action, purpose: "user_delegated", mode: "user_delegated", fieldSet: "default", ...(actingSpaceId ? { actingSpaceId } : {}) },
    credential: "unused",
    identity: { "subject.accountSubjectId": subjectId, "subject.sessionRef": sessionRef, "subject.sessionVersion": 1 },
  };
}

interface Fixture {
  readonly client: DataAccessClient;
  readonly db: FakeIdentityDatabase;
  readonly subjectId: string;
  readonly sessionRef: string;
  readonly spaceId: string;
  readonly now: Date;
  read(action: string, spaceId: string | undefined): Promise<Readonly<Record<string, unknown>> | null>;
}

function fixture(now = new Date("2026-09-15T12:00:00.000Z")): Fixture {
  const db = new FakeIdentityDatabase();
  const client = createFakeIdentityClient(db);
  const subjectId = randomUUID();
  const sessionRef = randomUUID();
  const spaceId = randomUUID();
  const source = createApiFactSource({ sessions: noSessions, client, now: () => now });
  // SEC-PK4-F3: the grant reader requires the session row live in its own
  // right, so the session this `sessionRef` names has to exist here even
  // though `session_store` itself is stubbed out above -- the identity leaves
  // still arrive through the lookup, exactly as the assembler supplies them.
  db.rows("account_session").push({
    session_ref: sessionRef, account_subject_id: subjectId, environment_id: ENVIRONMENT, state: "active",
    session_version: 1, idle_expires_at: new Date(now.getTime() + 900_000), absolute_expires_at: new Date(now.getTime() + 3_600_000),
  });
  return {
    client, db, subjectId, sessionRef, spaceId, now,
    read: (action, spaceIdForRequest) => source.read("idp_evidence", lookupFor(subjectId, sessionRef, action, spaceIdForRequest)),
  };
}

async function grantFor(f: Fixture, options: { readonly action?: string; readonly spaceId?: string; readonly issuedAt?: Date; readonly windowSeconds?: number } = {}) {
  const outcome = await issueFreshAssurance(f.client, {
    sessionRef: f.sessionRef, accountSubjectId: f.subjectId, environmentId: ENVIRONMENT, challengeId: randomUUID(),
    boundAction: options.action ?? ACTION, boundSpaceId: options.spaceId ?? f.spaceId,
    issuedAt: options.issuedAt ?? f.now, windowSeconds: options.windowSeconds ?? 300,
  });
  assert.equal(outcome.status, "issued");
  return outcome.grant!;
}

describe("PK4-01: the API fact source emits fresh assurance for exactly the bound action and space", () => {
  it("with no grant at all the level is session, and the three bound leaves are absent", async () => {
    const f = fixture();
    assert.deepEqual(await f.read(ACTION, f.spaceId), { "assurance.level": "session" });
  });

  it("a completed step-up makes exactly that action and space fresh, with the grant's own bound values and expiry", async () => {
    const f = fixture();
    const grant = await grantFor(f);
    assert.deepEqual(await f.read(ACTION, f.spaceId), {
      "assurance.level": "fresh",
      "assurance.boundAction": ACTION,
      "assurance.boundSpaceId": f.spaceId,
      "assurance.expiresAt": grant.expiresAt.toISOString(),
    });
    // The bound values are the row's, not the request's: a grant is never
    // re-pointed at whatever the caller happens to be asking for.
    assert.equal(grant.boundAction, ACTION);
    assert.equal(grant.boundSpaceId, f.spaceId);
    assert.equal(grant.expiresAt.getTime() - f.now.getTime(), 300_000);
  });

  it("another action in the same space is session, not a weaker fresh", async () => {
    const f = fixture();
    await grantFor(f);
    assert.deepEqual(await f.read("27.remove_coowner", f.spaceId), { "assurance.level": "session" });
  });

  it("the same action in another space is session", async () => {
    const f = fixture();
    await grantFor(f);
    assert.deepEqual(await f.read(ACTION, randomUUID()), { "assurance.level": "session" });
  });

  it("a request with no acting space at all is session and reads nothing", async () => {
    const f = fixture();
    await grantFor(f);
    assert.deepEqual(await f.read(ACTION, undefined), { "assurance.level": "session" });
  });

  it("a grant belonging to another session is session (the grant is keyed by session_ref, not by subject)", async () => {
    const f = fixture();
    await issueFreshAssurance(f.client, {
      sessionRef: randomUUID(), accountSubjectId: f.subjectId, environmentId: ENVIRONMENT, challengeId: randomUUID(),
      boundAction: ACTION, boundSpaceId: f.spaceId, issuedAt: f.now, windowSeconds: 300,
    });
    assert.deepEqual(await f.read(ACTION, f.spaceId), { "assurance.level": "session" });
  });

  it("an expired grant is session; expiry exactly on the boundary is already expired", async () => {
    const f = fixture();
    await grantFor(f, { issuedAt: new Date(f.now.getTime() - 301_000), windowSeconds: 300 });
    assert.deepEqual(await f.read(ACTION, f.spaceId), { "assurance.level": "session" });

    const boundary = fixture();
    await grantFor(boundary, { issuedAt: new Date(boundary.now.getTime() - 300_000), windowSeconds: 300 });
    assert.deepEqual(await boundary.read(ACTION, boundary.spaceId), { "assurance.level": "session" });
  });

  it("a consumed grant is session: fresh assurance lasts until expiry or consumption, whichever comes first", async () => {
    const f = fixture();
    const grant = await grantFor(f);
    assert.equal((await f.read(ACTION, f.spaceId))?.["assurance.level"], "fresh");
    assert.equal(await consumeFreshAssurance(f.client, { freshAssuranceId: grant.freshAssuranceId, action: ACTION, now: f.now }), true);
    assert.deepEqual(await f.read(ACTION, f.spaceId), { "assurance.level": "session" });
  });

  it("SEC-PK4-F3: a grant whose session has been revoked is session, without a sweep", async () => {
    const f = fixture();
    await grantFor(f);
    assert.equal((await f.read(ACTION, f.spaceId))?.["assurance.level"], "fresh");
    for (const row of (f.db.tables.get("account_session") ?? [])) if (row.session_ref === f.sessionRef) { row.state = "revoked"; }
    assert.deepEqual(await f.read(ACTION, f.spaceId), { "assurance.level": "session" }, "the grant died with its session");
  });

  it("reading the fact twice does not consume it: the commit-time recheck must see what the precheck saw", async () => {
    const f = fixture();
    await grantFor(f);
    const first = await f.read(ACTION, f.spaceId);
    const second = await f.read(ACTION, f.spaceId);
    assert.deepEqual(first, second);
    assert.equal(first?.["assurance.level"], "fresh");
  });
});
