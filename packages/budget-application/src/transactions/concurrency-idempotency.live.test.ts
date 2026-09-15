/**
 * PROTO-CBD200-CONCURRENCY-IDEMPOTENCY-001 against a live PostgreSQL 17
 * (CBD-200-AC04, CBD-200-AC05; migration 20260915T140000Z).
 *
 * What the unit suites cannot prove, proved here over the real statements:
 *
 *   AC04  two serializable transactions supersede one current version; the
 *         loser is refused at its own statement and the adapter reports it
 *         as `conflict`; exactly one version is written. The commit-time
 *         one-current-version refusal arrives through the transaction seam
 *         as a commit-phase StatementFailedError carrying SQLSTATE 23514
 *         AND the constraint name the migration stamps on it, which is what
 *         the API's store maps to 409 conflict. A different 23514 at commit
 *         (the exact-sum trigger) carries a different name.
 *   AC05  the idempotency row commits with the version it names and reads
 *         back through the repository; a second row under the same scope is
 *         a unique violation (`conflict`); the row can be neither updated
 *         (23514, named) nor deleted by the API role (42501); a row naming a
 *         version that never commits does not commit either.
 *
 * Opt-in exactly as ../persistence/increment-a.live.test.ts: it runs only
 * against a scratch database, never `cobudget_dev`, and never resets the
 * database it is given. Raw fixture rows stamp created_at from the fixture
 * clock so the check constraints compare like with like.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";

import { bindClient } from "../../../data-access/src/binding.ts";
import { PRODUCTION_TABLE_CATALOG } from "../../../data-access/src/catalog.ts";
import { StatementFailedError } from "../../../data-access/src/logging.ts";
import { financialAccountStatements } from "../../../data-access/src/financial-account.ts";
import { manualTransactionStatements } from "../../../data-access/src/manual-transaction.ts";
import { manualTransactionIdempotencyStatements } from "../../../data-access/src/manual-transaction-idempotency.ts";
import { transactionAllocationStatements } from "../../../data-access/src/transaction-allocation.ts";
import { budgetCategoryStatements } from "../../../data-access/src/budget-category.ts";
import {
  TransactionError,
  createManualTransaction,
  dataAccessTransactionsRepository,
  editManualTransaction,
  parseTransactionWriteRequest,
  transactionRequestDigest,
} from "./index.ts";
import type { TransactionStatements, TransactionsDependencies } from "./index.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";
const NOW = "2026-09-15T12:00:00.000Z";
const LATER = "2026-09-15T12:30:00.000Z";

const DISCLOSURE_DIGEST = "093f199283c75721e1d197bbe7c64452e3689715a0a1470a1fe557c805421e34";
const POLICY_DIGEST = "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d";

const sqlState = (error: unknown): string | undefined => (error as { code?: string }).code ?? (error as { sqlState?: string }).sqlState;

void test("CBD-200-AC04/AC05 live PostgreSQL: concurrent supersession, the named commit refusal, and the idempotency scope", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const api = createApiConnection();
  try {
    const client = bindClient(api, true, PRODUCTION_TABLE_CATALOG);
    const subjectId = randomUUID(); const profileId = randomUUID(); const budgetSpaceId = randomUUID(); const membershipId = randomUUID();
    const scheduleVersionId = randomUUID(); const periodId = randomUUID(); const categoryId = randomUUID(); const accountId = randomUUID();

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
        [budgetSpaceId, "cbd200 " + budgetSpaceId.slice(0, 8), membershipId, scheduleVersionId, periodId, subjectId],
      );
      await setup.query(
        "INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)"
        + " VALUES ($1,$2,$3,$4,'primary_owner','active',$4)",
        [membershipId, budgetSpaceId, profileId, subjectId],
      );
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
      await setup.query(
        "INSERT INTO financial_account (account_id, budget_space_id, origin, account_type, label, currency_code, minor_unit_precision,"
        + " opening_balance_minor_units, owner_subject_id, created_by_subject_id, version, created_at, updated_at)"
        + " VALUES ($1,$2,'manual','checking','Everyday','USD',2,0,$3,$3,1,$4,$4)",
        [accountId, budgetSpaceId, subjectId, NOW],
      );
      await setup.query("COMMIT");
    } catch (error) { await setup.query("ROLLBACK"); throw error; } finally { setup.release(); }

    type TenantClient = Parameters<typeof financialAccountStatements>[0];
    let clock = NOW;
    const depsFor = (scoped: TenantClient): TransactionsDependencies => {
      const accounts = financialAccountStatements(scoped); const manual = manualTransactionStatements(scoped);
      const allocations = transactionAllocationStatements(scoped); const categories = budgetCategoryStatements(scoped);
      const idempotency = manualTransactionIdempotencyStatements(scoped);
      const statements: TransactionStatements = {
        listPeriods: (space) => manual.listPeriods(space),
        readAccount: (space, id) => accounts.readAccount(space, id),
        listCategories: async (space) => (await categories.listCategories(space)).map((row) => ({ category_id: row.category_id, budget_space_id: row.budget_space_id, archived_at: row.archived_at })),
        listTransactionVersions: (space, transactionId) => manual.listTransactionVersions(space, transactionId),
        listTransactionsByPeriod: (space, id) => manual.listTransactionsByPeriod(space, id),
        listAllocations: (space, versionId) => allocations.listAllocations(space, versionId),
        insertTransaction: (row) => manual.insertTransaction(row),
        insertAllocation: (row) => allocations.insertAllocation(row),
        supersedeTransaction: (space, versionId, at) => manual.supersedeTransaction(space, versionId, at),
        readIdempotency: (scope) => idempotency.readIdempotency(scope),
        insertIdempotency: (row) => idempotency.insertIdempotency(row),
      };
      return { repository: dataAccessTransactionsRepository(statements), clock: { now: () => clock }, ids: { uuid: () => randomUUID() } };
    };
    const write = (amount: number) => parseTransactionWriteRequest({ accountId, amountMinorUnits: amount, budgetDate: "2026-09-15", description: "live " + amount, allocations: [{ categoryId, amountMinorUnits: amount }] });
    const versionsOf = async (transactionId: string) => (await client.tenantSelect({ table: "manual_transaction", budgetSpaceId, columns: ["transaction_version_id", "revision", "superseded_at"], conditions: [{ column: "transaction_id", value: transactionId }] })).rows as { transaction_version_id: string; revision: number; superseded_at: string | null }[];

    // -----------------------------------------------------------------
    // AC05: the first attempt commits the version and its idempotency row
    // together; the row reads back through the repository outside any
    // transaction, bound to the version.
    // -----------------------------------------------------------------
    const scope = { budgetSpaceId, membershipId, action: "create" as const, idempotencyKey: "live-" + randomUUID() };
    const digest = transactionRequestDigest("create", { budgetSpaceId, transactionId: null }, write(-1_250), null);
    const created = await client.transaction({ isolation: "serializable" }, async (tx) => {
      const deps = depsFor(tx);
      const result = await createManualTransaction(deps, budgetSpaceId, subjectId, write(-1_250));
      await deps.repository.recordIdempotency({ ...scope, requestDigest: digest, transactionVersionId: result.current.version.transactionVersionId, committedResponse: result, createdAt: NOW });
      return result;
    });
    const transactionId = created.current.version.transactionId;
    const stored = await depsFor(client).repository.readIdempotency(scope);
    assert.ok(stored, "AC05: the committed row is readable outside the transaction");
    assert.equal(stored.requestDigest, digest);
    assert.equal(stored.transactionVersionId, created.current.version.transactionVersionId);
    assert.deepEqual(stored.committedResponse, JSON.parse(JSON.stringify(created)), "the stored response is the one the route returned");
    assert.equal(await depsFor(client).repository.readIdempotency({ ...scope, action: "edit" }), null);
    assert.equal(await depsFor(client).repository.readIdempotency({ ...scope, membershipId: randomUUID() }), null);

    // A second first-attempt under the same scope is the unique violation, as `conflict`, and writes no version.
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (tx) => {
        const deps = depsFor(tx);
        const result = await createManualTransaction(deps, budgetSpaceId, subjectId, write(-1_250));
        await deps.repository.recordIdempotency({ ...scope, requestDigest: digest, transactionVersionId: result.current.version.transactionVersionId, committedResponse: result, createdAt: NOW });
      }),
      (error: unknown) => error instanceof TransactionError && error.code === "conflict",
    );
    assert.equal((await client.tenantSelect({ table: "manual_transaction", budgetSpaceId })).rowCount, 1, "AC05: the refused second attempt committed nothing");
    // A row naming a version that never commits does not commit either (deferred reference).
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (tx) => {
        await depsFor(tx).repository.recordIdempotency({ ...scope, idempotencyKey: "orphan-" + randomUUID(), requestDigest: digest, transactionVersionId: randomUUID(), committedResponse: created, createdAt: NOW });
      }),
      (error: unknown) => error instanceof StatementFailedError && error.operation === "commit" && error.sqlState === "23503",
    );
    // Append-only: no UPDATE (named), no DELETE for the API role.
    await assert.rejects(
      client.tenantUpdate({ table: "manual_transaction_idempotency", budgetSpaceId, set: { request_digest: "0".repeat(64) }, conditions: [{ column: "idempotency_key", value: scope.idempotencyKey }] }),
      (error: unknown) => error instanceof StatementFailedError && error.sqlState === "23514" && error.constraint === "manual_transaction_idempotency_append_only",
    );
    await assert.rejects(
      client.tenantDelete({ table: "manual_transaction_idempotency", budgetSpaceId, conditions: [{ column: "idempotency_key", value: scope.idempotencyKey }] }),
      (error: unknown) => sqlState(error) === "42501",
    );

    // -----------------------------------------------------------------
    // AC04: two serializable transactions edit the same current version.
    // Both read revision 1; the first to stamp holds the row; the second
    // blocks at its UPDATE and, once the first commits, is refused there
    // with a serialization failure, which the adapter reports as
    // `conflict`. One version is written.
    // -----------------------------------------------------------------
    clock = LATER;
    let release: () => void = () => undefined;
    const firstStamped = new Promise<void>((resolve) => { release = resolve; });
    let secondStarted: () => void = () => undefined;
    const secondReading = new Promise<void>((resolve) => { secondStarted = resolve; });
    const winner = client.transaction({ isolation: "serializable" }, async (tx) => {
      const deps = depsFor(tx);
      // Take the snapshot, then let the loser take its own before this transaction writes.
      await deps.repository.listVersions(budgetSpaceId, transactionId);
      await secondReading;
      const result = await editManualTransaction(deps, budgetSpaceId, transactionId, subjectId, write(-900));
      release();
      // Hold the row lock long enough for the loser to block on it.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return result;
    });
    const loser = client.transaction({ isolation: "serializable" }, async (tx) => {
      const deps = depsFor(tx);
      await deps.repository.listVersions(budgetSpaceId, transactionId);
      secondStarted();
      await firstStamped;
      return editManualTransaction(deps, budgetSpaceId, transactionId, subjectId, write(-700));
    });
    const [won, lost] = await Promise.allSettled([winner, loser]);
    assert.equal(won.status, "fulfilled", "AC04: the first writer commits");
    assert.equal(lost.status, "rejected", "AC04: the concurrent writer is refused");
    assert.ok(lost.status === "rejected" && lost.reason instanceof TransactionError && lost.reason.code === "conflict", "AC04: the refusal is the canonical conflict, not an untranslated driver error");
    const afterRace = await versionsOf(transactionId);
    assert.equal(afterRace.length, 2, "AC04: exactly one version was written by the race");
    assert.equal(afterRace.filter((v) => v.superseded_at === null).length, 1);
    assert.deepEqual(afterRace.map((v) => v.revision).sort(), [1, 2]);

    // -----------------------------------------------------------------
    // AC04, the commit-time refusal the Executive decision names: a stamp
    // with no accompanying insert is refused when the transaction ends,
    // and arrives through the seam as a commit-phase failure carrying both
    // the SQLSTATE and the constraint name (20260915T140000Z). The
    // exact-sum trigger's own 23514 does not carry that name.
    // -----------------------------------------------------------------
    const current = afterRace.find((v) => v.superseded_at === null)!;
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (tx) => {
        await manualTransactionStatements(tx).supersedeTransaction(budgetSpaceId, current.transaction_version_id, LATER);
      }),
      (error: unknown) => error instanceof StatementFailedError && error.operation === "commit" && error.sqlState === "23514" && error.constraint === "manual_transaction_assert_one_current",
      "the one-current-version refusal is identifiable by name at commit",
    );
    assert.equal((await versionsOf(transactionId)).filter((v) => v.superseded_at === null).length, 1, "nothing was stamped");
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (tx) => {
        const versionId = randomUUID();
        await tx.tenantInsert({ table: "manual_transaction", budgetSpaceId, values: {
          transaction_version_id: versionId, transaction_id: randomUUID(), account_id: accountId, revision: 1, origin: "manual", settlement_state: "settled",
          currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -1_000, budget_date: "2026-09-10", period_id: periodId,
          period_start_date: "2026-09-01", period_end_date: "2026-09-30", recorded_by_subject_id: subjectId, source: "user", created_at: NOW } });
        await tx.tenantInsert({ table: "transaction_allocation", budgetSpaceId, values: {
          allocation_id: randomUUID(), transaction_version_id: versionId, category_id: categoryId, currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -999 } });
      }),
      (error: unknown) => error instanceof StatementFailedError && error.operation === "commit" && error.sqlState === "23514" && error.constraint !== "manual_transaction_assert_one_current",
      "a different deferred 23514 is not the one-current-version refusal",
    );
  } finally {
    await api.end();
    await admin.end();
  }
});
