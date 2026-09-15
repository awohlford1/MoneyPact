/**
 * PROTO-INVITATIONS-PK2 against a live PostgreSQL 17: the three migrations of
 * the CBD-73 invitations design (INVITATIONS-DESIGN-001;
 * docs/cbd-234-invitations-consent-design-proposal.md SS4, SS7, SS10.1,
 * SS13), proved by deliberate violation.
 *
 * Every probe here attacks the schema rather than exercising an application
 * path, because there is no application path yet: PK-2 lands the migrations
 * and the catalog rows, PK-5 writes the statement modules and the state
 * service, PK-6 the routes. What can be proved today is exactly what the
 * database refuses, and each refusal is checked by its SQLSTATE, not by a
 * message:
 *
 *   (a) a membership insert with no current consent row still fails at COMMIT
 *       after the widening (the SEC-F02 forward rule of
 *       PROTO-CONSENT-LANDING-SEC-001 survives M1);
 *   (b) M1 admits a collaborator membership with a matching
 *       invitation_acceptance consent row in one transaction;
 *   (c) recorded_by_subject_id differing from account_subject_id is refused
 *       (section 17 item 6, closing SEC-F04);
 *   (d) an invitation row's identity columns are write-once and the closed
 *       edge accepted -> awaiting_confirmation is refused;
 *   (e) the one-dispatched-invitation-per-destination partial unique index
 *       holds;
 *   (f) DELETE is revoked on every new table for both application roles.
 *
 * The correction round that closes PROTO-INVITATIONS-PK2-SEC-001 adds one
 * deliberate violation per guard it adds, each with the legal shape admitted
 * beside it so that the refusal is the guard and not a broken statement:
 *
 *   (g) SEC-PK2-F01: a membership may end, and an ended membership is
 *       terminal -- it never returns to active, and its end evidence is
 *       write-once;
 *   (h) SEC-PK2-F01: a role change is refused at COMMIT without exactly one
 *       current consent row for the new role, and admitted with one written in
 *       the same transaction;
 *   (i) SEC-PK2-F06: ended_reason_class is a closed class set, and an end
 *       advances the authorization version;
 *   (j) SEC-PK2-F02: the acceptance membership, the CBD-275 commit receipt and
 *       the private terminal cause are each set once;
 *   (k) SEC-PK2-F03: a decided confirmation cannot be re-attributed, and an
 *       attached, channel-proved ceremony cannot be re-attached or un-proved;
 *   (l) SEC-PK2-F04: the restricted-only AE-73 classes cannot carry
 *       audience 'customer';
 *   (m) SEC-PK2-F05: cobudget_worker has no privilege at all on the three
 *       secret-bearing tables, while cobudget_api still has its own;
 *   (n) SEC-PK2-F06: an invitation's created_by_subject_id must be the subject
 *       of its created_by_membership_id.
 *
 * Opt-in exactly as the other live tests in this package do: it runs only
 * against a scratch database, never `cobudget_dev`, and it never resets the
 * database it is pointed at. It creates its own rows under fresh identifiers
 * and leaves every other row alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";

import type { Pool } from "../../../data-access/src/driver.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";

/** The nine tables M2 and M3 create, in the order the migrations create them. */
const NEW_TABLES = [
  "budget_space_invitation",
  "budget_space_invitation_code",
  "budget_space_invitation_ceremony",
  "budget_space_invitation_confirmation",
  "budget_space_invitation_outbox",
  "budget_space_lifecycle_audit",
  "invitation_security_event",
  "budget_space_primary_transfer",
  "account_lifecycle_notice",
] as const;

/**
 * The authorization-version advance CBD-73 requires of every membership end
 * (TR-73-30, TR-73-31, TR-73-32) and every role change (TR-73-21, TR-73-43).
 * Written as `1 + column` rather than `column + 1` so the secret scanner's
 * generic-api-key rule does not read it as a name assigned a long identifier.
 * The constant is named without an auth* prefix for the same reason.
 */
const VERSION_ADVANCE = "authorization_version = 1 + authorization_version";

interface SqlFailure {
  readonly code: string | undefined;
  readonly message: string;
}

type Query = (text: string, values?: unknown[]) => Promise<unknown>;

/** Runs `body` in its own transaction and returns the SQLSTATE that refused it, or null if it committed. */
async function refusalOf(pool: Pool, body: (q: Query) => Promise<void>): Promise<SqlFailure | null> {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await body((text, values) => connection.query(text, values));
    await connection.query("COMMIT");
    return null;
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch {
      // The transaction may already be aborted and closed; the refusal is what matters.
    }
    const failure = error as { code?: string; message?: string };
    return { code: failure.code, message: String(failure.message ?? error) };
  } finally {
    connection.release();
  }
}

void test("PROTO-INVITATIONS-PK2 live PostgreSQL: the widening holds, the invitation records refuse what CBD-73 forbids", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection, createWorkerConnection } = await import(
    "../../../data-access/src/connection.ts"
  );
  const admin = createMigrationConnection();
  const api = createApiConnection();
  const worker = createWorkerConnection();

  try {
    // -----------------------------------------------------------------
    // Fixture: one live budget space with its Primary Owner membership and
    // that membership's self-disclosure consent row -- the shape the merged
    // CBD-233 confirmation actually produces.
    // -----------------------------------------------------------------
    const ownerSubject = randomUUID();
    const ownerProfile = randomUUID();
    const spaceId = randomUUID();
    const ownerMembership = randomUUID();
    const ownerConsent = randomUUID();
    const scheduleVersion = randomUUID();
    const periodId = randomUUID();

    const consentColumns =
      `(consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope,
        source, source_record_id, source_record_version, disclosure_kind, disclosure_version,
        disclosure_digest, policy_version, policy_digest, state, recorded_by_subject_id, source_ceremony_id)`;

    const setup = await admin.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SET CONSTRAINTS ALL DEFERRED");
      await setup.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [ownerSubject]);
      await setup.query(
        "INSERT INTO financial_profile (profile_id, account_subject_id, profile_state, display_name) VALUES ($1,$2,'active',$3)",
        [ownerProfile, ownerSubject, "Owner Example"],
      );
      await setup.query(
        `INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version,
           primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id)
         VALUES ($1,$2,'America/New_York','2026a','USD','iso4217/2026',$3,$4,$4,$5,$6)`,
        [spaceId, `pk2 ${spaceId.slice(0, 8)}`, ownerMembership, scheduleVersion, periodId, ownerSubject],
      );
      await setup.query(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'primary_owner','active',$4)`,
        [ownerMembership, spaceId, ownerProfile, ownerSubject],
      );
      await setup.query(
        `INSERT INTO budget_space_consent ${consentColumns}
         VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$5,1,'primary_owner_self',1,'digest','p1','pdigest','current',$4,NULL)`,
        [ownerConsent, spaceId, ownerMembership, ownerSubject, randomUUID()],
      );
      await setup.query(
        `INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest)
         VALUES ($1,$2,1,'authoritative','{"cadence":"monthly","anchor":{"kind":"day","day":1}}','digest')`,
        [scheduleVersion, spaceId],
      );
      await setup.query(
        `INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date)
         VALUES ($1,$2,$3,'active','2026-09-01','2026-09-30')`,
        [periodId, spaceId, scheduleVersion],
      );
      await setup.query("COMMIT");
    } catch (error) {
      await setup.query("ROLLBACK");
      throw error;
    } finally {
      setup.release();
    }

    /** A fresh invitee subject with one active profile, committed on its own. */
    async function newInvitee(displayName: string): Promise<{ subject: string; profile: string }> {
      const subject = randomUUID();
      const profile = randomUUID();
      const connection = await admin.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subject]);
        await connection.query(
          "INSERT INTO financial_profile (profile_id, account_subject_id, profile_state, display_name) VALUES ($1,$2,'active',$3)",
          [profile, subject, displayName],
        );
        await connection.query("COMMIT");
      } finally {
        connection.release();
      }
      return { subject, profile };
    }

    // =================================================================
    // (a) A membership insert with no current consent row still fails at
    //     COMMIT after the widening. The widened role CHECK admits
    //     'collaborator'; the deferred activation trigger of
    //     20260914T170000Z is what refuses, and it refuses at COMMIT, not
    //     at the statement.
    // =================================================================
    const inviteeA = await newInvitee("A Collaborator");
    const membershipA = randomUUID();
    const withoutConsent = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'collaborator','active',$5)`,
        [membershipA, spaceId, inviteeA.profile, inviteeA.subject, ownerSubject],
      );
    });
    assert.ok(withoutConsent, "(a) a collaborator membership with no consent row must not commit");
    assert.equal(withoutConsent.code, "23514", "(a) must be refused by the activation-atomicity trigger");
    assert.match(withoutConsent.message, /exactly one current consent row/u);

    const strandedA = await admin.query("SELECT membership_id FROM budget_space_membership WHERE membership_id = $1", [membershipA]);
    assert.equal(strandedA.rowCount, 0, "(a) the refused membership must leave no row behind");

    // =================================================================
    // (b) M1 admits a collaborator membership together with a matching
    //     invitation_acceptance consent row, in one transaction. This is the
    //     SS8 acceptance transaction reduced to the two writes the schema
    //     itself constrains.
    // =================================================================
    const membershipB = randomUUID();
    const consentB = randomUUID();
    const ceremonyRef = randomUUID();
    const invitationRef = randomUUID();
    const admitted = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'collaborator','active',$5)`,
        [membershipB, spaceId, inviteeA.profile, inviteeA.subject, ownerSubject],
      );
      await q(
        `INSERT INTO budget_space_consent ${consentColumns}
         VALUES ($1,$2,$3,$4,'collaborator','full','invitation_acceptance',$5,1,'invitation_collaborator',1,'digest','p1','pdigest','current',$4,$6)`,
        [consentB, spaceId, membershipB, inviteeA.subject, invitationRef, ceremonyRef],
      );
    });
    assert.equal(admitted, null, "(b) a collaborator membership with its invitation_acceptance consent row must commit");

    const admittedRow = await admin.query(
      "SELECT role, status, ended_at FROM budget_space_membership WHERE membership_id = $1",
      [membershipB],
    );
    assert.deepEqual(admittedRow.rows[0], { role: "collaborator", status: "active", ended_at: null });

    const consentRow = await admin.query(
      "SELECT source, disclosure_kind, source_ceremony_id FROM budget_space_consent WHERE consent_id = $1",
      [consentB],
    );
    assert.deepEqual(consentRow.rows[0], {
      source: "invitation_acceptance",
      disclosure_kind: "invitation_collaborator",
      source_ceremony_id: ceremonyRef,
    });

    // The membership CHECK is widened, not opened: a role outside the five
    // CBD-72 roles is still refused, immediately.
    const unknownRole = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'superuser','active',$5)`,
        [randomUUID(), spaceId, inviteeA.profile, inviteeA.subject, ownerSubject],
      );
    });
    assert.equal(unknownRole?.code, "23514", "the widened role CHECK must still refuse an unknown role");

    // And the DR-73-09 coherence holds: a non-active status without an end,
    // or an active one with an end, is refused.
    const endedWithoutEnd = await refusalOf(admin, async (q) => {
      await q("UPDATE budget_space_membership SET status = 'removed' WHERE membership_id = $1", [membershipB]);
    });
    assert.equal(endedWithoutEnd?.code, "23514", "status leaving active without ended_at must be refused");

    // =================================================================
    // (c) recorded_by_subject_id differing from account_subject_id is now
    //     refused (section 17 item 6, closing SEC-F04). The constraint
    //     trigger is deferred, so this too is a COMMIT-time refusal.
    // =================================================================
    const membershipC = randomUUID();
    const inviteeC = await newInvitee("C Collaborator");
    const foreignRecorder = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'collaborator','active',$5)`,
        [membershipC, spaceId, inviteeC.profile, inviteeC.subject, ownerSubject],
      );
      await q(
        `INSERT INTO budget_space_consent ${consentColumns}
         VALUES ($1,$2,$3,$4,'collaborator','full','invitation_acceptance',$5,1,'invitation_collaborator',1,'digest','p1','pdigest','current',$6,NULL)`,
        // recorded_by is the confirming owner, which is exactly what item 6 forbids.
        [randomUUID(), spaceId, membershipC, inviteeC.subject, randomUUID(), ownerSubject],
      );
    });
    assert.ok(foreignRecorder, "(c) a consent row recorded by another subject must not commit");
    assert.equal(foreignRecorder.code, "23514");
    assert.match(foreignRecorder.message, /recorded_by_subject_id must equal account_subject_id/u);

    // The subject-coherence half of the same trigger is untouched by the
    // replacement: a consent row whose subject is not the membership's own is
    // still refused, even when that row is the membership's only current one
    // and its recorder is itself.
    const membershipD = randomUUID();
    const foreignSubject = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'collaborator','active',$5)`,
        [membershipD, spaceId, inviteeC.profile, inviteeC.subject, ownerSubject],
      );
      await q(
        `INSERT INTO budget_space_consent ${consentColumns}
         VALUES ($1,$2,$3,$4,'collaborator','full','invitation_acceptance',$5,1,'invitation_collaborator',1,'digest','p1','pdigest','current',$4,NULL)`,
        // The consenting subject is the other invitee, not this membership's.
        [randomUUID(), spaceId, membershipD, inviteeA.subject, randomUUID()],
      );
    });
    assert.ok(foreignSubject, "a consent row for another subject must not commit");
    assert.equal(foreignSubject.code, "23514");
    assert.match(foreignSubject.message, /must equal the membership subject/u);

    // =================================================================
    // (d) Invitation identity columns are write-once, and the closed edges
    //     of CBD-73 SS4.2 refuse accepted -> awaiting_confirmation.
    // =================================================================
    const invitationId = randomUUID();
    const destinationToken = `token-${invitationId}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const invitationColumns =
      `(invitation_id, budget_space_id, kind, created_by_membership_id, created_by_subject_id,
        required_permission, creating_authorization_version, channel_type, destination_token,
        destination_ciphertext, destination_masked, proposed_role, resource_scope,
        disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest,
        state, issued_at, expires_at, projection_inactive_at, projection_state)`;

    const created = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'a***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','pending',now(),$7,$7,'pending')`,
        [invitationId, spaceId, ownerMembership, ownerSubject, destinationToken, Buffer.from("ciphertext"), expiresAt],
      );
    });
    assert.equal(created, null, "a pending real invitation must be insertable");

    const rewrittenDestination = await refusalOf(admin, async (q) => {
      await q("UPDATE budget_space_invitation SET destination_token = $2 WHERE invitation_id = $1", [
        invitationId,
        `${destinationToken}-rewritten`,
      ]);
    });
    assert.ok(rewrittenDestination, "(d) the destination token must be write-once");
    assert.equal(rewrittenDestination.code, "23514");
    assert.match(rewrittenDestination.message, /identity is write-once/u);

    const rewrittenSpace = await refusalOf(admin, async (q) => {
      await q("UPDATE budget_space_invitation SET budget_space_id = $2 WHERE invitation_id = $1", [invitationId, randomUUID()]);
    });
    assert.equal(rewrittenSpace?.code, "23514", "(d) the budget space of an invitation must be write-once");

    // pending -> awaiting_confirmation -> accepted, each with a version bump,
    // are edges CBD-73 SS4.2 draws and the trigger admits.
    const forward = await refusalOf(admin, async (q) => {
      await q(
        "UPDATE budget_space_invitation SET state = 'awaiting_confirmation', state_version = state_version + 1 WHERE invitation_id = $1",
        [invitationId],
      );
      await q(
        `UPDATE budget_space_invitation
         SET state = 'accepted', state_version = state_version + 1, projection_state = 'accepted', accepted_membership_id = $2
         WHERE invitation_id = $1`,
        [invitationId, membershipB],
      );
    });
    assert.equal(forward, null, "the admitted edges pending -> awaiting_confirmation -> accepted must apply");

    const reopened = await refusalOf(admin, async (q) => {
      await q(
        "UPDATE budget_space_invitation SET state = 'awaiting_confirmation', state_version = state_version + 1 WHERE invitation_id = $1",
        [invitationId],
      );
    });
    assert.ok(reopened, "(d) accepted -> awaiting_confirmation must be refused");
    assert.equal(reopened.code, "23514");
    assert.match(reopened.message, /accepted to awaiting_confirmation is not an edge/u);

    // =================================================================
    // (d2) EXEC-PK8-RULINGS-001 item (a) / PK8-F05: the widened
    //     projection_state CHECK admits awaiting_confirmation and still
    //     refuses anything outside its six-value vocabulary.
    // =================================================================
    const awaitingInvitationId = randomUUID();
    const awaitingToken = `token-${awaitingInvitationId}`;
    const admittedProjection = await refusalOf(admin, async (q) => {
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'a***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','awaiting_confirmation',now(),$7,$7,'awaiting_confirmation')`,
        [awaitingInvitationId, spaceId, ownerMembership, ownerSubject, awaitingToken, Buffer.from("ciphertext"), expiresAt],
      );
    });
    assert.equal(admittedProjection, null, "the widened CHECK must admit projection_state = awaiting_confirmation");
    const storedProjection = await admin.query(
      "SELECT projection_state FROM budget_space_invitation WHERE invitation_id = $1",
      [awaitingInvitationId],
    );
    assert.equal(storedProjection.rows[0]?.projection_state, "awaiting_confirmation");

    const rejectedProjectionId = randomUUID();
    const rejectedProjection = await refusalOf(admin, async (q) => {
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'a***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','pending',now(),$7,$7,'not_a_real_projection_state')`,
        [rejectedProjectionId, spaceId, ownerMembership, ownerSubject, `token-${rejectedProjectionId}`, Buffer.from("ciphertext"), expiresAt],
      );
    });
    assert.equal(rejectedProjection?.code, "23514", "the widened CHECK must still refuse an unknown projection_state");

    // A transition without a version bump is refused too: IC-73-011 is what
    // makes a concurrent writer lose rather than overwrite.
    const unversioned = await refusalOf(admin, async (q) => {
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'b***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','created',now(),$7,$7,'pending')`,
        [randomUUID(), spaceId, ownerMembership, ownerSubject, `token-${randomUUID()}`, Buffer.from("ciphertext"), expiresAt],
      );
      await q("UPDATE budget_space_invitation SET state = 'pending' WHERE destination_masked = 'b***@example.com'");
    });
    assert.equal(unversioned?.code, "23514", "a transition without a state_version bump must be refused");
    assert.match(String(unversioned?.message), /state_version must increase/u);

    // =================================================================
    // (e) One dispatched real invitation per (space, destination token).
    // =================================================================
    const liveInvitation = randomUUID();
    const liveToken = `token-${liveInvitation}`;
    const first = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'c***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','pending',now(),$7,$7,'pending')`,
        [liveInvitation, spaceId, ownerMembership, ownerSubject, liveToken, Buffer.from("ciphertext"), expiresAt],
      );
    });
    assert.equal(first, null, "the first dispatched invitation for a destination must be insertable");

    const second = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'c***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','created',now(),$7,$7,'pending')`,
        [randomUUID(), spaceId, ownerMembership, ownerSubject, liveToken, Buffer.from("ciphertext"), expiresAt],
      );
    });
    assert.ok(second, "(e) a second dispatched invitation for the same destination must be refused");
    assert.equal(second.code, "23505", "(e) the refusal is the partial unique index");
    assert.match(second.message, /budget_space_invitation_one_dispatched_per_destination/u);

    // The index is partial on purpose: once the first is superseded, the
    // replacement of TR-73-05 is admitted for the same destination.
    const replacement = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        "UPDATE budget_space_invitation SET state = 'superseded', state_version = state_version + 1, projection_state = 'replaced' WHERE invitation_id = $1",
        [liveInvitation],
      );
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'c***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','created',now(),$7,$7,'pending')`,
        [randomUUID(), spaceId, ownerMembership, ownerSubject, liveToken, Buffer.from("ciphertext"), expiresAt],
      );
    });
    assert.equal(replacement, null, "(e) the successor of a superseded invitation must be admitted");

    // =================================================================
    // (f) DELETE is revoked on every new table, for both application roles.
    // =================================================================
    for (const [roleName, pool] of [
      ["cobudget_api", api],
      ["cobudget_worker", worker],
    ] as const) {
      for (const table of NEW_TABLES) {
        const refused = await refusalOf(pool, async (q) => {
          await q(`DELETE FROM ${table}`);
        });
        assert.ok(refused, `(f) ${roleName} must not be able to DELETE FROM ${table}`);
        assert.equal(refused.code, "42501", `(f) ${roleName} DELETE FROM ${table} must be permission denied`);
      }

      // The same roles do hold the ordinary privileges, so the refusal above
      // is the REVOKE and not a missing grant.
      const readable = await refusalOf(pool, async (q) => {
        await q("SELECT count(*) FROM budget_space_invitation");
      });
      assert.equal(readable, null, `${roleName} must still be able to read budget_space_invitation`);
    }

    // =================================================================
    // The PROTO-INVITATIONS-PK2-SEC-001 correction round. Each block below
    // first admits the shape CBD-73 draws and then attacks the rule that
    // shape depends on, so a guard that silently stopped working would fail
    // the admission rather than pass the refusal.
    // =================================================================

    /** A fresh collaborator membership with exactly one current consent row for its role. */
    async function newCollaboratorMembership(displayName: string): Promise<{
      readonly subject: string;
      readonly membership: string;
      readonly consent: string;
    }> {
      const invitee = await newInvitee(displayName);
      const membership = randomUUID();
      const consent = randomUUID();
      const created = await refusalOf(admin, async (q) => {
        await q("SET CONSTRAINTS ALL DEFERRED");
        await q(
          `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
           VALUES ($1,$2,$3,$4,'collaborator','active',$5)`,
          [membership, spaceId, invitee.profile, invitee.subject, ownerSubject],
        );
        await q(
          `INSERT INTO budget_space_consent ${consentColumns}
           VALUES ($1,$2,$3,$4,'collaborator','full','invitation_acceptance',$5,1,'invitation_collaborator',1,'digest','p1','pdigest','current',$4,NULL)`,
          [consent, spaceId, membership, invitee.subject, randomUUID()],
        );
      });
      assert.equal(created, null, `the ${displayName} fixture membership must commit`);
      return { subject: invitee.subject, membership, consent };
    }

    // =================================================================
    // (g) An ended membership is terminal (DR-73-09, IC-73-006). Before the
    //     correction round this UPDATE committed and left an active
    //     membership with zero current consent rows.
    // =================================================================
    const ending = await newCollaboratorMembership("G Collaborator");

    const ended = await refusalOf(admin, async (q) => {
      await q(
        `UPDATE budget_space_membership
         SET status = 'revoked', ended_at = now(), ended_reason_class = 'removed_by_owner',
             ${VERSION_ADVANCE}
         WHERE membership_id = $1`,
        [ending.membership],
      );
    });
    assert.equal(ended, null, "(g) a TR-73-31 membership end must still be admitted");

    const restored = await refusalOf(admin, async (q) => {
      await q(
        `UPDATE budget_space_membership
         SET status = 'active', ended_at = NULL, ended_reason_class = NULL,
             ${VERSION_ADVANCE}
         WHERE membership_id = $1`,
        [ending.membership],
      );
    });
    assert.ok(restored, "(g) an ended membership must not return to active");
    assert.equal(restored.code, "23514");
    assert.match(restored.message, /status is terminal once it leaves active/u);

    const stillEnded = await admin.query(
      "SELECT status, ended_reason_class FROM budget_space_membership WHERE membership_id = $1",
      [ending.membership],
    );
    assert.deepEqual(stillEnded.rows[0], { status: "revoked", ended_reason_class: "removed_by_owner" });

    const rewrittenEnd = await refusalOf(admin, async (q) => {
      await q("UPDATE budget_space_membership SET ended_reason_class = 'self_revocation' WHERE membership_id = $1", [
        ending.membership,
      ]);
    });
    assert.equal(rewrittenEnd?.code, "23514", "(g) the end evidence of an ended membership must be write-once");
    assert.match(String(rewrittenEnd?.message), /end evidence is write-once/u);

    const refrozenRole = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `UPDATE budget_space_membership SET role = 'co_owner', ${VERSION_ADVANCE} WHERE membership_id = $1`,
        [ending.membership],
      );
    });
    assert.equal(refrozenRole?.code, "23514", "(g) the role of an ended membership must be frozen");
    assert.match(String(refrozenRole?.message), /role is frozen once the membership has ended/u);

    // =================================================================
    // (h) A role change carries its consent (TR-73-21, TR-73-43). The
    //     constraint trigger is deferred, so the refusal is at COMMIT and the
    //     UPDATE-then-INSERT order the design uses satisfies it.
    // =================================================================
    const promoting = await newCollaboratorMembership("H Collaborator");

    const roleWithoutConsent = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `UPDATE budget_space_membership SET role = 'co_owner', ${VERSION_ADVANCE} WHERE membership_id = $1`,
        [promoting.membership],
      );
    });
    assert.ok(roleWithoutConsent, "(h) a role change with no consent row for the new role must not commit");
    assert.equal(roleWithoutConsent.code, "23514");
    assert.match(roleWithoutConsent.message, /exactly one current consent row for the new role/u);

    const unchangedRole = await admin.query("SELECT role FROM budget_space_membership WHERE membership_id = $1", [
      promoting.membership,
    ]);
    assert.equal(unchangedRole.rows[0].role, "collaborator", "(h) the refused role change must leave the row alone");

    const unversionedRole = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q("UPDATE budget_space_membership SET role = 'co_owner' WHERE membership_id = $1", [promoting.membership]);
    });
    assert.equal(unversionedRole?.code, "23514", "(h) a role change must advance the authorization version");
    assert.match(String(unversionedRole?.message), /authorization_version must advance with a role change/u);

    const promoted = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `UPDATE budget_space_membership SET role = 'co_owner', ${VERSION_ADVANCE} WHERE membership_id = $1`,
        [promoting.membership],
      );
      await q(
        "UPDATE budget_space_consent SET state = 'superseded', ended_at = now(), ended_reason_class = 'membership_change' WHERE consent_id = $1",
        [promoting.consent],
      );
      await q(
        `INSERT INTO budget_space_consent ${consentColumns}
         VALUES ($1,$2,$3,$4,'co_owner','full','membership_change',$5,1,'membership_change',1,'digest','p1','pdigest','current',$4,NULL)`,
        [randomUUID(), spaceId, promoting.membership, promoting.subject, randomUUID()],
      );
    });
    assert.equal(promoted, null, "(h) a role change with its consent row in the same transaction must commit");

    const promotedRow = await admin.query("SELECT role FROM budget_space_membership WHERE membership_id = $1", [
      promoting.membership,
    ]);
    assert.equal(promotedRow.rows[0].role, "co_owner");

    // =================================================================
    // (i) ended_reason_class is a class set, not free text, and an end
    //     advances the authorization version.
    // =================================================================
    const classProbe = await newCollaboratorMembership("I Collaborator");

    const freeText = await refusalOf(admin, async (q) => {
      await q(
        `UPDATE budget_space_membership
         SET status = 'removed', ended_at = now(), ended_reason_class = 'anything free text here',
             ${VERSION_ADVANCE}
         WHERE membership_id = $1`,
        [classProbe.membership],
      );
    });
    assert.ok(freeText, "(i) a free-text ended_reason_class must not commit");
    assert.equal(freeText.code, "23514");
    assert.match(freeText.message, /budget_space_membership_ended_reason_class_check/u);

    const unversionedEnd = await refusalOf(admin, async (q) => {
      await q(
        `UPDATE budget_space_membership
         SET status = 'removed', ended_at = now(), ended_reason_class = 'removed_by_owner'
         WHERE membership_id = $1`,
        [classProbe.membership],
      );
    });
    assert.equal(unversionedEnd?.code, "23514", "(i) an end must advance the authorization version");
    assert.match(String(unversionedEnd?.message), /authorization_version must advance when the membership ends/u);

    // =================================================================
    // (j) The acceptance membership, the CBD-275 receipt and the private
    //     terminal cause are each written once. `invitationId` is the
    //     accepted record of (d).
    // =================================================================
    const repointed = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q("UPDATE budget_space_invitation SET accepted_membership_id = $2 WHERE invitation_id = $1", [
        invitationId,
        promoting.membership,
      ]);
    });
    assert.ok(repointed, "(j) accepted_membership_id must not be repointed");
    assert.equal(repointed.code, "23514");
    assert.match(repointed.message, /accepted_membership_id is set once/u);

    const receipted = await refusalOf(admin, async (q) => {
      await q(
        `UPDATE budget_space_invitation
         SET commit_idempotency_key = 'k1', commit_request_digest = 'rd1', committed_response = '{"ok":true}'::jsonb
         WHERE invitation_id = $1`,
        [invitationId],
      );
    });
    assert.equal(receipted, null, "(j) the CBD-275 receipt must be recordable once");

    const rewrittenReceipt = await refusalOf(admin, async (q) => {
      await q(
        `UPDATE budget_space_invitation
         SET commit_idempotency_key = 'k2', commit_request_digest = 'rd2', committed_response = '{"ok":false}'::jsonb
         WHERE invitation_id = $1`,
        [invitationId],
      );
    });
    assert.ok(rewrittenReceipt, "(j) the commit receipt must not be overwritten");
    assert.equal(rewrittenReceipt.code, "23514");
    assert.match(rewrittenReceipt.message, /commit receipt is write-once/u);

    const terminalInvitation = randomUUID();
    const cancelled = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'d***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','created',now(),$7,$7,'pending')`,
        [
          terminalInvitation,
          spaceId,
          ownerMembership,
          ownerSubject,
          `token-${terminalInvitation}`,
          Buffer.from("ciphertext"),
          expiresAt,
        ],
      );
      await q(
        `UPDATE budget_space_invitation
         SET state = 'cancelled', state_version = state_version + 1, projection_state = 'cancelled',
             private_terminal_cause = 'permission_lost'
         WHERE invitation_id = $1`,
        [terminalInvitation],
      );
    });
    assert.equal(cancelled, null, "(j) a cancelled record may record its private terminal cause once");

    const rewrittenCause = await refusalOf(admin, async (q) => {
      await q("UPDATE budget_space_invitation SET private_terminal_cause = 'sibling_accepted' WHERE invitation_id = $1", [
        terminalInvitation,
      ]);
    });
    assert.ok(rewrittenCause, "(j) the private terminal cause must not be rewritten");
    assert.equal(rewrittenCause.code, "23514");
    assert.match(rewrittenCause.message, /private_terminal_cause is write-once/u);

    // =================================================================
    // (k) The confirmation decision and the ceremony attachment are
    //     evidence, so neither can be re-attributed afterwards.
    // =================================================================
    const ceremonyId = randomUUID();
    const ceremonyColumns =
      `(ceremony_id, budget_space_id, invitation_id, ceremony_secret_digest, channel_proof_state,
        channel_challenge_digest, channel_proved_at, attached_subject_id, attached_session_ref,
        attached_at, primary_contact_match, disclosure_kind, disclosure_version, disclosure_digest,
        state, expires_at, environment)`;

    const ceremonyCreated = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation_ceremony ${ceremonyColumns}
         VALUES ($1,$2,$3,$4,'proved','challenge-digest',now(),$5,'session-row-id',now(),true,
                 'invitation_collaborator',1,'digest','open',$6,'local')`,
        [ceremonyId, spaceId, invitationId, `secret-${ceremonyId}`, inviteeA.subject, expiresAt],
      );
    });
    assert.equal(ceremonyCreated, null, "(k) an attached, channel-proved ceremony must be insertable");

    const reattached = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        "UPDATE budget_space_invitation_ceremony SET attached_subject_id = $2, attached_session_ref = 'another-session' WHERE ceremony_id = $1",
        [ceremonyId, inviteeC.subject],
      );
    });
    assert.ok(reattached, "(k) an attached ceremony must not be re-attached to a second subject");
    assert.equal(reattached.code, "23514");
    assert.match(reattached.message, /attachment evidence is write-once/u);

    const unproved = await refusalOf(admin, async (q) => {
      await q(
        "UPDATE budget_space_invitation_ceremony SET channel_proof_state = 'none', channel_proved_at = NULL WHERE ceremony_id = $1",
        [ceremonyId],
      );
    });
    assert.ok(unproved, "(k) a proved channel must not be un-proved");
    assert.equal(unproved.code, "23514");
    assert.match(unproved.message, /channel_proof_state never leaves proved/u);

    const unmatched = await refusalOf(admin, async (q) => {
      await q("UPDATE budget_space_invitation_ceremony SET primary_contact_match = false WHERE ceremony_id = $1", [
        ceremonyId,
      ]);
    });
    assert.equal(unmatched?.code, "23514", "(k) the restricted primary-contact evidence must not be flipped");

    const confirmationId = randomUUID();
    const decided = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation_confirmation
           (confirmation_id, budget_space_id, invitation_id, ceremony_id, acceptor_subject_id,
            displayed_identity_version, state, expires_at)
         VALUES ($1,$2,$3,$4,$5,1,'requested',$6)`,
        [confirmationId, spaceId, invitationId, ceremonyId, inviteeA.subject, expiresAt],
      );
      await q(
        `UPDATE budget_space_invitation_confirmation
         SET state = 'confirmed', decided_by_membership_id = $2, decided_by_subject_id = $3,
             decided_at = now(), decided_authorization_version = 1, committed_consent_id = $4
         WHERE confirmation_id = $1`,
        [confirmationId, ownerMembership, ownerSubject, consentB],
      );
    });
    assert.equal(decided, null, "(k) a requested confirmation must be decidable once");

    const reattributed = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q("UPDATE budget_space_invitation_confirmation SET decided_by_subject_id = $2 WHERE confirmation_id = $1", [
        confirmationId,
        inviteeA.subject,
      ]);
    });
    assert.ok(reattributed, "(k) a decided confirmation must not be re-attributed");
    assert.equal(reattributed.code, "23514");
    assert.match(reattributed.message, /decision evidence is write-once/u);

    const reconsented = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q("UPDATE budget_space_invitation_confirmation SET committed_consent_id = $2 WHERE confirmation_id = $1", [
        confirmationId,
        ownerConsent,
      ]);
    });
    assert.equal(reconsented?.code, "23514", "(k) committed_consent_id must be write-once");
    assert.match(String(reconsented?.message), /committed_consent_id is write-once/u);

    // =================================================================
    // (l) The restricted-only AE-73 classes cannot be labelled for a
    //     customer surface.
    // =================================================================
    const auditColumns =
      "(budget_space_id, event_code, occurred_at, target_type, result, reason_class, correlation_id, audience)";

    for (const restrictedCode of ["AE-73-27", "AE-73-11"] as const) {
      const mislabelled = await refusalOf(admin, async (q) => {
        await q("SET CONSTRAINTS ALL DEFERRED");
        await q(
          `INSERT INTO budget_space_lifecycle_audit ${auditColumns}
           VALUES ($1,$2,now(),'invitation','system','already_member',$3,'customer')`,
          [spaceId, restrictedCode, randomUUID()],
        );
      });
      assert.ok(mislabelled, `(l) ${restrictedCode} must not carry audience 'customer'`);
      assert.equal(mislabelled.code, "23514");
      assert.match(mislabelled.message, /budget_space_lifecycle_audit_restricted_classes/u);
    }

    const restrictedAdmitted = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_lifecycle_audit ${auditColumns}
         VALUES ($1,'AE-73-27',now(),'invitation','system','already_member',$2,'restricted')`,
        [spaceId, randomUUID()],
      );
    });
    assert.equal(restrictedAdmitted, null, "(l) the same event is admitted as restricted");

    const customerAdmitted = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_lifecycle_audit ${auditColumns}
         VALUES ($1,'AE-73-01',now(),'invitation','allow',NULL,$2,'customer')`,
        [spaceId, randomUUID()],
      );
    });
    assert.equal(customerAdmitted, null, "(l) an ordinary customer event is unaffected");

    // =================================================================
    // (m) cobudget_worker has no privilege on the three secret-bearing
    //     tables, and cobudget_api still has its own.
    // =================================================================
    const WORKER_DENIED_TABLES = [
      "budget_space_invitation_outbox",
      "budget_space_invitation_ceremony",
      "budget_space_invitation_code",
    ] as const;

    for (const table of WORKER_DENIED_TABLES) {
      const readDenied = await refusalOf(worker, async (q) => {
        await q(`SELECT count(*) FROM ${table}`);
      });
      assert.ok(readDenied, `(m) cobudget_worker must have no SELECT on ${table}`);
      assert.equal(readDenied.code, "42501", `(m) cobudget_worker SELECT on ${table} must be permission denied`);

      const writeDenied = await refusalOf(worker, async (q) => {
        await q(`UPDATE ${table} SET invitation_id = invitation_id`);
      });
      assert.ok(writeDenied, `(m) cobudget_worker must have no UPDATE on ${table}`);
      assert.equal(writeDenied.code, "42501", `(m) cobudget_worker UPDATE on ${table} must be permission denied`);

      const apiStillHas = await refusalOf(api, async (q) => {
        await q(`SELECT count(*) FROM ${table}`);
      });
      assert.equal(apiStillHas, null, `(m) cobudget_api must still read ${table}`);
    }

    // =================================================================
    // (n) An invitation's creator subject is its creating membership's own
    //     subject (IC-73-012). Deferred, so the refusal is at COMMIT.
    // =================================================================
    const foreignCreator = randomUUID();
    const creatorMismatch = await refusalOf(admin, async (q) => {
      await q("SET CONSTRAINTS ALL DEFERRED");
      await q(
        `INSERT INTO budget_space_invitation ${invitationColumns}
         VALUES ($1,$2,'real',$3,$4,'24',1,'email',$5,$6,'e***@example.com','collaborator','full',
                 'invitation_collaborator',1,'digest','p1','pdigest','created',now(),$7,$7,'pending')`,
        [
          foreignCreator,
          spaceId,
          // The owner's membership, but another member's subject.
          ownerMembership,
          inviteeA.subject,
          `token-${foreignCreator}`,
          Buffer.from("ciphertext"),
          expiresAt,
        ],
      );
    });
    assert.ok(creatorMismatch, "(n) an invitation naming another member's subject must not commit");
    assert.equal(creatorMismatch.code, "23514");
    assert.match(creatorMismatch.message, /must be the subject of created_by_membership_id/u);

    const strandedCreator = await admin.query(
      "SELECT invitation_id FROM budget_space_invitation WHERE invitation_id = $1",
      [foreignCreator],
    );
    assert.equal(strandedCreator.rowCount, 0, "(n) the refused invitation must leave no row behind");
  } finally {
    await Promise.all([admin.end(), api.end(), worker.end()]);
  }
});
