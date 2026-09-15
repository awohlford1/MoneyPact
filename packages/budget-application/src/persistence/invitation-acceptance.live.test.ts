/**
 * PROTO-INVITATIONS-PK5 against a live PostgreSQL 17: the invitations module
 * over the PK-2 schema, through the real statement modules, the real
 * field-encryption provider and real `SERIALIZABLE` transactions.
 *
 * What is proved here and could not be proved anywhere else:
 *
 *   (a) `PK5-01` the acceptance transaction of design proposal SS8 is
 *       all-or-nothing. A failure injected immediately after the membership
 *       insert leaves no membership, no consent row, no confirmation
 *       decision, no terminal invitation state, no audit row and no notice --
 *       and the deferred commit-time guards of PK-2 are what the successful
 *       run has to satisfy on the way through;
 *   (b) `PK5-02` a stale or mismatched disclosure claim denies at `TR-73-38`
 *       and again at the commit, writing nothing either time;
 *   (c) `PK5-03` a link is single use: a consumed, expired, cancelled,
 *       superseded or foreign code resolves to one uniform outcome, a second
 *       confirm with the same key returns the stored receipt, two concurrent
 *       confirms serialize, and `TR-73-05` supersedes the predecessor and
 *       invalidates its code and ceremonies in one transaction;
 *   (d) `PK5-04` no raw address, bearer or challenge is readable in any
 *       column: the outbox holds three ciphertexts and the invitation row one,
 *       and the tombstone clears all three at once;
 *   (e) `PK5-05` the closed edges are refused by the application first and by
 *       the trigger independently.
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
import { listLifecycleAudit } from "../../../data-access/src/budget-space-lifecycle-audit.ts";
import { listAccountLifecycleNotices } from "../../../data-access/src/account-lifecycle-notice.ts";
import type { ConsentDisclosure, ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import {
  acceptInvitation, attachAccount, cancelInvitation, createInvitation, parseCreateInvitationRequest,
  replaceInvitation, resolveCode, verifyChannel,
} from "../invitations/application.ts";
import type { InvitationDependencies } from "../invitations/application.ts";
import { confirmAcceptance } from "../invitations/acceptance.ts";
import type { AcceptanceReceipt } from "../invitations/acceptance.ts";
import { assertInvitationEdge } from "../invitations/transitions.ts";
import { createKeyedDigest } from "../invitations/secrets.ts";
import { MAX_CHANNEL_ATTEMPTS, isInvitationError } from "../invitations/records.ts";
import type { OwnerActorContext } from "../invitations/ports.ts";
import { invitationPersistence } from "./invitation-store.ts";

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

const KEYS = createLocalKeyProvider({ key: Buffer.alloc(32, 11), keyVersion: "pk5-live-v1" });
const DIGEST = createKeyedDigest(KEYS);
const ENVIRONMENT = "pk5-live";

interface Space {
  readonly spaceId: string;
  readonly ownerSubject: string;
  readonly ownerMembership: string;
  readonly ownerProfile: string;
}

interface Subject {
  readonly subject: string;
  readonly profile: string;
}

void test("PROTO-INVITATIONS-PK5 live PostgreSQL: the acceptance transaction, the disclosure binding, single use and custody", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const api = createApiConnection();

  try {
    // -------------------------------------------------------------------
    // Fixtures. Built with the migration role, exactly as the PK-2 live
    // suite builds them, so the application code below is the only thing
    // under test.
    // -------------------------------------------------------------------
    async function newSubject(displayName: string | null): Promise<Subject> {
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
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
      return { subject, profile };
    }

    async function newSpace(): Promise<Space> {
      const owner = await newSubject("Owner Example");
      const spaceId = randomUUID();
      const ownerMembership = randomUUID();
      const scheduleVersion = randomUUID();
      const periodId = randomUUID();
      const connection = await admin.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SET CONSTRAINTS ALL DEFERRED");
        await connection.query(
          `INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version,
             primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id)
           VALUES ($1,$2,'America/New_York','2026a','USD','iso4217/2026',$3,$4,$4,$5,$6)`,
          [spaceId, `pk5 ${spaceId.slice(0, 8)}`, ownerMembership, scheduleVersion, periodId, owner.subject],
        );
        await connection.query(
          `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
           VALUES ($1,$2,$3,$4,'primary_owner','active',$4)`,
          [ownerMembership, spaceId, owner.profile, owner.subject],
        );
        await connection.query(
          `INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope,
             source, source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest,
             policy_version, policy_digest, state, recorded_by_subject_id)
           VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$5,1,'primary_owner_self',1,'digest','p1','pdigest','current',$4)`,
          [randomUUID(), spaceId, ownerMembership, owner.subject, randomUUID()],
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
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
      return { spaceId, ownerSubject: owner.subject, ownerMembership, ownerProfile: owner.profile };
    }

    const client = bindClient(api, true, PRODUCTION_TABLE_CATALOG);
    const disclosures = liveDisclosures();

    /** One `serializable` transaction, composed exactly as PK-6's route will compose it. */
    async function transaction<T>(
      work: (deps: InvitationDependencies, scoped: DataAccessClient) => Promise<T>,
    ): Promise<T> {
      return client.transaction({ isolation: "serializable" }, async (scoped) => {
        const persistence = invitationPersistence(
          { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock: { now: () => new Date().toISOString() } },
          DIGEST,
        );
        const deps: InvitationDependencies = {
          repository: persistence.repository,
          locator: persistence.locator,
          clock: { now: () => new Date().toISOString() },
          ids: { uuid: () => randomUUID() },
          digest: DIGEST,
          disclosures,
          encryptDestination: persistence.encryptDestination,
          readDestination: persistence.readDestination,
          challengeReader: (invitationId) => persistence.delivery.challengeFor(invitationId),
        };
        return work(deps, scoped);
      });
    }

    function ownerContext(space: Space, correlationId = randomUUID()): OwnerActorContext {
      return {
        budgetSpaceId: space.spaceId, subjectId: space.ownerSubject, membershipId: space.ownerMembership,
        decision: { policyVersion: "p5", policyDigest: "d".repeat(64), authorizationVersion: 1 },
        permission: "24", correlationId,
      };
    }

    function createRequest(destination: string) {
      return parseCreateInvitationRequest({
        channel: "email", destination, proposedRole: "collaborator", idempotencyKey: randomUUID(),
      });
    }

    /** The simulated local delivery: the one read that decrypts the outbox. */
    async function delivery(invitationId: string) {
      return client.transaction({ isolation: "read committed" }, async (scoped) => {
        const persistence = invitationPersistence(
          { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock: { now: () => new Date().toISOString() } },
          DIGEST,
        );
        const rendered = await persistence.delivery.render(invitationId);
        assert.equal(rendered.fidelityLabel, "simulated");
        return rendered;
      });
    }

    /** Carry one invitation from create to `awaiting_confirmation`, one transaction per step, as the routes will. */
    async function toAwaitingConfirmation(space: Space, destination: string, subject: Subject) {
      const invitationId = await transaction(async (deps) =>
        (await createInvitation(deps, ownerContext(space), createRequest(destination))).projection.invitationId);
      const rendered = await delivery(invitationId);
      const resolved = await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: rendered.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }));
      assert.equal(resolved.outcome, "resolved");
      if (resolved.outcome !== "resolved") throw new Error("unreachable");
      const ceremonyRequest = {
        ceremonyId: resolved.ceremonyId, ceremonySecret: resolved.ceremonySecret,
        environment: ENVIRONMENT, correlationId: randomUUID(),
      };
      await transaction(async (deps) => verifyChannel(deps, { ...ceremonyRequest, channelCode: rendered.challenge }));
      const invitee = { subjectId: subject.subject, sessionRowId: randomUUID(), environment: ENVIRONMENT, correlationId: randomUUID() };
      await transaction(async (deps) => attachAccount(deps, invitee, ceremonyRequest));
      await transaction(async (deps) => acceptInvitation(deps, invitee, {
        ...ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: disclosures.current("invitation_collaborator").version },
      }));
      return { invitationId, ceremonyId: resolved.ceremonyId, rendered, invitee };
    }

    async function countRows(table: string, column: string, value: string): Promise<number> {
      const result = await api.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [value]);
      return (result.rows[0] as { n: number }).n;
    }

    // =================================================================
    // (d) PK5-04 custody, checked first because every later block depends
    //     on the dispatch having happened.
    // =================================================================
    const custodySpace = await newSpace();
    const custodyInvitee = await newSubject(null);
    const custodyDestination = `custody-${randomUUID().slice(0, 8)}@example.com`;
    const custodyInvitationId = await transaction(async (deps) =>
      (await createInvitation(deps, ownerContext(custodySpace), createRequest(custodyDestination))).projection.invitationId);
    const custodyDelivery = await delivery(custodyInvitationId);

    {
      const row = (await api.query(
        `SELECT destination_token, destination_masked, encode(destination_ciphertext, 'escape') AS sealed
         FROM budget_space_invitation WHERE invitation_id = $1`,
        [custodyInvitationId],
      )).rows[0] as { destination_token: string; destination_masked: string; sealed: string };
      assert.match(row.destination_token, /^[0-9a-f]{64}$/u, "the destination token is a keyed digest");
      assert.equal(row.destination_masked, `c***@example.com`);
      assert.ok(!row.sealed.includes(custodyDestination), "destination_ciphertext does not contain the address");

      const outbox = (await api.query(
        `SELECT encode(destination_ciphertext,'escape') AS d, encode(bearer_ciphertext,'escape') AS b,
                encode(challenge_ciphertext,'escape') AS c, fidelity_label
         FROM budget_space_invitation_outbox WHERE invitation_id = $1`,
        [custodyInvitationId],
      )).rows[0] as { d: string; b: string; c: string; fidelity_label: string };
      assert.equal(outbox.fidelity_label, "simulated");
      assert.ok(!outbox.d.includes(custodyDestination), "the outbox address is envelope-encrypted");
      assert.ok(!outbox.b.includes(custodyDelivery.bearer), "the outbox bearer is envelope-encrypted");
      assert.ok(!outbox.c.includes(custodyDelivery.challenge), "the outbox challenge is envelope-encrypted");

      const code = (await api.query(
        "SELECT verifier_digest FROM budget_space_invitation_code WHERE invitation_id = $1", [custodyInvitationId],
      )).rows[0] as { verifier_digest: string };
      assert.match(code.verifier_digest, /^[0-9a-f]{64}$/u);
      assert.notEqual(code.verifier_digest, custodyDelivery.bearer);

      // The display identity read is the name only, and null shows as null
      // rather than as a contact.
      const identity = await transaction(async (deps) => deps.repository.readDisplayIdentity(custodyInvitee.subject));
      assert.deepEqual(Object.keys(identity ?? {}).sort(), ["accountSubjectId", "displayName", "profileId", "profileState", "version"]);
      assert.equal(identity?.displayName, null);
      // SEC-PK2-F08: the write advances financial_profile.version.
      const advanced = await transaction(async (deps) => deps.repository.writeDisplayName(custodyInvitee.subject, "Live Invitee", identity!.version));
      assert.equal(advanced, 1 + identity!.version);
      const reread = await transaction(async (deps) => deps.repository.readDisplayIdentity(custodyInvitee.subject));
      assert.equal(reread?.displayName, "Live Invitee");
      assert.equal(reread?.version, 1 + identity!.version);
      assert.equal(
        await transaction(async (deps) => deps.repository.writeDisplayName(custodyInvitee.subject, "Nope", identity!.version)),
        null, "a stale profile version writes nothing",
      );
    }

    // =================================================================
    // (f) SEC-PK5-F01. A wrong channel guess must survive the caller's
    //     transaction: the increment and the AE-73-09 row are what bound
    //     the 10^6 challenge, and a throw after the write rolled both back.
    // =================================================================
    {
      const boundSpace = await newSpace();
      const boundId = await transaction(async (deps) =>
        (await createInvitation(deps, ownerContext(boundSpace), createRequest(`bound-${randomUUID().slice(0, 8)}@example.com`))).projection.invitationId);
      const boundDelivery = await delivery(boundId);
      const opened = await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: boundDelivery.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }));
      if (opened.outcome !== "resolved") throw new Error("unreachable");
      const boundRequest = {
        ceremonyId: opened.ceremonyId, ceremonySecret: opened.ceremonySecret,
        environment: ENVIRONMENT, correlationId: randomUUID(),
      };
      const wrong = boundDelivery.challenge === "000000" ? "111111" : "000000";

      const firstGuess = await transaction(async (deps) => verifyChannel(deps, { ...boundRequest, channelCode: wrong }));
      assert.deepEqual(firstGuess, { outcome: "retry", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - 1 });
      assert.equal(
        ((await api.query("SELECT channel_attempts FROM budget_space_invitation_ceremony WHERE ceremony_id = $1", [opened.ceremonyId]))
          .rows[0] as { channel_attempts: number }).channel_attempts,
        1, "the attempt increment committed",
      );
      assert.equal(
        (await listLifecycleAudit(client, boundSpace.spaceId)).filter((row) => row.event_code === "AE-73-09").length,
        1, "the AE-73-09 denial row committed",
      );

      // The bound really exhausts: four more wrong guesses, then the ceremony
      // is dead and even the correct code cannot prove it.
      for (let attempt = 2; attempt < MAX_CHANNEL_ATTEMPTS; attempt += 1) {
        assert.deepEqual(
          await transaction(async (deps) => verifyChannel(deps, { ...boundRequest, channelCode: wrong })),
          { outcome: "retry", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - attempt }, `attempt ${attempt}`,
        );
      }
      assert.deepEqual(
        await transaction(async (deps) => verifyChannel(deps, { ...boundRequest, channelCode: wrong })),
        { outcome: "exhausted", attemptsRemaining: 0 },
      );
      const exhausted = (await api.query(
        "SELECT channel_attempts, channel_proof_state, state, is_current FROM budget_space_invitation_ceremony WHERE ceremony_id = $1", [opened.ceremonyId],
      )).rows[0] as { channel_attempts: number; channel_proof_state: string; state: string; is_current: boolean };
      assert.equal(exhausted.channel_attempts, MAX_CHANNEL_ATTEMPTS);
      assert.equal(exhausted.channel_proof_state, "exhausted");
      // SEC-PK6-F2: exhaustion is terminal for the bearer. The exhausting
      // guess committed the code's invalidation and the ceremony's, so the
      // correct code answers the uniform class on this ceremony ...
      assert.equal(exhausted.state, "invalidated");
      assert.equal(exhausted.is_current, false);
      await assert.rejects(
        transaction(async (deps) => verifyChannel(deps, { ...boundRequest, channelCode: boundDelivery.challenge })),
        (error: unknown) => isInvitationError(error, "ceremony_unusable"), "the correct code no longer proves an exhausted ceremony",
      );
      assert.equal(
        (await listLifecycleAudit(client, boundSpace.spaceId)).filter((row) => row.event_code === "AE-73-09").length,
        MAX_CHANNEL_ATTEMPTS, "one AE-73-09 per attempt that was taken",
      );
      // ... and a re-resolve of the same link cannot open a fresh ceremony
      // bound to the same six digits: the code is dead, the outbox row is
      // tombstoned, the answer is the uniform outcome with its AE-73-14 row.
      const deadCode = (await api.query(
        "SELECT disposition, disposition_reason_class FROM budget_space_invitation_code WHERE invitation_id = $1", [boundId],
      )).rows[0] as { disposition: string; disposition_reason_class: string | null };
      assert.deepEqual(deadCode, { disposition: "invalidated", disposition_reason_class: "channel_attempts_exhausted" });
      assert.equal(
        ((await api.query("SELECT delivery_state FROM budget_space_invitation_outbox WHERE invitation_id = $1", [boundId]))
          .rows[0] as { delivery_state: string }).delivery_state,
        "tombstoned",
      );
      const securityRowsBefore = Number(((await api.query(
        "SELECT count(*)::int AS n FROM invitation_security_event WHERE budget_space_id = $1", [boundSpace.spaceId],
      )).rows[0] as { n: number }).n);
      const reresolved = await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: boundDelivery.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }));
      assert.equal(reresolved.outcome, "unusable", "the exhausted link no longer resolves");
      assert.equal(
        ((await api.query(
          "SELECT count(*)::int AS n FROM budget_space_invitation_ceremony WHERE invitation_id = $1 AND is_current", [boundId],
        )).rows[0] as { n: number }).n,
        0, "no fresh ceremony was opened",
      );
      assert.equal(
        Number(((await api.query(
          "SELECT count(*)::int AS n FROM invitation_security_event WHERE budget_space_id = $1 AND outcome_class = 'terminal_record'", [boundSpace.spaceId],
        )).rows[0] as { n: number }).n),
        securityRowsBefore + 1, "the re-resolve wrote its AE-73-14 terminal_record row",
      );
    }

    // =================================================================
    // (a) PK5-01. The happy path first, so the failure run has something
    //     to be compared against.
    // =================================================================
    const space = await newSpace();
    const invitee = await newSubject("Accepting Person");
    const happy = await toAwaitingConfirmation(space, `accept-${randomUUID().slice(0, 8)}@example.com`, invitee);

    const owner = ownerContext(space);
    const receipt = await transaction(async (deps) =>
      confirmAcceptance(deps, owner, { invitationId: happy.invitationId, confirmationIdempotencyKey: "live-key-1" }));

    {
      const record = (await api.query(
        "SELECT state, projection_state, accepted_membership_id, commit_idempotency_key FROM budget_space_invitation WHERE invitation_id = $1",
        [happy.invitationId],
      )).rows[0] as { state: string; projection_state: string; accepted_membership_id: string; commit_idempotency_key: string };
      assert.equal(record.state, "accepted");
      assert.equal(record.projection_state, "accepted");
      assert.equal(record.accepted_membership_id, receipt.membershipId);
      assert.equal(record.commit_idempotency_key, "live-key-1");

      const membership = (await api.query(
        "SELECT role, status, authorization_version, profile_id FROM budget_space_membership WHERE membership_id = $1",
        [receipt.membershipId],
      )).rows[0] as { role: string; status: string; authorization_version: number; profile_id: string };
      assert.equal(membership.role, "collaborator");
      assert.equal(membership.status, "active");
      assert.equal(membership.authorization_version, 1);
      assert.equal(membership.profile_id, invitee.profile);

      const consent = (await api.query(
        `SELECT account_subject_id, recorded_by_subject_id, role, source, source_record_id, source_ceremony_id,
                disclosure_kind, disclosure_version, disclosure_digest, policy_version, state, assurance_ref
         FROM budget_space_consent WHERE consent_id = $1`,
        [receipt.consentId],
      )).rows[0] as Record<string, unknown>;
      assert.equal(consent.account_subject_id, invitee.subject);
      assert.equal(consent.recorded_by_subject_id, invitee.subject, "the row evidences the invitee's own action");
      assert.equal(consent.role, "collaborator");
      assert.equal(consent.source, "invitation_acceptance");
      assert.equal(consent.source_record_id, happy.invitationId);
      assert.equal(consent.source_ceremony_id, happy.ceremonyId);
      assert.equal(consent.disclosure_kind, "invitation_collaborator");
      assert.equal(consent.disclosure_digest, disclosures.current("invitation_collaborator").digest);
      assert.equal(consent.policy_version, "p5");
      assert.equal(consent.state, "current");
      assert.equal(consent.assurance_ref, null);

      assert.equal(await countRows("budget_space_invitation_code", "invitation_id", happy.invitationId), 1);
      const code = (await api.query(
        "SELECT disposition, disposition_reason_class FROM budget_space_invitation_code WHERE invitation_id = $1", [happy.invitationId],
      )).rows[0] as { disposition: string; disposition_reason_class: string };
      assert.equal(code.disposition, "consumed");
      assert.equal(code.disposition_reason_class, "accepted");

      const ceremony = (await api.query(
        "SELECT state, is_current FROM budget_space_invitation_ceremony WHERE ceremony_id = $1", [happy.ceremonyId],
      )).rows[0] as { state: string; is_current: boolean };
      assert.equal(ceremony.state, "consumed");
      assert.equal(ceremony.is_current, false);

      const confirmation = (await api.query(
        "SELECT state, decided_by_subject_id, committed_consent_id, displayed_identity_version FROM budget_space_invitation_confirmation WHERE confirmation_id = $1",
        [receipt.confirmationId],
      )).rows[0] as Record<string, unknown>;
      assert.equal(confirmation.state, "confirmed");
      assert.equal(confirmation.decided_by_subject_id, space.ownerSubject);
      assert.equal(confirmation.committed_consent_id, receipt.consentId);
      assert.equal(confirmation.displayed_identity_version, 1);

      // The custody record is tombstoned, whole, in the same transaction.
      const outbox = (await api.query(
        `SELECT delivery_state, tombstone_reason_class, bearer_ciphertext, challenge_ciphertext, destination_ciphertext
         FROM budget_space_invitation_outbox WHERE invitation_id = $1`, [happy.invitationId],
      )).rows[0] as Record<string, unknown>;
      assert.equal(outbox.delivery_state, "tombstoned");
      assert.equal(outbox.tombstone_reason_class, "code_consumed");
      assert.equal(outbox.bearer_ciphertext, null);
      assert.equal(outbox.challenge_ciphertext, null);
      assert.equal(outbox.destination_ciphertext, null);

      const audit = (await listLifecycleAudit(client, space.spaceId)).map((row) => `${row.event_code}${row.event_subtype ? `:${row.event_subtype}` : ""}`);
      for (const expected of ["AE-73-01", "AE-73-02", "AE-73-08", "AE-73-09", "AE-73-10", "AE-73-32:confirmation_requested", "AE-73-32:confirmation_confirmed", "AE-73-13", "AE-73-30"]) {
        assert.ok(audit.includes(expected), `${expected} is in the audit group`);
      }
      const inviteeNotices = (await listAccountLifecycleNotices(client, invitee.subject)).map((row) => row.message_code);
      assert.deepEqual(inviteeNotices, ["MSG-73-015"]);
      const ownerNotices = (await listAccountLifecycleNotices(client, space.ownerSubject)).map((row) => row.message_code).sort();
      assert.deepEqual(ownerNotices, ["MSG-73-019", "MSG-73-050"]);
    }

    // --- the injected failure after the membership insert ---------------
    {
      const failureSpace = await newSpace();
      const failureInvitee = await newSubject("Rolled Back");
      const pending = await toAwaitingConfirmation(failureSpace, `rollback-${randomUUID().slice(0, 8)}@example.com`, failureInvitee);
      const auditBefore = (await listLifecycleAudit(client, failureSpace.spaceId)).length;

      await assert.rejects(
        transaction(async (deps) => confirmAcceptance(deps, ownerContext(failureSpace), {
          invitationId: pending.invitationId, confirmationIdempotencyKey: "rolled-back",
        }, { boundary: (point) => { if (point === "after-membership") throw new Error("injected failure"); } })),
        /injected failure/u,
      );

      assert.equal(await countRows("budget_space_membership", "account_subject_id", failureInvitee.subject), 0, "no membership survived");
      assert.equal(await countRows("budget_space_consent", "account_subject_id", failureInvitee.subject), 0, "no consent row survived");
      const after = (await api.query(
        "SELECT state, accepted_membership_id, commit_idempotency_key FROM budget_space_invitation WHERE invitation_id = $1",
        [pending.invitationId],
      )).rows[0] as Record<string, unknown>;
      assert.equal(after.state, "awaiting_confirmation", "the invitation did not move");
      assert.equal(after.accepted_membership_id, null);
      assert.equal(after.commit_idempotency_key, null);
      assert.equal(
        ((await api.query("SELECT state FROM budget_space_invitation_confirmation WHERE invitation_id = $1", [pending.invitationId])).rows[0] as { state: string }).state,
        "requested", "the confirmation was not decided",
      );
      assert.equal((await listLifecycleAudit(client, failureSpace.spaceId)).length, auditBefore, "no audit row survived");
      assert.equal((await listAccountLifecycleNotices(client, failureInvitee.subject)).length, 0, "no notice survived");

      // And the same record still commits cleanly afterwards: the rollback
      // left nothing behind that would block a retry.
      const retry = await transaction(async (deps) => confirmAcceptance(deps, ownerContext(failureSpace), {
        invitationId: pending.invitationId, confirmationIdempotencyKey: "retried",
      }));
      assert.equal(await countRows("budget_space_membership", "membership_id", retry.membershipId), 1);
    }

    // =================================================================
    // (b) PK5-02 disclosure binding, at TR-73-38 and at the commit.
    // =================================================================
    {
      const staleSpace = await newSpace();
      const staleInvitee = await newSubject("Stale Claim");
      const destination = `stale-${randomUUID().slice(0, 8)}@example.com`;
      const invitationId = await transaction(async (deps) =>
        (await createInvitation(deps, ownerContext(staleSpace), createRequest(destination))).projection.invitationId);
      const rendered = await delivery(invitationId);
      const resolved = await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: rendered.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }));
      if (resolved.outcome !== "resolved") throw new Error("unreachable");
      const ceremonyRequest = {
        ceremonyId: resolved.ceremonyId, ceremonySecret: resolved.ceremonySecret,
        environment: ENVIRONMENT, correlationId: randomUUID(),
      };
      await transaction(async (deps) => verifyChannel(deps, { ...ceremonyRequest, channelCode: rendered.challenge }));
      const inviteeContext = { subjectId: staleInvitee.subject, sessionRowId: randomUUID(), environment: ENVIRONMENT, correlationId: randomUUID() };
      await transaction(async (deps) => attachAccount(deps, inviteeContext, ceremonyRequest));

      const auditBefore = (await listLifecycleAudit(client, staleSpace.spaceId)).length;
      for (const claim of [undefined, { kind: "invitation_collaborator", version: 99 }, { kind: "invitation_co_owner", version: 1 }]) {
        await assert.rejects(
          transaction(async (deps) => acceptInvitation(deps, inviteeContext, { ...ceremonyRequest, acknowledgedDisclosure: claim })),
          (error: unknown) => isInvitationError(error, "stale_disclosure"),
        );
      }
      assert.equal(
        ((await api.query("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId])).rows[0] as { state: string }).state,
        "pending", "TR-73-38 wrote nothing",
      );
      assert.equal(await countRows("budget_space_invitation_confirmation", "invitation_id", invitationId), 0);
      assert.equal((await listLifecycleAudit(client, staleSpace.spaceId)).length, auditBefore);

      // Now accept properly and move the registry under the commit.
      await transaction(async (deps) => acceptInvitation(deps, inviteeContext, {
        ...ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: disclosures.current("invitation_collaborator").version },
      }));
      const auditBeforeCommit = (await listLifecycleAudit(client, staleSpace.spaceId)).length;
      const movedRegistry: ConsentDisclosureSource = {
        current: (kind) => ({ ...disclosures.current(kind), version: 99, digest: "e".repeat(64) }),
      };
      await assert.rejects(
        client.transaction({ isolation: "serializable" }, async (scoped) => {
          const persistence = invitationPersistence(
            { client: scoped, locatorQueryable: api as Pick<Pool, "query">, keys: KEYS, clock: { now: () => new Date().toISOString() } }, DIGEST,
          );
          return confirmAcceptance({
            repository: persistence.repository, locator: persistence.locator,
            clock: { now: () => new Date().toISOString() }, ids: { uuid: () => randomUUID() },
            digest: DIGEST, disclosures: movedRegistry,
            encryptDestination: persistence.encryptDestination, readDestination: persistence.readDestination,
          }, ownerContext(staleSpace), { invitationId, confirmationIdempotencyKey: "stale-commit" });
        }),
        (error: unknown) => isInvitationError(error, "stale_disclosure"),
      );
      assert.equal(await countRows("budget_space_membership", "account_subject_id", staleInvitee.subject), 0, "the commit wrote nothing");
      assert.equal(await countRows("budget_space_consent", "account_subject_id", staleInvitee.subject), 0);
      assert.equal((await listLifecycleAudit(client, staleSpace.spaceId)).length, auditBeforeCommit);
      assert.equal(
        ((await api.query("SELECT state FROM budget_space_invitation WHERE invitation_id = $1", [invitationId])).rows[0] as { state: string }).state,
        "awaiting_confirmation",
      );
    }

    // =================================================================
    // (c) PK5-03 single use, replay, concurrency and replacement.
    // =================================================================
    {
      // A consumed link, and a foreign one, both resolve to the uniform outcome.
      const uniform: string[] = [];
      uniform.push(JSON.stringify(await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: happy.rendered.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }))));
      uniform.push(JSON.stringify(await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: randomUUID(), environment: ENVIRONMENT, correlationId: randomUUID() }))));

      const cancelledSpace = await newSpace();
      const cancelledId = await transaction(async (deps) =>
        (await createInvitation(deps, ownerContext(cancelledSpace), createRequest(`cancel-${randomUUID().slice(0, 8)}@example.com`))).projection.invitationId);
      const cancelledDelivery = await delivery(cancelledId);
      await transaction(async (deps) => cancelInvitation(deps, ownerContext(cancelledSpace), cancelledId));
      uniform.push(JSON.stringify(await transaction(async (deps) =>
        resolveCode(deps, { presentedCode: cancelledDelivery.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }))));

      // R-02: the widened locator finds the dead code, so the restricted
      // TR-73-14 classes are reachable live and the abuse fingerprint is
      // stamped on the code row -- while the customer answer stays identical.
      assert.match(
        String(((await api.query("SELECT abuse_fingerprint FROM budget_space_invitation_code WHERE invitation_id = $1", [cancelledId]))
          .rows[0] as { abuse_fingerprint: string | null }).abuse_fingerprint),
        /^[0-9a-f]{64}$/u, "a located terminal record stamps the keyed fingerprint",
      );

      const [first, ...rest] = uniform;
      for (const answer of rest) assert.equal(answer, first, "every unusable link answers identically");
      assert.equal(first, JSON.stringify({ outcome: "unusable", messageCode: "MSG-73-003" }));

      // Replay: the same key returns the stored receipt and writes nothing new.
      const replay = await transaction(async (deps) =>
        confirmAcceptance(deps, owner, { invitationId: happy.invitationId, confirmationIdempotencyKey: "live-key-1" }));
      assert.deepEqual(replay, receipt);
      assert.equal(await countRows("budget_space_membership", "account_subject_id", invitee.subject), 1);
      assert.equal(await countRows("budget_space_consent", "account_subject_id", invitee.subject), 1);

      // Replacement: the predecessor's code and ceremonies die in one transaction.
      const replaceSpace = await newSpace();
      const replaceId = await transaction(async (deps) =>
        (await createInvitation(deps, ownerContext(replaceSpace), createRequest(`replace-${randomUUID().slice(0, 8)}@example.com`))).projection.invitationId);
      const replaceDelivery = await delivery(replaceId);
      await transaction(async (deps) => resolveCode(deps, { presentedCode: replaceDelivery.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }));
      const successor = await transaction(async (deps) => replaceInvitation(deps, ownerContext(replaceSpace), replaceId));
      const predecessor = (await api.query(
        "SELECT state, projection_state, successor_invitation_id FROM budget_space_invitation WHERE invitation_id = $1", [replaceId],
      )).rows[0] as Record<string, unknown>;
      assert.equal(predecessor.state, "superseded");
      assert.equal(predecessor.projection_state, "replaced");
      assert.equal(predecessor.successor_invitation_id, successor.projection.invitationId);
      assert.equal(
        ((await api.query("SELECT disposition FROM budget_space_invitation_code WHERE invitation_id = $1", [replaceId])).rows[0] as { disposition: string }).disposition,
        "invalidated",
      );
      assert.equal(
        ((await api.query("SELECT count(*)::int AS n FROM budget_space_invitation_ceremony WHERE invitation_id = $1 AND is_current", [replaceId])).rows[0] as { n: number }).n,
        0, "no ceremony of the predecessor is current",
      );
      // Exactly one usable version: the old bearer is dead, the new one resolves.
      assert.equal(
        (await transaction(async (deps) => resolveCode(deps, { presentedCode: replaceDelivery.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }))).outcome,
        "unusable",
      );
      const successorDelivery = await delivery(successor.projection.invitationId);
      assert.notEqual(successorDelivery.bearer, replaceDelivery.bearer);
      assert.equal(
        (await transaction(async (deps) => resolveCode(deps, { presentedCode: successorDelivery.bearer, environment: ENVIRONMENT, correlationId: randomUUID() }))).outcome,
        "resolved",
      );

      // Two concurrent confirms serialize: exactly one membership exists
      // afterwards, whatever each caller was told.
      const raceSpace = await newSpace();
      const raceInvitee = await newSubject("Concurrent");
      const race = await toAwaitingConfirmation(raceSpace, `race-${randomUUID().slice(0, 8)}@example.com`, raceInvitee);
      const attempts = await Promise.allSettled([
        transaction(async (deps) => confirmAcceptance(deps, ownerContext(raceSpace), { invitationId: race.invitationId, confirmationIdempotencyKey: "race-a" })),
        transaction(async (deps) => confirmAcceptance(deps, ownerContext(raceSpace), { invitationId: race.invitationId, confirmationIdempotencyKey: "race-b" })),
      ]);
      const fulfilled = attempts.filter((outcome) => outcome.status === "fulfilled");
      assert.equal(fulfilled.length, 1, "exactly one confirm commits");

      // R-07: name what the loser actually receives. Both transactions pass
      // every check and reach the membership insert, so the second most often
      // blocks on budget_space_membership_one_active_per_subject and receives
      // 23505 -> `conflict` rather than the `stale_version` the design names;
      // a serialization failure (`retryable_conflict`) is the other admitted
      // answer. PK-6 must treat all three the same way: re-read and replay
      // with the client's own idempotency key.
      const loser = attempts.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
      const loserCode = isInvitationError(loser.reason) ? loser.reason.code : String(loser.reason);
      assert.ok(
        ["conflict", "retryable_conflict", "stale_version"].includes(loserCode),
        `the loser's code is one of conflict, retryable_conflict or stale_version; got ${loserCode}`,
      );
      assert.equal(await countRows("budget_space_membership", "account_subject_id", raceInvitee.subject), 1);
      assert.equal(await countRows("budget_space_consent", "account_subject_id", raceInvitee.subject), 1);
      const committed = (fulfilled[0] as PromiseFulfilledResult<AcceptanceReceipt>).value;
      assert.equal(
        ((await api.query("SELECT accepted_membership_id FROM budget_space_invitation WHERE invitation_id = $1", [race.invitationId])).rows[0] as { accepted_membership_id: string }).accepted_membership_id,
        committed.membershipId,
      );
    }

    // =================================================================
    // (e) PK5-05: the application refuses the closed edge first, and the
    //     trigger refuses it independently.
    // =================================================================
    {
      assert.throws(() => assertInvitationEdge("accepted", "awaiting_confirmation"), (error: unknown) => isInvitationError(error, "invitation_not_current"));
      const connection = await api.connect();
      let sqlState: string | undefined;
      try {
        await connection.query("BEGIN");
        await connection.query(
          "UPDATE budget_space_invitation SET state = 'awaiting_confirmation', state_version = 1 + state_version WHERE invitation_id = $1",
          [happy.invitationId],
        );
        await connection.query("COMMIT");
      } catch (error) {
        sqlState = (error as { code?: string }).code;
        await connection.query("ROLLBACK").catch(() => undefined);
      } finally {
        connection.release();
      }
      assert.equal(sqlState, "23514", "the PK-2 trigger refuses the same edge on its own");
    }
  } finally {
    await admin.end();
    await api.end();
  }
});
