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
  } finally {
    await Promise.all([admin.end(), api.end(), worker.end()]);
  }
});
