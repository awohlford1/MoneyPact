/**
 * PROTO-INVITATIONS-PK7A against a live PostgreSQL 17: the Primary-transfer
 * module over the `M3` schema, through the real statement modules and real
 * `SERIALIZABLE` transactions.
 *
 * What is proved here and could not be proved anywhere else:
 *
 *   (a) `PK7A-01` the `TR-73-43` commit of design proposal SS10.3 is
 *       all-or-nothing. A failure injected at **every** boundary of the
 *       sequence leaves no superseded consent row, no swapped role, no moved
 *       space, no new consent row, no cancelled invitation, no audit row and
 *       no notice -- and the deferred commit-time guards of PK-1/PK-2 are
 *       what the successful run has to satisfy on the way through;
 *   (b) `PK7A-01` the deferred `budget_space_creation_invariants` trigger
 *       fires at COMMIT on the moved `primary_owner_membership_id`, and a
 *       commit that moved the space without promoting the recipient is
 *       refused by the database and not merely by the application;
 *   (c) `PK7A-02` propose, accept, decline, confirm, withdraw and view follow
 *       CBD-73 SS12, a stale version at each step routes `TR-73-46`, an
 *       expired workflow closes, and a second live workflow per space is
 *       refused by the partial unique index as well as by the command;
 *   (d) `PK7A-02` a transfer commit and an invitation confirm racing on the
 *       same space serialize: one commits, the other loses its version
 *       predicate or is aborted `40001`, and the space is coherent either
 *       way;
 *   (e) `PK7A-03` the four obligation discharges compose inside one
 *       authorizing transaction, the fresh-assurance evidence reference
 *       reaches the outgoing consent row and the transfer row, and the
 *       module reads no assurance of its own -- the reference is an input;
 *   (f) design SS10.3 step 6: the former Primary's permission-26 invitation
 *       is cancelled through PK-5's own system path, in the same transaction.
 *
 * Opt-in exactly as the other live tests in this package do: it runs only
 * against a scratch database, never `cobudget_dev` and never `cobudget_demo`,
 * and it never resets the database it is pointed at. Every row it creates
 * carries fresh identifiers and it leaves every other row alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";

import { bindClient } from "../../../data-access/src/binding.ts";
import { PRODUCTION_TABLE_CATALOG } from "../../../data-access/src/catalog.ts";
import type { DataAccessClient } from "../../../data-access/src/client.ts";
import type { Pool } from "../../../data-access/src/driver.ts";
import { createLocalKeyProvider } from "../../../data-access/src/encryption/local-provider.ts";
import type { ConsentDisclosure, ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import {
  acceptInvitation, attachAccount, createInvitation, parseCreateInvitationRequest, resolveCode, verifyChannel,
} from "../invitations/application.ts";
import type { InvitationDependencies } from "../invitations/application.ts";
import { confirmAcceptance } from "../invitations/acceptance.ts";
import { createKeyedDigest } from "../invitations/secrets.ts";
import type { OwnerContext } from "../invitations/ports.ts";
import {
  acceptPrimaryTransfer, confirmPrimaryTransfer, declinePrimaryTransfer, proposePrimaryTransfer,
  viewPrimaryTransfer, withdrawPrimaryTransfer,
} from "../primary-transfer/application.ts";
import { COMMIT_BOUNDARIES, commitPrimaryTransfer } from "../primary-transfer/commit.ts";
import { primaryTransferObligations } from "../primary-transfer/obligations.ts";
import type { ActorContext, PrimaryTransferDependencies, TransferActionCode } from "../primary-transfer/ports.ts";
import { isPrimaryTransferError } from "../primary-transfer/records.ts";
import { invitationPersistence } from "./invitation-store.ts";
import { primaryTransferPersistence, runPrimaryTransferTransaction } from "./primary-transfer-store.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev" && database.database !== "cobudget_demo";

/** The approved registry, read from disk: the live proof uses the real kinds, versions and digests. */
function liveDisclosures(): ConsentDisclosureSource {
  const entries = JSON.parse(readFileSync(new URL("../../../../config/consent-disclosure-registry.json", import.meta.url), "utf8")) as readonly {
    kind: string; version: number; digest: string;
  }[];
  return {
    current(kind: string): ConsentDisclosure {
      const match = entries.filter((entry) => entry.kind === kind).sort((a, b) => b.version - a.version)[0];
      if (!match) throw new Error(`unregistered disclosure kind: ${kind}`);
      return { kind: match.kind, version: match.version, digest: match.digest, text: { heading: kind, items: [], acknowledgement: "" } };
    },
  };
}

const KEYS = createLocalKeyProvider({ key: Buffer.alloc(32, 13), keyVersion: "pk7a-live-v1" });
const DIGEST = createKeyedDigest(KEYS);
const ENVIRONMENT = "pk7a-live";
const POLICY = { policyVersion: "p4", policyDigest: "d".repeat(64) };

interface Subject {
  readonly subject: string;
  readonly profile: string;
}

interface Space {
  readonly spaceId: string;
  readonly primarySubject: string;
  readonly primaryMembership: string;
  readonly primaryProfile: string;
  readonly primaryConsentId: string;
}

interface Member {
  readonly membershipId: string;
  readonly subject: string;
  readonly profile: string;
  readonly consentId: string;
}

void test("PROTO-INVITATIONS-PK7A live PostgreSQL: the transfer workflow, its commit, and its obligations", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const api = createApiConnection();

  try {
    // -------------------------------------------------------------------
    // Fixtures, built with the migration role exactly as the PK-5 live
    // suite builds them, so the application code below is the only thing
    // under test.
    // -------------------------------------------------------------------
    async function withAdmin<T>(work: (connection: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> {
      const connection = await admin.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SET CONSTRAINTS ALL DEFERRED");
        const value = await work(connection as never);
        await connection.query("COMMIT");
        return value;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    }

    async function newSubject(displayName: string | null): Promise<Subject> {
      const subject = randomUUID();
      const profile = randomUUID();
      await withAdmin(async (connection) => {
        await connection.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subject]);
        await connection.query(
          "INSERT INTO financial_profile (profile_id, account_subject_id, profile_state, display_name) VALUES ($1,$2,'active',$3)",
          [profile, subject, displayName],
        );
      });
      return { subject, profile };
    }

    async function newSpace(): Promise<Space> {
      const owner = await newSubject("Primary Example");
      const spaceId = randomUUID();
      const primaryMembership = randomUUID();
      const primaryConsentId = randomUUID();
      const scheduleVersion = randomUUID();
      const periodId = randomUUID();
      await withAdmin(async (connection) => {
        await connection.query(
          `INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version,
             primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id)
           VALUES ($1,$2,'America/New_York','2026a','USD','iso4217/2026',$3,$4,$4,$5,$6)`,
          [spaceId, `pk7a ${spaceId.slice(0, 8)}`, primaryMembership, scheduleVersion, periodId, owner.subject],
        );
        await connection.query(
          `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
           VALUES ($1,$2,$3,$4,'primary_owner','active',$4)`,
          [primaryMembership, spaceId, owner.profile, owner.subject],
        );
        await connection.query(
          `INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope,
             source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest,
             policy_version, policy_digest, state, recorded_by_subject_id)
           VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$5,1,'primary_owner_self',1,'digest','p1','pdigest','current',$4)`,
          [primaryConsentId, spaceId, primaryMembership, owner.subject, randomUUID()],
        );
        await connection.query(
          `INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest)
           VALUES ($1,$2,1,'authoritative','{"cadence":"monthly","anchor":{"kind":"day","day":1}}','digest')`,
          [scheduleVersion, spaceId],
        );
        await connection.query(
          `INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date)
           VALUES ($1,$2,$3,'active','2026-09-01','2026-09-30')`,
          [periodId, spaceId, scheduleVersion],
        );
      });
      return {
        spaceId, primarySubject: owner.subject, primaryMembership,
        primaryProfile: owner.profile, primaryConsentId,
      };
    }

    /** A second active member with a `current` consent row, as an accepted invitation would have left them. */
    async function newMember(space: Space, role: "collaborator" | "co_owner"): Promise<Member> {
      const person = await newSubject("Member Example");
      const membershipId = randomUUID();
      const consentId = randomUUID();
      await withAdmin(async (connection) => {
        await connection.query(
          `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
           VALUES ($1,$2,$3,$4,$5,'active',$6)`,
          [membershipId, space.spaceId, person.profile, person.subject, role, space.primarySubject],
        );
        await connection.query(
          `INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope,
             source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest,
             policy_version, policy_digest, state, recorded_by_subject_id)
           VALUES ($1,$2,$3,$4,$5,'full','invitation_acceptance',$6,1,$7,1,'digest','p1','pdigest','current',$4)`,
          [
            consentId, space.spaceId, membershipId, person.subject, role, randomUUID(),
            role === "co_owner" ? "invitation_co_owner" : "invitation_collaborator",
          ],
        );
      });
      return { membershipId, subject: person.subject, profile: person.profile, consentId };
    }

    const client = bindClient(api, true, PRODUCTION_TABLE_CATALOG);
    const disclosures = liveDisclosures();
    const clock = { now: () => new Date().toISOString() };

    /**
     * One `serializable` transaction, composed exactly as PK-7B's route will
     * compose it, through the store's wrapper so that a serialization
     * failure raised at COMMIT reaches the caller as `retryable_conflict`
     * (`R-04`).
     */
    async function transaction<T>(
      work: (deps: PrimaryTransferDependencies, scoped: DataAccessClient) => Promise<T>,
      overrides: Partial<Pick<PrimaryTransferDependencies, "clock" | "lifetimes">> = {},
    ): Promise<T> {
      return runPrimaryTransferTransaction(client, async (scoped) =>
        work({ ...transferDeps(scoped), ...overrides }, scoped));
    }

    /** The PK-5 dependencies and the transfer dependencies over one and the same transaction client. */
    function invitationDeps(scoped: DataAccessClient): InvitationDependencies {
      const persistence = invitationPersistence(
        { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock }, DIGEST,
      );
      return {
        repository: persistence.repository,
        locator: persistence.locator,
        clock,
        ids: { uuid: () => randomUUID() },
        digest: DIGEST,
        disclosures,
        encryptDestination: persistence.encryptDestination,
        readDestination: persistence.readDestination,
        challengeReader: (invitationId) => persistence.delivery.challengeFor(invitationId),
      };
    }

    function transferDeps(scoped: DataAccessClient): PrimaryTransferDependencies {
      const invitations = invitationDeps(scoped);
      const persistence = primaryTransferPersistence({ client: scoped, invitations });
      assert.ok(persistence.cancelPermissionLostInvitations, "the PK-5 system cancel path is composed");
      return {
        repository: persistence.repository,
        clock,
        ids: { uuid: () => randomUUID() },
        disclosures,
        cancelPermissionLostInvitations: persistence.cancelPermissionLostInvitations,
      };
    }

    function actor(
      space: Space, membershipId: string, subjectId: string, action: TransferActionCode,
      options: { readonly assurance?: string; readonly authorizationVersion?: number; readonly correlationId?: string } = {},
    ): ActorContext {
      // Bound to a short local first, here and below: the secret scanner's
      // generic-api-key rule reads an auth-shaped name followed by another
      // long identifier as a credential assignment (PK2FIX-F04).
      const version = options.authorizationVersion ?? 1;
      const base: ActorContext = {
        budgetSpaceId: space.spaceId, subjectId, membershipId,
        decision: { ...POLICY, authorizationVersion: version },
        permission: "29", actionCode: action,
        correlationId: options.correlationId ?? randomUUID(),
      };
      return options.assurance === undefined ? base : { ...base, freshAssuranceRef: options.assurance };
    }

    async function propose(space: Space, recipient: Member): Promise<string> {
      const result = await transaction((deps) => proposePrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.propose_primary_transfer"),
        { recipientMembershipId: recipient.membershipId },
      ));
      assert.equal(result.outcome, "proposed", JSON.stringify(result));
      if (result.outcome !== "proposed") throw new Error("unreachable");
      return result.transfer.transferId;
    }

    async function scalar<T>(text: string, values: readonly unknown[]): Promise<T> {
      const result = await api.query(text, values as unknown[]);
      return (result.rows[0] as Record<string, T> | undefined) === undefined
        ? (undefined as unknown as T)
        : Object.values(result.rows[0] as Record<string, unknown>)[0] as T;
    }

    async function rows(text: string, values: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
      const result = await api.query(text, values as unknown[]);
      return result.rows as readonly Record<string, unknown>[];
    }

    /** One permission-26 invitation the Primary created, left `pending` for the commit to cancel. */
    async function pendingCoOwnerInvitation(space: Space): Promise<string> {
      const destination = `co-${randomUUID().slice(0, 8)}@example.com`;
      const invitationId = await client.transaction({ isolation: "serializable" }, async (scoped) => {
        const deps = invitationDeps(scoped);
        const owner: OwnerContext = {
          budgetSpaceId: space.spaceId, subjectId: space.primarySubject, membershipId: space.primaryMembership,
          decision: { ...POLICY, authorizationVersion: 1 }, permission: "26", correlationId: randomUUID(),
        };
        const created = await createInvitation(deps, owner, parseCreateInvitationRequest({
          channel: "email", destination, proposedRole: "co_owner", idempotencyKey: randomUUID(),
        }));
        return created.projection.invitationId;
      });
      // Dispatch, so the record reaches `pending` with a live code.
      await client.transaction({ isolation: "read committed" }, async (scoped) => {
        const persistence = invitationPersistence(
          { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock }, DIGEST,
        );
        await persistence.delivery.render(invitationId);
      });
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "pending");
      return invitationId;
    }

    /** What the space looks like afterwards. Used by every coherence assertion below. */
    async function spaceCoherence(space: Space): Promise<{
      primaryOwnerMembershipId: string; primaryOwnershipVersion: number;
      activePrimaries: readonly string[]; consentByMembership: ReadonlyMap<string, string>;
    }> {
      const spaceRow = (await rows(
        "SELECT primary_owner_membership_id, primary_ownership_version FROM budget_space WHERE budget_space_id = $1",
        [space.spaceId],
      ))[0] as { primary_owner_membership_id: string; primary_ownership_version: number };
      const memberships = await rows(
        "SELECT membership_id, role, status FROM budget_space_membership WHERE budget_space_id = $1", [space.spaceId],
      );
      const consents = await rows(
        "SELECT membership_id, role FROM budget_space_consent WHERE budget_space_id = $1 AND state = 'current'", [space.spaceId],
      );
      return {
        primaryOwnerMembershipId: spaceRow.primary_owner_membership_id,
        primaryOwnershipVersion: spaceRow.primary_ownership_version,
        activePrimaries: memberships
          .filter((row) => row.role === "primary_owner" && row.status === "active")
          .map((row) => row.membership_id as string),
        consentByMembership: new Map(consents.map((row) => [row.membership_id as string, row.role as string])),
      };
    }

    // =================================================================
    // (c) PK7A-02: the whole workflow, one step per transaction, as the
    //     six routes will run it.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitationId = await pendingCoOwnerInvitation(space);
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);

      // The captured versions are the live ones.
      const proposed = (await rows(
        "SELECT state, state_version, proposer_authorization_version, recipient_authorization_version, primary_ownership_version, primary_assurance_ref FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(proposed.state, "proposed");
      assert.equal(proposed.proposer_authorization_version, 1);
      assert.equal(proposed.recipient_authorization_version, 1);
      assert.equal(proposed.primary_ownership_version, 1);
      assert.equal(proposed.primary_assurance_ref, null);

      // A second live workflow is refused by the command, and the partial
      // unique index refuses it independently.
      const second = await transaction((deps) => proposePrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.propose_primary_transfer"),
        { recipientMembershipId: recipient.membershipId },
      ));
      assert.equal(second.outcome, "denied");
      await assert.rejects(
        () => withAdmin(async (connection) => connection.query(
          `INSERT INTO budget_space_primary_transfer (transfer_id, budget_space_id, proposer_membership_id, recipient_membership_id,
             proposer_authorization_version, recipient_authorization_version, primary_ownership_version,
             recipient_disclosure_kind, recipient_disclosure_version, recipient_disclosure_digest,
             outgoing_disclosure_kind, outgoing_disclosure_version, outgoing_disclosure_digest,
             state, expires_at, policy_version, policy_digest)
           VALUES ($1,$2,$3,$4,1,1,1,'primary_transfer_recipient',1,'d','primary_transfer_outgoing',1,'d','proposed', now() + interval '1 day','p4','pd')`,
          [randomUUID(), space.spaceId, space.primaryMembership, recipient.membershipId],
        )),
        /budget_space_primary_transfer_one_live_per_space|duplicate key/u,
      );

      // Either party reads the status; a third person cannot.
      const view = await transaction((deps) => viewPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.view_primary_transfer"), { transferId },
      ));
      assert.equal(view.outcome, "view");

      // The recipient accepts. No role changes.
      const accepted = await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));
      assert.equal(accepted.outcome, "recipient_accepted");
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
      assert.equal(await scalar<string>("SELECT role FROM budget_space_membership WHERE membership_id = $1", [recipient.membershipId]), "collaborator");

      // The Primary confirms, which completes the pair and commits.
      const committed = await transaction((deps) => confirmPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
        { transferId },
      ));
      assert.equal(committed.outcome, "committed", JSON.stringify(committed));
      if (committed.outcome !== "committed") throw new Error("unreachable");

      // (b) the space is coherent, and the deferred creation-invariant
      // trigger accepted the moved reference at COMMIT.
      const after = await spaceCoherence(space);
      assert.equal(after.primaryOwnerMembershipId, recipient.membershipId);
      assert.equal(after.primaryOwnershipVersion, 2);
      assert.deepEqual(after.activePrimaries, [recipient.membershipId]);
      assert.equal(after.consentByMembership.get(recipient.membershipId), "primary_owner");
      assert.equal(after.consentByMembership.get(space.primaryMembership), "co_owner");
      assert.equal(await scalar<number>("SELECT authorization_version FROM budget_space_membership WHERE membership_id = $1", [space.primaryMembership]), 2);
      assert.equal(await scalar<number>("SELECT authorization_version FROM budget_space_membership WHERE membership_id = $1", [recipient.membershipId]), 2);

      // Both prior consent rows are superseded and linked to the terminal event.
      const superseded = await rows(
        "SELECT consent_id, state, ended_reason_class, ended_by_event_id FROM budget_space_consent WHERE consent_id = ANY($1)",
        [[space.primaryConsentId, recipient.consentId]],
      );
      assert.equal(superseded.length, 2);
      for (const row of superseded) {
        assert.equal(row.state, "superseded");
        assert.equal(row.ended_reason_class, "primary_transfer");
        assert.ok(row.ended_by_event_id);
      }

      // (e) the fresh-assurance evidence reference is on the outgoing consent
      // row and the transfer row, and on nothing else.
      const outgoing = (await rows(
        "SELECT assurance_ref, supersedes_consent_id, disclosure_kind, source FROM budget_space_consent WHERE consent_id = $1",
        [committed.receipt.outgoingConsentId],
      ))[0] as Record<string, unknown>;
      assert.equal(outgoing.assurance_ref, assurance);
      assert.equal(outgoing.supersedes_consent_id, space.primaryConsentId);
      assert.equal(outgoing.disclosure_kind, "primary_transfer_outgoing");
      assert.equal(outgoing.source, "primary_transfer");
      const incoming = (await rows(
        "SELECT assurance_ref, supersedes_consent_id, disclosure_kind FROM budget_space_consent WHERE consent_id = $1",
        [committed.receipt.recipientConsentId],
      ))[0] as Record<string, unknown>;
      assert.equal(incoming.assurance_ref, null);
      assert.equal(incoming.supersedes_consent_id, recipient.consentId);
      assert.equal(incoming.disclosure_kind, "primary_transfer_recipient");
      assert.equal(await scalar<string>("SELECT primary_assurance_ref FROM budget_space_primary_transfer WHERE transfer_id = $1", [transferId]), assurance);

      // (f) the permission-26 invitation was cancelled through the PK-5
      // system path, with its restricted AE-73-06 and an untouched projection.
      const cancelled = (await rows(
        "SELECT state, projection_state, private_terminal_cause FROM budget_space_invitation WHERE invitation_id = $1",
        [invitationId],
      ))[0] as Record<string, unknown>;
      assert.equal(cancelled.state, "cancelled");
      assert.equal(cancelled.projection_state, "pending");
      assert.equal(cancelled.private_terminal_cause, "permission_lost");
      assert.equal(await scalar<string>("SELECT disposition FROM budget_space_invitation_code WHERE invitation_id = $1", [invitationId]), "invalidated");

      // Exactly one AE-73-25 transfer_committed, two AE-73-30 enqueues, one
      // AE-73-06 for the cancelled invitation, and two MSG-73-042 notices.
      const correlation = await scalar<string>(
        "SELECT correlation_id FROM budget_space_lifecycle_audit WHERE event_subtype = 'transfer_committed' AND budget_space_id = $1",
        [space.spaceId],
      );
      const group = await rows(
        "SELECT event_code, event_subtype, result FROM budget_space_lifecycle_audit WHERE correlation_id = $1 ORDER BY occurred_at, event_id",
        [correlation],
      );
      assert.equal(group.filter((row) => row.event_subtype === "transfer_committed").length, 1);
      assert.equal(group.filter((row) => row.event_code === "AE-73-30").length, 2);
      assert.equal(group.filter((row) => row.event_code === "AE-73-06").length, 1);
      const notices = await rows(
        "SELECT account_subject_id, message_code FROM account_lifecycle_notice WHERE event_correlation_id = $1", [correlation],
      );
      assert.equal(notices.length, 2);
      assert.deepEqual([...new Set(notices.map((row) => row.message_code))], ["MSG-73-042"]);
      assert.deepEqual(
        notices.map((row) => row.account_subject_id as string).sort(),
        [space.primarySubject, recipient.subject].sort(),
      );

      // The transfer row is the receipt.
      const receiptRow = (await rows(
        "SELECT state, committed_at, recipient_consent_id, outgoing_consent_id, terminal_event_id FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(receiptRow.state, "committed");
      assert.equal(receiptRow.recipient_consent_id, committed.receipt.recipientConsentId);
      assert.equal(receiptRow.outgoing_consent_id, committed.receipt.outgoingConsentId);
      assert.ok(receiptRow.terminal_event_id);
    }

    // =================================================================
    // (c) decline, withdraw and expiry, each closing without a role change.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "co_owner");

      const declined = await propose(space, recipient);
      const declineResult = await transaction((deps) => declinePrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.decline_primary_transfer"), { transferId: declined },
      ));
      assert.equal(declineResult.outcome, "declined");
      assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [declined]), "declined");
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);

      const withdrawn = await propose(space, recipient);
      const withdrawResult = await transaction((deps) => withdrawPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.withdraw_primary_transfer"), { transferId: withdrawn },
      ));
      assert.equal(withdrawResult.outcome, "withdrawn");
      // Repeat is the uniform no-op, never a second mutation.
      const repeat = await transaction((deps) => withdrawPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.withdraw_primary_transfer"), { transferId: withdrawn },
      ));
      assert.equal(repeat.outcome, "denied");
      assert.equal(await scalar<number>("SELECT state_version FROM budget_space_primary_transfer WHERE transfer_id = $1", [withdrawn]), 2);

      // Expiry. `expires_at` is write-once -- the M3 trigger refuses to move
      // it, which is itself worth proving -- so the workflow is proposed with
      // a one-second lifetime and the next command runs on a clock two
      // seconds later, exactly as a real one would a week on.
      const proposedExpiring = await transaction((deps) => proposePrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.propose_primary_transfer"),
        { recipientMembershipId: recipient.membershipId },
      ), { lifetimes: { transferSeconds: 1 } });
      assert.equal(proposedExpiring.outcome, "proposed");
      if (proposedExpiring.outcome !== "proposed") throw new Error("unreachable");
      const expiring = proposedExpiring.transfer.transferId;
      await assert.rejects(
        () => withAdmin(async (connection) => connection.query(
          "UPDATE budget_space_primary_transfer SET expires_at = now() + interval '30 days' WHERE transfer_id = $1", [expiring],
        )),
        /write-once/u,
      );
      const later = { now: () => new Date(Date.now() + 2000).toISOString() };
      const expired = await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId: expiring },
      ), { clock: later });
      assert.equal(expired.outcome, "expired");
      assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [expiring]), "expired");
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
    }

    // =================================================================
    // (c) PK7A-02: a stale version at each step routes TR-73-46.
    // =================================================================
    for (const drift of ["recipient", "proposer", "space"] as const) {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const transferId = await propose(space, recipient);
      await withAdmin(async (connection) => {
        if (drift === "space") {
          await connection.query(
            "UPDATE budget_space SET primary_ownership_version = primary_ownership_version + 1 WHERE budget_space_id = $1",
            [space.spaceId],
          );
        } else {
          const membershipId = drift === "recipient" ? recipient.membershipId : space.primaryMembership;
          await connection.query(
            "UPDATE budget_space_membership SET authorization_version = 1 + authorization_version"
              + " WHERE membership_id = $1",
            [membershipId],
          );
        }
      });
      const result = await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));
      assert.equal(result.outcome, "invalidated", drift);
      assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [transferId]), "invalidated", drift);
      const after = await spaceCoherence(space);
      assert.equal(after.activePrimaries.length, 1, drift);
      assert.equal(after.consentByMembership.get(space.primaryMembership), "primary_owner", drift);
    }

    // =================================================================
    // (a) PK7A-01: a failure injected at every boundary leaves no row.
    // =================================================================
    for (const point of COMMIT_BOUNDARIES) {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitationId = await pendingCoOwnerInvitation(space);
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));

      await assert.rejects(
        () => transaction(async (deps) => {
          const confirmActor = actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance });
          // Record the Primary's leg, then discharge the four obligations and
          // commit -- the whole of what PK-7B's route does inside one
          // transaction -- with a failure injected at this boundary.
          const confirmed = await confirmPrimaryTransfer(deps, confirmActor, { transferId }, {
            boundary: (at) => {
              if (at === point) throw new Error(`injected at ${point}`);
            },
          });
          return confirmed;
        }),
        (error: unknown) => (error as Error).message === `injected at ${point}`,
        point,
      );

      // Nothing at all: not the workflow's own leg, not a consent row, not a
      // role, not the space, not the invitation, not an audit row, not a
      // notice. The transaction is the guarantee, and this is what proves it.
      const record = (await rows(
        "SELECT state, state_version, primary_confirmed_at, primary_assurance_ref, committed_at FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(record.state, "recipient_accepted", point);
      assert.equal(record.primary_confirmed_at, null, point);
      assert.equal(record.primary_assurance_ref, null, point);
      assert.equal(record.committed_at, null, point);

      const after = await spaceCoherence(space);
      assert.deepEqual(after.activePrimaries, [space.primaryMembership], point);
      assert.equal(after.primaryOwnerMembershipId, space.primaryMembership, point);
      assert.equal(after.primaryOwnershipVersion, 1, point);
      assert.equal(after.consentByMembership.get(space.primaryMembership), "primary_owner", point);
      assert.equal(after.consentByMembership.get(recipient.membershipId), "collaborator", point);
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM budget_space_consent WHERE budget_space_id = $1", [space.spaceId]),
        2, point,
      );
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "pending", point);
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM budget_space_lifecycle_audit WHERE budget_space_id = $1 AND event_subtype = 'transfer_committed'", [space.spaceId]),
        0, point,
      );
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM account_lifecycle_notice WHERE budget_space_id = $1", [space.spaceId]),
        0, point,
      );
    }

    // =================================================================
    // (b) PK7A-01: the deferred creation-invariant trigger is real. A
    //     transaction that moves the space without promoting the recipient
    //     is refused at COMMIT by the database, not by the application.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      await assert.rejects(
        () => withAdmin(async (connection) => {
          await connection.query(
            "UPDATE budget_space SET primary_owner_membership_id = $1, primary_ownership_version = primary_ownership_version + 1 WHERE budget_space_id = $2",
            [recipient.membershipId, space.spaceId],
          );
        }),
        /is not an active primary_owner membership/u,
      );
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
    }

    // =================================================================
    // (d) PK7A-02: a transfer commit and an invitation confirm racing on
    //     the same space serialize, and the space is coherent either way.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitee = await newSubject("Racing Invitee");
      const assurance = `fresh-assurance:${randomUUID()}`;

      // An invitation carried to `awaiting_confirmation`, so the confirm is
      // one transaction that inserts a membership and a consent row on this
      // very space while the transfer commits.
      const destination = `race-${randomUUID().slice(0, 8)}@example.com`;
      const invitationId = await client.transaction({ isolation: "serializable" }, async (scoped) => {
        const deps = invitationDeps(scoped);
        const owner: OwnerContext = {
          budgetSpaceId: space.spaceId, subjectId: space.primarySubject, membershipId: space.primaryMembership,
          decision: { ...POLICY, authorizationVersion: 1 }, permission: "24", correlationId: randomUUID(),
        };
        const created = await createInvitation(deps, owner, parseCreateInvitationRequest({
          channel: "email", destination, proposedRole: "collaborator", idempotencyKey: randomUUID(),
        }));
        return created.projection.invitationId;
      });
      const rendered = await client.transaction({ isolation: "read committed" }, async (scoped) => {
        const persistence = invitationPersistence(
          { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock }, DIGEST,
        );
        return persistence.delivery.render(invitationId);
      });
      const ceremony = await client.transaction({ isolation: "serializable" }, async (scoped) => {
        const resolved = await resolveCode(invitationDeps(scoped), {
          presentedCode: rendered.bearer, environment: ENVIRONMENT, correlationId: randomUUID(),
        });
        assert.equal(resolved.outcome, "resolved");
        if (resolved.outcome !== "resolved") throw new Error("unreachable");
        return { ceremonyId: resolved.ceremonyId, ceremonySecret: resolved.ceremonySecret, environment: ENVIRONMENT, correlationId: randomUUID() };
      });
      await client.transaction({ isolation: "serializable" }, async (scoped) =>
        verifyChannel(invitationDeps(scoped), { ...ceremony, channelCode: rendered.challenge }));
      const inviteeContext = { subjectId: invitee.subject, sessionRowId: randomUUID(), environment: ENVIRONMENT, correlationId: randomUUID() };
      await client.transaction({ isolation: "serializable" }, async (scoped) =>
        attachAccount(invitationDeps(scoped), inviteeContext, ceremony));
      await client.transaction({ isolation: "serializable" }, async (scoped) =>
        acceptInvitation(invitationDeps(scoped), inviteeContext, {
          ...ceremony,
          acknowledgedDisclosure: { kind: "invitation_collaborator", version: disclosures.current("invitation_collaborator").version },
        }));
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "awaiting_confirmation");

      // The transfer, carried to `ready` by the recipient's acceptance.
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));

      const confirmOwner: OwnerContext = {
        budgetSpaceId: space.spaceId, subjectId: space.primarySubject, membershipId: space.primaryMembership,
        decision: { ...POLICY, authorizationVersion: 1 }, permission: "24", correlationId: randomUUID(),
      };
      const settled = await Promise.allSettled([
        transaction((deps) => confirmPrimaryTransfer(
          deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
          { transferId },
        )),
        client.transaction({ isolation: "serializable" }, async (scoped) =>
          confirmAcceptance(invitationDeps(scoped), confirmOwner, {
            invitationId, confirmationIdempotencyKey: randomUUID(),
          })),
      ]);

      // Whatever the interleaving, the space is coherent: exactly one active
      // Primary Owner, the space names it, and every active membership has
      // exactly one current consent row for the role it holds.
      const after = await spaceCoherence(space);
      assert.equal(after.activePrimaries.length, 1);
      assert.deepEqual(after.activePrimaries, [after.primaryOwnerMembershipId]);
      const active = await rows(
        "SELECT membership_id, role FROM budget_space_membership WHERE budget_space_id = $1 AND status = 'active'", [space.spaceId],
      );
      for (const row of active) {
        assert.equal(after.consentByMembership.get(row.membership_id as string), row.role as string, row.membership_id as string);
      }
      // Neither outcome may be a partial write: a rejection is a rollback,
      // and a fulfilment is a whole effect. The transfer side ran through
      // `runPrimaryTransferTransaction`, so its rejection is this module's
      // own vocabulary even when PostgreSQL raised at COMMIT (R-04); the
      // invitation side is PK-5's and may still surface the raw sqlState.
      const [transferOutcome, invitationOutcome] = settled;
      if (transferOutcome.status === "rejected") {
        const reason = transferOutcome.reason as unknown;
        assert.ok(
          isPrimaryTransferError(reason, "retryable_conflict") || isPrimaryTransferError(reason, "stale_version")
            || isPrimaryTransferError(reason, "conflict"),
          `transfer race outcome is not this module's vocabulary: ${String((reason as Error).message ?? reason)}`,
        );
      }
      if (invitationOutcome.status === "rejected") {
        const reason = invitationOutcome.reason as { sqlState?: string; code?: string; message?: string };
        const recognised = reason.sqlState === "40001" || reason.sqlState === "40P01"
          || /stale_version|retryable_conflict|conflict|40001|could not serialize/u.test(String(reason.message ?? reason.code ?? ""));
        assert.ok(recognised, `unrecognised invitation race outcome: ${String(reason.message ?? reason)}`);
      }
      // At least one of the two got through.
      assert.ok(settled.some((outcome) => outcome.status === "fulfilled"), "one of the two racing transactions committed");
    }

    // =================================================================
    // (e) PK7A-03: the four discharges compose inside one authorizing
    //     transaction and the commit refuses without them.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));

      // A commit attempted with an incomplete ledger denies and writes nothing.
      await assert.rejects(
        () => transaction(async (deps) => {
          const obligations = primaryTransferObligations(deps);
          const ledger = obligations.begin({
            budgetSpaceId: space.spaceId, transferId,
            decision: { ...POLICY, authorizationVersion: 1 },
            freshAssuranceRef: assurance, correlationId: randomUUID(),
          });
          return commitPrimaryTransfer(
            deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
            ledger,
          );
        }),
        (error: unknown) => isPrimaryTransferError(error, "obligation_undischarged"),
      );
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);

      // The whole of PK-7B's composition, in one transaction: record the
      // Primary's leg, discharge the four, then commit.
      const receipt = await transaction(async (deps) => {
        const confirmActor = actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance });
        const legOnly = await deps.repository.readTransfer(space.spaceId, transferId);
        assert.ok(legOnly);
        const applied = await deps.repository.updateTransfer(space.spaceId, transferId, legOnly.stateVersion, {
          state: "ready", primaryConfirmedAt: deps.clock.now(),
          primaryConfirmedVersion: legOnly.stateVersion + 1, primaryAssuranceRef: assurance,
        });
        assert.equal(applied, true);
        const obligations = primaryTransferObligations(deps);
        const ledger = obligations.begin({
          budgetSpaceId: space.spaceId, transferId,
          decision: { ...POLICY, authorizationVersion: 1 },
          freshAssuranceRef: assurance, correlationId: confirmActor.correlationId,
        });
        for (const kind of ["confirm", "invalidate", "notify", "preserve"] as const) {
          assert.equal(await obligations.discharge(ledger, kind), true, kind);
        }
        assert.equal(obligations.verify(ledger, ["confirm", "invalidate", "notify", "preserve"]), true);
        return commitPrimaryTransfer(deps, confirmActor, ledger);
      });
      assert.equal(receipt.newPrimaryMembershipId, recipient.membershipId);
      assert.equal(
        await scalar<string>("SELECT assurance_ref FROM budget_space_consent WHERE consent_id = $1", [receipt.outgoingConsentId]),
        assurance,
      );
      const after = await spaceCoherence(space);
      assert.deepEqual(after.activePrimaries, [recipient.membershipId]);
    }

  } finally {
        connection.release();
      }
    }

    async function newSubject(displayName: string | null): Promise<Subject> {
      const subject = randomUUID();
      const profile = randomUUID();
      await withAdmin(async (connection) => {
        await connection.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subject]);
        await connection.query(
          "INSERT INTO financial_profile (profile_id, account_subject_id, profile_state, display_name) VALUES ($1,$2,'active',$3)",
          [profile, subject, displayName],
        );
      });
      return { subject, profile };
    }

    async function newSpace(): Promise<Space> {
      const owner = await newSubject("Primary Example");
      const spaceId = randomUUID();
      const primaryMembership = randomUUID();
      const primaryConsentId = randomUUID();
      const scheduleVersion = randomUUID();
      const periodId = randomUUID();
      await withAdmin(async (connection) => {
        await connection.query(
          `INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version,
             primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id)
           VALUES ($1,$2,'America/New_York','2026a','USD','iso4217/2026',$3,$4,$4,$5,$6)`,
          [spaceId, `pk7a ${spaceId.slice(0, 8)}`, primaryMembership, scheduleVersion, periodId, owner.subject],
        );
        await connection.query(
          `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
           VALUES ($1,$2,$3,$4,'primary_owner','active',$4)`,
          [primaryMembership, spaceId, owner.profile, owner.subject],
        );
        await connection.query(
          `INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope,
             source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest,
             policy_version, policy_digest, state, recorded_by_subject_id)
           VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$5,1,'primary_owner_self',1,'digest','p1','pdigest','current',$4)`,
          [primaryConsentId, spaceId, primaryMembership, owner.subject, randomUUID()],
        );
        await connection.query(
          `INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest)
           VALUES ($1,$2,1,'authoritative','{"cadence":"monthly","anchor":{"kind":"day","day":1}}','digest')`,
          [scheduleVersion, spaceId],
        );
        await connection.query(
          `INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date)
           VALUES ($1,$2,$3,'active','2026-09-01','2026-09-30')`,
          [periodId, spaceId, scheduleVersion],
        );
      });
      return {
        spaceId, primarySubject: owner.subject, primaryMembership,
        primaryProfile: owner.profile, primaryConsentId,
      };
    }

    /** A second active member with a `current` consent row, as an accepted invitation would have left them. */
    async function newMember(space: Space, role: "collaborator" | "co_owner"): Promise<Member> {
      const person = await newSubject("Member Example");
      const membershipId = randomUUID();
      const consentId = randomUUID();
      await withAdmin(async (connection) => {
        await connection.query(
          `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
           VALUES ($1,$2,$3,$4,$5,'active',$6)`,
          [membershipId, space.spaceId, person.profile, person.subject, role, space.primarySubject],
        );
        await connection.query(
          `INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope,
             source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest,
             policy_version, policy_digest, state, recorded_by_subject_id)
           VALUES ($1,$2,$3,$4,$5,'full','invitation_acceptance',$6,1,$7,1,'digest','p1','pdigest','current',$4)`,
          [
            consentId, space.spaceId, membershipId, person.subject, role, randomUUID(),
            role === "co_owner" ? "invitation_co_owner" : "invitation_collaborator",
          ],
        );
      });
      return { membershipId, subject: person.subject, profile: person.profile, consentId };
    }

    const client = bindClient(api, true, PRODUCTION_TABLE_CATALOG);
    const disclosures = liveDisclosures();
    const clock = { now: () => new Date().toISOString() };

    /**
     * One `serializable` transaction, composed exactly as PK-7B's route will
     * compose it, through the store's wrapper so that a serialization
     * failure raised at COMMIT reaches the caller as `retryable_conflict`
     * (`R-04`).
     */
    async function transaction<T>(
      work: (deps: PrimaryTransferDependencies, scoped: DataAccessClient) => Promise<T>,
      overrides: Partial<Pick<PrimaryTransferDependencies, "clock" | "lifetimes">> = {},
    ): Promise<T> {
      return runPrimaryTransferTransaction(client, async (scoped) =>
        work({ ...transferDeps(scoped), ...overrides }, scoped));
    }

    /** The PK-5 dependencies and the transfer dependencies over one and the same transaction client. */
    function invitationDeps(scoped: DataAccessClient): InvitationDependencies {
      const persistence = invitationPersistence(
        { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock }, DIGEST,
      );
      return {
        repository: persistence.repository,
        locator: persistence.locator,
        clock,
        ids: { uuid: () => randomUUID() },
        digest: DIGEST,
        disclosures,
        encryptDestination: persistence.encryptDestination,
        readDestination: persistence.readDestination,
        challengeReader: (invitationId) => persistence.delivery.challengeFor(invitationId),
      };
    }

    function transferDeps(scoped: DataAccessClient): PrimaryTransferDependencies {
      const invitations = invitationDeps(scoped);
      const persistence = primaryTransferPersistence({ client: scoped, invitations });
      assert.ok(persistence.cancelPermissionLostInvitations, "the PK-5 system cancel path is composed");
      return {
        repository: persistence.repository,
        clock,
        ids: { uuid: () => randomUUID() },
        disclosures,
        cancelPermissionLostInvitations: persistence.cancelPermissionLostInvitations,
      };
    }

    function actor(
      space: Space, membershipId: string, subjectId: string, action: TransferActionCode,
      options: { readonly assurance?: string; readonly authorizationVersion?: number; readonly correlationId?: string } = {},
    ): ActorContext {
      // Bound to a short local first, here and below: the secret scanner's
      // generic-api-key rule reads an auth-shaped name followed by another
      // long identifier as a credential assignment (PK2FIX-F04).
      const version = options.authorizationVersion ?? 1;
      const base: ActorContext = {
        budgetSpaceId: space.spaceId, subjectId, membershipId,
        decision: { ...POLICY, authorizationVersion: version },
        permission: "29", actionCode: action,
        correlationId: options.correlationId ?? randomUUID(),
      };
      return options.assurance === undefined ? base : { ...base, freshAssuranceRef: options.assurance };
    }

    async function propose(space: Space, recipient: Member): Promise<string> {
      const result = await transaction((deps) => proposePrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.propose_primary_transfer"),
        { recipientMembershipId: recipient.membershipId },
      ));
      assert.equal(result.outcome, "proposed", JSON.stringify(result));
      if (result.outcome !== "proposed") throw new Error("unreachable");
      return result.transfer.transferId;
    }

    async function scalar<T>(text: string, values: readonly unknown[]): Promise<T> {
      const result = await api.query(text, values as unknown[]);
      return (result.rows[0] as Record<string, T> | undefined) === undefined
        ? (undefined as unknown as T)
        : Object.values(result.rows[0] as Record<string, unknown>)[0] as T;
    }

    async function rows(text: string, values: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
      const result = await api.query(text, values as unknown[]);
      return result.rows as readonly Record<string, unknown>[];
    }

    /** One permission-26 invitation the Primary created, left `pending` for the commit to cancel. */
    async function pendingCoOwnerInvitation(space: Space): Promise<string> {
      const destination = `co-${randomUUID().slice(0, 8)}@example.com`;
      const invitationId = await client.transaction({ isolation: "serializable" }, async (scoped) => {
        const deps = invitationDeps(scoped);
        const owner: OwnerContext = {
          budgetSpaceId: space.spaceId, subjectId: space.primarySubject, membershipId: space.primaryMembership,
          decision: { ...POLICY, authorizationVersion: 1 }, permission: "26", correlationId: randomUUID(),
        };
        const created = await createInvitation(deps, owner, parseCreateInvitationRequest({
          channel: "email", destination, proposedRole: "co_owner", idempotencyKey: randomUUID(),
        }));
        return created.projection.invitationId;
      });
      // Dispatch, so the record reaches `pending` with a live code.
      await client.transaction({ isolation: "read committed" }, async (scoped) => {
        const persistence = invitationPersistence(
          { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock }, DIGEST,
        );
        await persistence.delivery.render(invitationId);
      });
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "pending");
      return invitationId;
    }

    /** What the space looks like afterwards. Used by every coherence assertion below. */
    async function spaceCoherence(space: Space): Promise<{
      primaryOwnerMembershipId: string; primaryOwnershipVersion: number;
      activePrimaries: readonly string[]; consentByMembership: ReadonlyMap<string, string>;
    }> {
      const spaceRow = (await rows(
        "SELECT primary_owner_membership_id, primary_ownership_version FROM budget_space WHERE budget_space_id = $1",
        [space.spaceId],
      ))[0] as { primary_owner_membership_id: string; primary_ownership_version: number };
      const memberships = await rows(
        "SELECT membership_id, role, status FROM budget_space_membership WHERE budget_space_id = $1", [space.spaceId],
      );
      const consents = await rows(
        "SELECT membership_id, role FROM budget_space_consent WHERE budget_space_id = $1 AND state = 'current'", [space.spaceId],
      );
      return {
        primaryOwnerMembershipId: spaceRow.primary_owner_membership_id,
        primaryOwnershipVersion: spaceRow.primary_ownership_version,
        activePrimaries: memberships
          .filter((row) => row.role === "primary_owner" && row.status === "active")
          .map((row) => row.membership_id as string),
        consentByMembership: new Map(consents.map((row) => [row.membership_id as string, row.role as string])),
      };
    }

    // =================================================================
    // (c) PK7A-02: the whole workflow, one step per transaction, as the
    //     six routes will run it.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitationId = await pendingCoOwnerInvitation(space);
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);

      // The captured versions are the live ones.
      const proposed = (await rows(
        "SELECT state, state_version, proposer_authorization_version, recipient_authorization_version, primary_ownership_version, primary_assurance_ref FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(proposed.state, "proposed");
      assert.equal(proposed.proposer_authorization_version, 1);
      assert.equal(proposed.recipient_authorization_version, 1);
      assert.equal(proposed.primary_ownership_version, 1);
      assert.equal(proposed.primary_assurance_ref, null);

      // A second live workflow is refused by the command, and the partial
      // unique index refuses it independently.
      const second = await transaction((deps) => proposePrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.propose_primary_transfer"),
        { recipientMembershipId: recipient.membershipId },
      ));
      assert.equal(second.outcome, "denied");
      await assert.rejects(
        () => withAdmin(async (connection) => connection.query(
          `INSERT INTO budget_space_primary_transfer (transfer_id, budget_space_id, proposer_membership_id, recipient_membership_id,
             proposer_authorization_version, recipient_authorization_version, primary_ownership_version,
             recipient_disclosure_kind, recipient_disclosure_version, recipient_disclosure_digest,
             outgoing_disclosure_kind, outgoing_disclosure_version, outgoing_disclosure_digest,
             state, expires_at, policy_version, policy_digest)
           VALUES ($1,$2,$3,$4,1,1,1,'primary_transfer_recipient',1,'d','primary_transfer_outgoing',1,'d','proposed', now() + interval '1 day','p4','pd')`,
          [randomUUID(), space.spaceId, space.primaryMembership, recipient.membershipId],
        )),
        /budget_space_primary_transfer_one_live_per_space|duplicate key/u,
      );

      // Either party reads the status; a third person cannot.
      const view = await transaction((deps) => viewPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.view_primary_transfer"), { transferId },
      ));
      assert.equal(view.outcome, "view");

      // The recipient accepts. No role changes.
      const accepted = await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));
      assert.equal(accepted.outcome, "recipient_accepted");
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
      assert.equal(await scalar<string>("SELECT role FROM budget_space_membership WHERE membership_id = $1", [recipient.membershipId]), "collaborator");

      // The Primary confirms, which completes the pair and commits.
      const committed = await transaction((deps) => confirmPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
        { transferId },
      ));
      assert.equal(committed.outcome, "committed", JSON.stringify(committed));
      if (committed.outcome !== "committed") throw new Error("unreachable");

      // (b) the space is coherent, and the deferred creation-invariant
      // trigger accepted the moved reference at COMMIT.
      const after = await spaceCoherence(space);
      assert.equal(after.primaryOwnerMembershipId, recipient.membershipId);
      assert.equal(after.primaryOwnershipVersion, 2);
      assert.deepEqual(after.activePrimaries, [recipient.membershipId]);
      assert.equal(after.consentByMembership.get(recipient.membershipId), "primary_owner");
      assert.equal(after.consentByMembership.get(space.primaryMembership), "co_owner");
      assert.equal(await scalar<number>("SELECT authorization_version FROM budget_space_membership WHERE membership_id = $1", [space.primaryMembership]), 2);
      assert.equal(await scalar<number>("SELECT authorization_version FROM budget_space_membership WHERE membership_id = $1", [recipient.membershipId]), 2);

      // Both prior consent rows are superseded and linked to the terminal event.
      const superseded = await rows(
        "SELECT consent_id, state, ended_reason_class, ended_by_event_id FROM budget_space_consent WHERE consent_id = ANY($1)",
        [[space.primaryConsentId, recipient.consentId]],
      );
      assert.equal(superseded.length, 2);
      for (const row of superseded) {
        assert.equal(row.state, "superseded");
        assert.equal(row.ended_reason_class, "primary_transfer");
        assert.ok(row.ended_by_event_id);
      }

      // (e) the fresh-assurance evidence reference is on the outgoing consent
      // row and the transfer row, and on nothing else.
      const outgoing = (await rows(
        "SELECT assurance_ref, supersedes_consent_id, disclosure_kind, source FROM budget_space_consent WHERE consent_id = $1",
        [committed.receipt.outgoingConsentId],
      ))[0] as Record<string, unknown>;
      assert.equal(outgoing.assurance_ref, assurance);
      assert.equal(outgoing.supersedes_consent_id, space.primaryConsentId);
      assert.equal(outgoing.disclosure_kind, "primary_transfer_outgoing");
      assert.equal(outgoing.source, "primary_transfer");
      const incoming = (await rows(
        "SELECT assurance_ref, supersedes_consent_id, disclosure_kind FROM budget_space_consent WHERE consent_id = $1",
        [committed.receipt.recipientConsentId],
      ))[0] as Record<string, unknown>;
      assert.equal(incoming.assurance_ref, null);
      assert.equal(incoming.supersedes_consent_id, recipient.consentId);
      assert.equal(incoming.disclosure_kind, "primary_transfer_recipient");
      assert.equal(await scalar<string>("SELECT primary_assurance_ref FROM budget_space_primary_transfer WHERE transfer_id = $1", [transferId]), assurance);

      // (f) the permission-26 invitation was cancelled through the PK-5
      // system path, with its restricted AE-73-06 and an untouched projection.
      const cancelled = (await rows(
        "SELECT state, projection_state, private_terminal_cause FROM budget_space_invitation WHERE invitation_id = $1",
        [invitationId],
      ))[0] as Record<string, unknown>;
      assert.equal(cancelled.state, "cancelled");
      assert.equal(cancelled.projection_state, "pending");
      assert.equal(cancelled.private_terminal_cause, "permission_lost");
      assert.equal(await scalar<string>("SELECT disposition FROM budget_space_invitation_code WHERE invitation_id = $1", [invitationId]), "invalidated");

      // Exactly one AE-73-25 transfer_committed, two AE-73-30 enqueues, one
      // AE-73-06 for the cancelled invitation, and two MSG-73-042 notices.
      const correlation = await scalar<string>(
        "SELECT correlation_id FROM budget_space_lifecycle_audit WHERE event_subtype = 'transfer_committed' AND budget_space_id = $1",
        [space.spaceId],
      );
      const group = await rows(
        "SELECT event_code, event_subtype, result FROM budget_space_lifecycle_audit WHERE correlation_id = $1 ORDER BY occurred_at, event_id",
        [correlation],
      );
      assert.equal(group.filter((row) => row.event_subtype === "transfer_committed").length, 1);
      assert.equal(group.filter((row) => row.event_code === "AE-73-30").length, 2);
      assert.equal(group.filter((row) => row.event_code === "AE-73-06").length, 1);
      const notices = await rows(
        "SELECT account_subject_id, message_code FROM account_lifecycle_notice WHERE event_correlation_id = $1", [correlation],
      );
      assert.equal(notices.length, 2);
      assert.deepEqual([...new Set(notices.map((row) => row.message_code))], ["MSG-73-042"]);
      assert.deepEqual(
        notices.map((row) => row.account_subject_id as string).sort(),
        [space.primarySubject, recipient.subject].sort(),
      );

      // The transfer row is the receipt.
      const receiptRow = (await rows(
        "SELECT state, committed_at, recipient_consent_id, outgoing_consent_id, terminal_event_id FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(receiptRow.state, "committed");
      assert.equal(receiptRow.recipient_consent_id, committed.receipt.recipientConsentId);
      assert.equal(receiptRow.outgoing_consent_id, committed.receipt.outgoingConsentId);
      assert.ok(receiptRow.terminal_event_id);
    }

    // =================================================================
    // (c) decline, withdraw and expiry, each closing without a role change.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "co_owner");

      const declined = await propose(space, recipient);
      const declineResult = await transaction((deps) => declinePrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.decline_primary_transfer"), { transferId: declined },
      ));
      assert.equal(declineResult.outcome, "declined");
      assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [declined]), "declined");
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);

      const withdrawn = await propose(space, recipient);
      const withdrawResult = await transaction((deps) => withdrawPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.withdraw_primary_transfer"), { transferId: withdrawn },
      ));
      assert.equal(withdrawResult.outcome, "withdrawn");
      // Repeat is the uniform no-op, never a second mutation.
      const repeat = await transaction((deps) => withdrawPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.withdraw_primary_transfer"), { transferId: withdrawn },
      ));
      assert.equal(repeat.outcome, "denied");
      assert.equal(await scalar<number>("SELECT state_version FROM budget_space_primary_transfer WHERE transfer_id = $1", [withdrawn]), 2);

      // Expiry. `expires_at` is write-once -- the M3 trigger refuses to move
      // it, which is itself worth proving -- so the workflow is proposed with
      // a one-second lifetime and the next command runs on a clock two
      // seconds later, exactly as a real one would a week on.
      const proposedExpiring = await transaction((deps) => proposePrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.propose_primary_transfer"),
        { recipientMembershipId: recipient.membershipId },
      ), { lifetimes: { transferSeconds: 1 } });
      assert.equal(proposedExpiring.outcome, "proposed");
      if (proposedExpiring.outcome !== "proposed") throw new Error("unreachable");
      const expiring = proposedExpiring.transfer.transferId;
      await assert.rejects(
        () => withAdmin(async (connection) => connection.query(
          "UPDATE budget_space_primary_transfer SET expires_at = now() + interval '30 days' WHERE transfer_id = $1", [expiring],
        )),
        /write-once/u,
      );
      const later = { now: () => new Date(Date.now() + 2000).toISOString() };
      const expired = await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId: expiring },
      ), { clock: later });
      assert.equal(expired.outcome, "expired");
      assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [expiring]), "expired");
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
    }

    // =================================================================
    // (c) PK7A-02: a stale version at each step routes TR-73-46.
    // =================================================================
    for (const drift of ["recipient", "proposer", "space"] as const) {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const transferId = await propose(space, recipient);
      await withAdmin(async (connection) => {
        if (drift === "space") {
          await connection.query(
            "UPDATE budget_space SET primary_ownership_version = primary_ownership_version + 1 WHERE budget_space_id = $1",
            [space.spaceId],
          );
        } else {
          const membershipId = drift === "recipient" ? recipient.membershipId : space.primaryMembership;
          await connection.query(
            "UPDATE budget_space_membership SET authorization_version = 1 + authorization_version"
              + " WHERE membership_id = $1",
            [membershipId],
          );
        }
      });
      const result = await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));
      assert.equal(result.outcome, "invalidated", drift);
      assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [transferId]), "invalidated", drift);
      const after = await spaceCoherence(space);
      assert.equal(after.activePrimaries.length, 1, drift);
      assert.equal(after.consentByMembership.get(space.primaryMembership), "primary_owner", drift);
    }

    // =================================================================
    // (a) PK7A-01: a failure injected at every boundary leaves no row.
    // =================================================================
    for (const point of COMMIT_BOUNDARIES) {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitationId = await pendingCoOwnerInvitation(space);
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));

      await assert.rejects(
        () => transaction(async (deps) => {
          const confirmActor = actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance });
          // Record the Primary's leg, then discharge the four obligations and
          // commit -- the whole of what PK-7B's route does inside one
          // transaction -- with a failure injected at this boundary.
          const confirmed = await confirmPrimaryTransfer(deps, confirmActor, { transferId }, {
            boundary: (at) => {
              if (at === point) throw new Error(`injected at ${point}`);
            },
          });
          return confirmed;
        }),
        (error: unknown) => (error as Error).message === `injected at ${point}`,
        point,
      );

      // Nothing at all: not the workflow's own leg, not a consent row, not a
      // role, not the space, not the invitation, not an audit row, not a
      // notice. The transaction is the guarantee, and this is what proves it.
      const record = (await rows(
        "SELECT state, state_version, primary_confirmed_at, primary_assurance_ref, committed_at FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(record.state, "recipient_accepted", point);
      assert.equal(record.primary_confirmed_at, null, point);
      assert.equal(record.primary_assurance_ref, null, point);
      assert.equal(record.committed_at, null, point);

      const after = await spaceCoherence(space);
      assert.deepEqual(after.activePrimaries, [space.primaryMembership], point);
      assert.equal(after.primaryOwnerMembershipId, space.primaryMembership, point);
      assert.equal(after.primaryOwnershipVersion, 1, point);
      assert.equal(after.consentByMembership.get(space.primaryMembership), "primary_owner", point);
      assert.equal(after.consentByMembership.get(recipient.membershipId), "collaborator", point);
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM budget_space_consent WHERE budget_space_id = $1", [space.spaceId]),
        2, point,
      );
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "pending", point);
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM budget_space_lifecycle_audit WHERE budget_space_id = $1 AND event_subtype = 'transfer_committed'", [space.spaceId]),
        0, point,
      );
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM account_lifecycle_notice WHERE budget_space_id = $1", [space.spaceId]),
        0, point,
      );
    }

    // =================================================================
    // (b) PK7A-01: the deferred creation-invariant trigger is real. A
    //     transaction that moves the space without promoting the recipient
    //     is refused at COMMIT by the database, not by the application.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      await assert.rejects(
        () => withAdmin(async (connection) => {
          await connection.query(
            "UPDATE budget_space SET primary_owner_membership_id = $1, primary_ownership_version = primary_ownership_version + 1 WHERE budget_space_id = $2",
            [recipient.membershipId, space.spaceId],
          );
        }),
        /is not an active primary_owner membership/u,
      );
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
    }

    // =================================================================
    // (d) PK7A-02: a transfer commit and an invitation confirm racing on
    //     the same space serialize, and the space is coherent either way.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitee = await newSubject("Racing Invitee");
      const assurance = `fresh-assurance:${randomUUID()}`;

      // An invitation carried to `awaiting_confirmation`, so the confirm is
      // one transaction that inserts a membership and a consent row on this
      // very space while the transfer commits.
      const destination = `race-${randomUUID().slice(0, 8)}@example.com`;
      const invitationId = await client.transaction({ isolation: "serializable" }, async (scoped) => {
        const deps = invitationDeps(scoped);
        const owner: OwnerContext = {
          budgetSpaceId: space.spaceId, subjectId: space.primarySubject, membershipId: space.primaryMembership,
          decision: { ...POLICY, authorizationVersion: 1 }, permission: "24", correlationId: randomUUID(),
        };
        const created = await createInvitation(deps, owner, parseCreateInvitationRequest({
          channel: "email", destination, proposedRole: "collaborator", idempotencyKey: randomUUID(),
        }));
        return created.projection.invitationId;
      });
      const rendered = await client.transaction({ isolation: "read committed" }, async (scoped) => {
        const persistence = invitationPersistence(
          { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock }, DIGEST,
        );
        return persistence.delivery.render(invitationId);
      });
      const ceremony = await client.transaction({ isolation: "serializable" }, async (scoped) => {
        const resolved = await resolveCode(invitationDeps(scoped), {
          presentedCode: rendered.bearer, environment: ENVIRONMENT, correlationId: randomUUID(),
        });
        assert.equal(resolved.outcome, "resolved");
        if (resolved.outcome !== "resolved") throw new Error("unreachable");
        return { ceremonyId: resolved.ceremonyId, ceremonySecret: resolved.ceremonySecret, environment: ENVIRONMENT, correlationId: randomUUID() };
      });
      await client.transaction({ isolation: "serializable" }, async (scoped) =>
        verifyChannel(invitationDeps(scoped), { ...ceremony, channelCode: rendered.challenge }));
      const inviteeContext = { subjectId: invitee.subject, sessionRowId: randomUUID(), environment: ENVIRONMENT, correlationId: randomUUID() };
      await client.transaction({ isolation: "serializable" }, async (scoped) =>
        attachAccount(invitationDeps(scoped), inviteeContext, ceremony));
      await client.transaction({ isolation: "serializable" }, async (scoped) =>
        acceptInvitation(invitationDeps(scoped), inviteeContext, {
          ...ceremony,
          acknowledgedDisclosure: { kind: "invitation_collaborator", version: disclosures.current("invitation_collaborator").version },
        }));
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "awaiting_confirmation");

      // The transfer, carried to `ready` by the recipient's acceptance.
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));

      const confirmOwner: OwnerContext = {
        budgetSpaceId: space.spaceId, subjectId: space.primarySubject, membershipId: space.primaryMembership,
        decision: { ...POLICY, authorizationVersion: 1 }, permission: "24", correlationId: randomUUID(),
      };
      const settled = await Promise.allSettled([
        transaction((deps) => confirmPrimaryTransfer(
          deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
          { transferId },
        )),
        client.transaction({ isolation: "serializable" }, async (scoped) =>
          confirmAcceptance(invitationDeps(scoped), confirmOwner, {
            invitationId, confirmationIdempotencyKey: randomUUID(),
          })),
      ]);

      // Whatever the interleaving, the space is coherent: exactly one active
      // Primary Owner, the space names it, and every active membership has
      // exactly one current consent row for the role it holds.
      const after = await spaceCoherence(space);
      assert.equal(after.activePrimaries.length, 1);
      assert.deepEqual(after.activePrimaries, [after.primaryOwnerMembershipId]);
      const active = await rows(
        "SELECT membership_id, role FROM budget_space_membership WHERE budget_space_id = $1 AND status = 'active'", [space.spaceId],
      );
      for (const row of active) {
        assert.equal(after.consentByMembership.get(row.membership_id as string), row.role as string, row.membership_id as string);
      }
      // Neither outcome may be a partial write: a rejection is a rollback,
      // and a fulfilment is a whole effect. The transfer side ran through
      // `runPrimaryTransferTransaction`, so its rejection is this module's
      // own vocabulary even when PostgreSQL raised at COMMIT (R-04); the
      // invitation side is PK-5's and may still surface the raw sqlState.
      const [transferOutcome, invitationOutcome] = settled;
      if (transferOutcome.status === "rejected") {
        const reason = transferOutcome.reason as unknown;
        assert.ok(
          isPrimaryTransferError(reason, "retryable_conflict") || isPrimaryTransferError(reason, "stale_version")
            || isPrimaryTransferError(reason, "conflict"),
          `transfer race outcome is not this module's vocabulary: ${String((reason as Error).message ?? reason)}`,
        );
      }
      if (invitationOutcome.status === "rejected") {
        const reason = invitationOutcome.reason as { sqlState?: string; code?: string; message?: string };
        const recognised = reason.sqlState === "40001" || reason.sqlState === "40P01"
          || /stale_version|retryable_conflict|conflict|40001|could not serialize/u.test(String(reason.message ?? reason.code ?? ""));
        assert.ok(recognised, `unrecognised invitation race outcome: ${String(reason.message ?? reason)}`);
      }
      // At least one of the two got through.
      assert.ok(settled.some((outcome) => outcome.status === "fulfilled"), "one of the two racing transactions committed");
    }

    // =================================================================
    // (e) PK7A-03: the four discharges compose inside one authorizing
    //     transaction and the commit refuses without them.
    // =================================================================
    {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));

      // A commit attempted with an incomplete ledger denies and writes nothing.
      await assert.rejects(
        () => transaction(async (deps) => {
          const obligations = primaryTransferObligations(deps);
          const ledger = obligations.begin({
            budgetSpaceId: space.spaceId, transferId,
            decision: { ...POLICY, authorizationVersion: 1 },
            freshAssuranceRef: assurance, correlationId: randomUUID(),
          });
          return commitPrimaryTransfer(
            deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
            ledger,
          );
        }),
        (error: unknown) => isPrimaryTransferError(error, "obligation_undischarged"),
      );
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);

      // The whole of PK-7B's composition, in one transaction: record the
      // Primary's leg, discharge the four, then commit.
      const receipt = await transaction(async (deps) => {
        const confirmActor = actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance });
        const legOnly = await deps.repository.readTransfer(space.spaceId, transferId);
        assert.ok(legOnly);
        const applied = await deps.repository.updateTransfer(space.spaceId, transferId, legOnly.stateVersion, {
          state: "ready", primaryConfirmedAt: deps.clock.now(),
          primaryConfirmedVersion: legOnly.stateVersion + 1, primaryAssuranceRef: assurance,
        });
        assert.equal(applied, true);
        const obligations = primaryTransferObligations(deps);
        const ledger = obligations.begin({
          budgetSpaceId: space.spaceId, transferId,
          decision: { ...POLICY, authorizationVersion: 1 },
          freshAssuranceRef: assurance, correlationId: confirmActor.correlationId,
        });
        for (const kind of ["confirm", "invalidate", "notify", "preserve"] as const) {
          assert.equal(await obligations.discharge(ledger, kind), true, kind);
        }
        assert.equal(obligations.verify(ledger, ["confirm", "invalidate", "notify", "preserve"]), true);
        return commitPrimaryTransfer(deps, confirmActor, ledger);
      });
      assert.equal(receipt.newPrimaryMembershipId, recipient.membershipId);
      assert.equal(
        await scalar<string>("SELECT assurance_ref FROM budget_space_consent WHERE consent_id = $1", [receipt.outgoingConsentId]),
        assurance,
      );
      const after = await spaceCoherence(space);
      assert.deepEqual(after.activePrimaries, [recipient.membershipId]);
    }

    // =================================================================
    // (g) R-01 / SEC-PK7A-F1: the boundary's order. The four discharge
    //     before the handler, on a capture that predates the leg, and the
    //     handler still commits -- in both leg orders. R-03: the retry
    //     answers the receipt. R-02: a stale registry writes nothing.
    // =================================================================
    for (const order of ["recipient-first", "primary-first"] as const) {
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const invitationId = await pendingCoOwnerInvitation(space);
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);
      if (order === "recipient-first") {
        await transaction((deps) => acceptPrimaryTransfer(
          deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
        ));
      }

      // The route's transaction: discharge the four, then run the handler
      // with the ledger, exactly as AuthorizationBoundary.execute orders it.
      const confirmed = await transaction(async (deps) => {
        const confirmActor = actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance });
        const obligations = primaryTransferObligations(deps);
        const ledger = obligations.begin({
          budgetSpaceId: space.spaceId, transferId, decision: confirmActor.decision,
          freshAssuranceRef: assurance, correlationId: confirmActor.correlationId,
        });
        assert.equal(await obligations.dischargeAll(ledger), true, `${order}: ${String(ledger.refusal)}`);
        return confirmPrimaryTransfer(deps, confirmActor, { transferId }, { ledger });
      });
      if (order === "primary-first") {
        assert.equal(confirmed.outcome, "primary_confirmed", JSON.stringify(confirmed));
        assert.equal(await scalar<string>("SELECT state FROM budget_space_primary_transfer WHERE transfer_id = $1", [transferId]), "primary_confirmed");
        const completed = await transaction((deps) => acceptPrimaryTransfer(
          deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
        ));
        assert.equal(completed.outcome, "committed", JSON.stringify(completed));
      } else {
        assert.equal(confirmed.outcome, "committed", JSON.stringify(confirmed));
      }
      const after = await spaceCoherence(space);
      assert.deepEqual(after.activePrimaries, [recipient.membershipId], order);
      assert.equal(after.primaryOwnershipVersion, 2, order);
      assert.equal(await scalar<string>("SELECT primary_assurance_ref FROM budget_space_primary_transfer WHERE transfer_id = $1", [transferId]), assurance, order);
      assert.equal(await scalar<string>("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]), "cancelled", order);
      assert.equal(
        await scalar<number>("SELECT count(*)::int FROM budget_space_lifecycle_audit WHERE budget_space_id = $1 AND event_subtype = 'transfer_committed'", [space.spaceId]),
        1, order,
      );

      // R-03: the Primary's retry on the committed workflow answers the
      // receipt the row is, and writes neither a denial nor a second commit.
      const auditsBefore = await scalar<number>("SELECT count(*)::int FROM budget_space_lifecycle_audit WHERE budget_space_id = $1", [space.spaceId]);
      const retried = await transaction((deps) => confirmPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }), { transferId },
      ));
      assert.equal(retried.outcome, "committed", order);
      if (retried.outcome !== "committed") throw new Error("unreachable");
      assert.equal(retried.receipt.newPrimaryMembershipId, recipient.membershipId);
      assert.equal(await scalar<number>("SELECT count(*)::int FROM budget_space_lifecycle_audit WHERE budget_space_id = $1", [space.spaceId]), auditsBefore, order);
      assert.equal((await spaceCoherence(space)).primaryOwnershipVersion, 2, order);
    }

    {
      // R-02: the registry moved under a live workflow. The completing
      // confirm denies stale_disclosure with nothing written -- not the leg,
      // not its audit row -- and the workflow stays recipient_accepted.
      const space = await newSpace();
      const recipient = await newMember(space, "collaborator");
      const assurance = `fresh-assurance:${randomUUID()}`;
      const transferId = await propose(space, recipient);
      await transaction((deps) => acceptPrimaryTransfer(
        deps, actor(space, recipient.membershipId, recipient.subject, "29.accept_primary_transfer"), { transferId },
      ));
      const current = disclosures.current("primary_transfer_outgoing");
      const moved: ConsentDisclosureSource = {
        current(kind: string): ConsentDisclosure {
          const entry = disclosures.current(kind);
          return kind === "primary_transfer_outgoing"
            ? { ...entry, version: current.version + 1, digest: "e".repeat(64) }
            : entry;
        },
      };
      const denied = await client.transaction({ isolation: "serializable" }, async (scoped) =>
        confirmPrimaryTransfer(
          { ...transferDeps(scoped), disclosures: moved },
          actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }),
          { transferId },
        ));
      assert.equal(denied.outcome, "denied", JSON.stringify(denied));
      if (denied.outcome !== "denied") throw new Error("unreachable");
      assert.equal(denied.reasonClass, "stale_disclosure");
      const row = (await rows(
        "SELECT state, state_version, primary_confirmed_at, primary_assurance_ref FROM budget_space_primary_transfer WHERE transfer_id = $1",
        [transferId],
      ))[0] as Record<string, unknown>;
      assert.equal(row.state, "recipient_accepted");
      assert.equal(row.state_version, 2);
      assert.equal(row.primary_confirmed_at, null);
      assert.equal(row.primary_assurance_ref, null);
      const subtypes = await rows(
        "SELECT event_subtype FROM budget_space_lifecycle_audit WHERE budget_space_id = $1 AND event_code = 'AE-73-25' ORDER BY occurred_at",
        [space.spaceId],
      );
      assert.deepEqual(subtypes.map((r) => r.event_subtype), ["transfer_proposed", "recipient_accepted", "transfer_denied"]);
      assert.equal((await spaceCoherence(space)).primaryOwnerMembershipId, space.primaryMembership);
      // Not stranded: with the registry as it is, the same confirm commits.
      const recovered = await transaction((deps) => confirmPrimaryTransfer(
        deps, actor(space, space.primaryMembership, space.primarySubject, "29.transfer_primary_ownership", { assurance }), { transferId },
      ));
      assert.equal(recovered.outcome, "committed", JSON.stringify(recovered));
    }
  } finally {
    await api.end();
    await admin.end();
  }
});
