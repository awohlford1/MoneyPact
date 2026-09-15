/**
 * PROTO-INCREMENT-B-001, migration 20260914T190000Z against a live
 * PostgreSQL 17 (CBD-200, CBD-201; review findings F-REV-001, F-REV-002,
 * F-REV-003).
 *
 * A guard is not finished until a deliberate violation has failed it. This
 * suite breaks each of the two new triggers on purpose, watches the database
 * refuse with the SQLSTATE the migration documents, and then repeats the
 * legal shape of the same write to show the trigger admits it.
 *
 *   F-REV-001 / F-REV-002  a supersession stamp with no accompanying insert
 *                          rolls back at commit with 23514, both inside an
 *                          explicit transaction and under the autocommit
 *                          misuse the review named. Nothing is stamped.
 *   F-REV-003              an allocation appended to a version that is
 *                          already superseded is refused at INSERT with
 *                          55000, including the net-zero row the deferred
 *                          exact-sum trigger would otherwise have accepted.
 *
 * Opt-in exactly as increment-a.live.test.ts: it runs only against a scratch
 * database, never `cobudget_dev`, and never resets the database it is given.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";

/** The approved primary_owner_self v1 digest from config/consent-disclosure-registry.json, and the released p3 digest. */
const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";

const sqlState = (error: unknown): string | undefined =>
  (error as { code?: string }).code ?? (error as { sqlState?: string }).sqlState;

void test("20260914T190000Z live PostgreSQL: exactly one current version, and no allocation on history", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const api = createApiConnection();
  try {
    const subjectId = randomUUID();
    const profileId = randomUUID();
    const budgetSpaceId = randomUUID();
    const membershipId = randomUUID();
    const scheduleVersionId = randomUUID();
    const periodId = randomUUID();
    const categoryId = randomUUID();
    const categoryTwo = randomUUID();
    const accountId = randomUUID();
    const transactionId = randomUUID();
    const versionOne = randomUUID();

    const setup = await admin.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SET CONSTRAINTS ALL DEFERRED");
      await setup.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subjectId]);
      await setup.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [profileId, subjectId]);
      await setup.query(
        "INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version,"
        + " primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id)"
        + " VALUES ($1,$2,'America/New_York','2026a','USD','iso4217/2026',$3,$4,$4,$5,$6)",
        [budgetSpaceId, "increment-b " + budgetSpaceId.slice(0, 8), membershipId, scheduleVersionId, periodId, subjectId],
      );
      await setup.query(
        "INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)"
        + " VALUES ($1,$2,$3,$4,'primary_owner','active',$4)",
        [membershipId, budgetSpaceId, profileId, subjectId],
      );
      // CBD-236 (PROTO-CONSENT-LANDING-001): a membership without a current
      // consent row is refused at commit, so the fixture records the creator's
      // self-disclosure exactly as the confirmation ceremony does.
      await setup.query(
        "INSERT INTO budget_space_consent (consent_id, budget_space_id, membership_id, account_subject_id, role, resource_scope, source,"
        + " source_record_id, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest,"
        + " state, recorded_by_subject_id)"
        + " VALUES ($1,$2,$3,$4,'primary_owner','full','self_disclosure',$3,1,'primary_owner_self',1,$5,'p3',$6,'current',$4)",
        [randomUUID(), budgetSpaceId, membershipId, subjectId, DISCLOSURE_DIGEST, POLICY_DIGEST],
      );
      await setup.query(
        "INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest)"
        + " VALUES ($1,$2,1,'authoritative','{\"cadence\":\"monthly\",\"anchor\":{\"kind\":\"day\",\"day\":1}}','digest')",
        [scheduleVersionId, budgetSpaceId],
      );
      await setup.query(
        "INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date)"
        + " VALUES ($1,$2,$3,'active','2026-09-01','2026-09-30')",
        [periodId, budgetSpaceId, scheduleVersionId],
      );
      await setup.query("INSERT INTO budget_category (category_id, budget_space_id, label, position) VALUES ($1,$2,'Groceries',0)", [categoryId, budgetSpaceId]);
      await setup.query("INSERT INTO budget_category (category_id, budget_space_id, label, position) VALUES ($1,$2,'Transport',1)", [categoryTwo, budgetSpaceId]);
      await setup.query(
        "INSERT INTO financial_account (account_id, budget_space_id, origin, account_type, label, currency_code, minor_unit_precision,"
        + " opening_balance_minor_units, owner_subject_id, created_by_subject_id, version)"
        + " VALUES ($1,$2,'manual','checking','Everyday','USD',2,0,$3,$3,1)",
        [accountId, budgetSpaceId, subjectId],
      );
      // Revision 1: one live version with one allocation, committed.
      await setup.query(
        "INSERT INTO manual_transaction (transaction_version_id, transaction_id, budget_space_id, account_id, revision, currency_code,"
        + " minor_unit_precision, amount_minor_units, budget_date, period_id, period_start_date, period_end_date, recorded_by_subject_id)"
        + " VALUES ($1,$2,$3,$4,1,'USD',2,-1250,'2026-09-15',$5,'2026-09-01','2026-09-30',$6)",
        [versionOne, transactionId, budgetSpaceId, accountId, periodId, subjectId],
      );
      await setup.query(
        "INSERT INTO transaction_allocation (allocation_id, budget_space_id, transaction_version_id, category_id, currency_code, minor_unit_precision, amount_minor_units)"
        + " VALUES ($1,$2,$3,$4,'USD',2,-1250)",
        [randomUUID(), budgetSpaceId, versionOne, categoryId],
      );
      await setup.query("COMMIT");
    } catch (error) {
      await setup.query("ROLLBACK");
      throw error;
    } finally {
      setup.release();
    }

    const currentCount = async (): Promise<number> => {
      const found = await api.query(
        "SELECT count(*)::int AS n FROM manual_transaction WHERE budget_space_id = $1 AND transaction_id = $2 AND superseded_at IS NULL",
        [budgetSpaceId, transactionId],
      );
      return (found.rows[0] as { n: number }).n;
    };
    assert.equal(await currentCount(), 1, "the fixture starts with exactly one current version");

    // -----------------------------------------------------------------
    // F-REV-001 / F-REV-002, violation 1: an explicit transaction that
    // stamps the current version and inserts nothing. The deferred
    // constraint fires at COMMIT and the whole transaction rolls back.
    // -----------------------------------------------------------------
    const explicit = await api.connect();
    let explicitState: string | undefined;
    try {
      await explicit.query("BEGIN");
      await explicit.query("UPDATE manual_transaction SET superseded_at = now() WHERE transaction_version_id = $1", [versionOne]);
      await explicit.query("COMMIT");
    } catch (error) {
      explicitState = sqlState(error);
      await explicit.query("ROLLBACK");
    } finally {
      explicit.release();
    }
    assert.equal(explicitState, "23514", "F-REV-002: a stamp with no accompanying insert is refused at commit");
    assert.equal(await currentCount(), 1, "F-REV-002: the refused stamp left the identity with its current version");

    // -----------------------------------------------------------------
    // F-REV-001, violation 2: the autocommit misuse the review named --
    // the same UPDATE with no enclosing transaction. The implicit
    // transaction ends at statement end, so the deferred constraint fires
    // there and the stamp never commits.
    // -----------------------------------------------------------------
    await assert.rejects(
      () => api.query("UPDATE manual_transaction SET superseded_at = now() WHERE transaction_version_id = $1", [versionOne]),
      (error: unknown) => sqlState(error) === "23514",
      "F-REV-001: the autocommit stamp rolls back with 23514 instead of stranding the identity",
    );
    assert.equal(await currentCount(), 1, "F-REV-001: the identity is still readable, editable and removable");

    // -----------------------------------------------------------------
    // The legal shape of the same write: stamp and insert together.
    // -----------------------------------------------------------------
    const versionTwo = randomUUID();
    const edit = await api.connect();
    try {
      await edit.query("BEGIN");
      await edit.query("UPDATE manual_transaction SET superseded_at = now() WHERE transaction_version_id = $1", [versionOne]);
      await edit.query(
        "INSERT INTO manual_transaction (transaction_version_id, transaction_id, budget_space_id, account_id, revision, currency_code,"
        + " minor_unit_precision, amount_minor_units, budget_date, period_id, period_start_date, period_end_date, recorded_by_subject_id)"
        + " VALUES ($1,$2,$3,$4,2,'USD',2,-1250,'2026-09-15',$5,'2026-09-01','2026-09-30',$6)",
        [versionTwo, transactionId, budgetSpaceId, accountId, periodId, subjectId],
      );
      await edit.query(
        "INSERT INTO transaction_allocation (allocation_id, budget_space_id, transaction_version_id, category_id, currency_code, minor_unit_precision, amount_minor_units)"
        + " VALUES ($1,$2,$3,$4,'USD',2,-1250)",
        [randomUUID(), budgetSpaceId, versionTwo, categoryId],
      );
      await edit.query("COMMIT");
    } catch (error) {
      await edit.query("ROLLBACK");
      throw error;
    } finally {
      edit.release();
    }
    assert.equal(await currentCount(), 1, "the legal edit commits and leaves exactly one current version");

    // -----------------------------------------------------------------
    // F-REV-003: revision 1 is now history. An allocation appended to it
    // is refused at INSERT, including the net-zero row the deferred
    // exact-sum trigger would have accepted.
    // -----------------------------------------------------------------
    await assert.rejects(
      () => api.query(
        "INSERT INTO transaction_allocation (allocation_id, budget_space_id, transaction_version_id, category_id, currency_code, minor_unit_precision, amount_minor_units)"
        + " VALUES ($1,$2,$3,$4,'USD',2,0)",
        [randomUUID(), budgetSpaceId, versionOne, categoryTwo],
      ),
      (error: unknown) => sqlState(error) === "55000",
      "F-REV-003: a zero-amount allocation cannot be appended to a superseded version",
    );
    const pair = await api.connect();
    let pairState: string | undefined;
    try {
      await pair.query("BEGIN");
      await pair.query(
        "INSERT INTO transaction_allocation (allocation_id, budget_space_id, transaction_version_id, category_id, currency_code, minor_unit_precision, amount_minor_units)"
        + " VALUES ($1,$2,$3,$4,'USD',2,500)",
        [randomUUID(), budgetSpaceId, versionOne, categoryTwo],
      );
      await pair.query("COMMIT");
    } catch (error) {
      pairState = sqlState(error);
      await pair.query("ROLLBACK");
    } finally {
      pair.release();
    }
    assert.equal(pairState, "55000", "F-REV-003: the first half of a net-zero pair is refused before the pair can be completed");

    const historic = await api.query("SELECT count(*)::int AS n FROM transaction_allocation WHERE transaction_version_id = $1", [versionOne]);
    assert.equal((historic.rows[0] as { n: number }).n, 1, "F-REV-003: the historical detail set is unchanged");

    // The live version still accepts an allocation, so the trigger refuses
    // history rather than insertion as such.
    const live = await api.connect();
    try {
      await live.query("BEGIN");
      await live.query(
        "INSERT INTO transaction_allocation (allocation_id, budget_space_id, transaction_version_id, category_id, currency_code, minor_unit_precision, amount_minor_units)"
        + " VALUES ($1,$2,$3,$4,'USD',2,-500)",
        [randomUUID(), budgetSpaceId, versionTwo, categoryTwo],
      );
      // Rolled back on purpose: the point is that the INSERT itself was admitted.
      await live.query("ROLLBACK");
    } finally {
      live.release();
    }
  } finally {
    await admin.end();
    await api.end();
  }
});
