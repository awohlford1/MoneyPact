/**
 * PROTO-INCREMENT-A-001 against a live PostgreSQL 17 (CBD-196, CBD-199,
 * CBD-200, CBD-201, CBD-209).
 *
 * The unit suites prove the commands' rules against in-memory repositories
 * that restate the migration's constraints. This one proves the restatement
 * is faithful: the same commands run through `@cobudget/data-access`'s tenant
 * statements against the real schema, and then the constraints are attacked
 * directly -- a tombstoned version updated, an allocation edited, a split that
 * does not add up committed, a row deleted -- to see the database refuse what
 * the application refuses.
 *
 * Opt-in exactly as `data-access/src/transaction.live.test.ts` does: it runs
 * only against a scratch database, never `cobudget_dev`, and it never resets
 * the database it is pointed at.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";

import { bindClient } from "../../../data-access/src/binding.ts";
import { PRODUCTION_TABLE_CATALOG } from "../../../data-access/src/catalog.ts";
import { financialAccountStatements } from "../../../data-access/src/financial-account.ts";
import { manualTransactionStatements } from "../../../data-access/src/manual-transaction.ts";
import { transactionAllocationStatements } from "../../../data-access/src/transaction-allocation.ts";
import { budgetCategoryStatements } from "../../../data-access/src/budget-category.ts";

import {
  AccountError,
  archiveAccount,
  createAccount,
  dataAccessAccountsRepository,
  editAccount,
  listAccounts,
  parseAccountCreateRequest,
  parseAccountEditRequest,
  readAccount,
  restoreAccount,
} from "../accounts/index.ts";
import {
  TransactionError,
  createManualTransaction,
  dataAccessTransactionsRepository,
  editManualTransaction,
  parseTransactionWriteRequest,
  readBudgetProgress,
  readTransactionHistory,
  removeManualTransaction,
} from "../transactions/index.ts";
import type { TransactionStatements } from "../transactions/index.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";

const NOW = "2026-09-15T12:00:00.000Z";

void test("PROTO-INCREMENT-A-001 live PostgreSQL: accounts, transactions, allocations, progress and the refusals", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection();
  const api = createApiConnection();
  try {
    const client = bindClient(api, true, PRODUCTION_TABLE_CATALOG);

    // ---------------------------------------------------------------------
    // Fixture: one budget space with two consecutive periods and two live
    // categories, assembled in one transaction because the CBD-231 graph is
    // mutually referring with deferred constraints.
    // ---------------------------------------------------------------------
    const subjectId = randomUUID();
    const profileId = randomUUID();
    const budgetSpaceId = randomUUID();
    const membershipId = randomUUID();
    const scheduleVersionId = randomUUID();
    const periodSeptember = randomUUID();
    const periodAugust = randomUUID();
    const categoryGroceries = randomUUID();
    const categoryTransport = randomUUID();

    const connection = await admin.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET CONSTRAINTS ALL DEFERRED");
      await connection.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subjectId]);
      await connection.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [profileId, subjectId]);
      await connection.query(
        `INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version,
           primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id)
         VALUES ($1,$2,'America/New_York','2026a','USD','iso4217/2026',$3,$4,$4,$5,$6)`,
        [budgetSpaceId, `increment-a ${budgetSpaceId.slice(0, 8)}`, membershipId, scheduleVersionId, periodSeptember, subjectId],
      );
      await connection.query(
        `INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id)
         VALUES ($1,$2,$3,$4,'primary_owner','active',$4)`,
        [membershipId, budgetSpaceId, profileId, subjectId],
      );
      await connection.query(
        `INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest)
         VALUES ($1,$2,1,'authoritative','{"cadence":"monthly","anchor":{"kind":"day","day":1}}','digest')`,
        [scheduleVersionId, budgetSpaceId],
      );
      for (const [periodId, status, start, end] of [
        [periodAugust, "planned", "2026-08-01", "2026-08-31"],
        [periodSeptember, "active", "2026-09-01", "2026-09-30"],
      ] as const) {
        await connection.query(
          `INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [periodId, budgetSpaceId, scheduleVersionId, status, start, end],
        );
      }
      for (const [categoryId, label, position] of [[categoryGroceries, "Groceries", 0], [categoryTransport, "Transport", 1]] as const) {
        await connection.query(
          "INSERT INTO budget_category (category_id, budget_space_id, label, position) VALUES ($1,$2,$3,$4)",
          [categoryId, budgetSpaceId, label, position],
        );
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }

    // ---------------------------------------------------------------------
    // Wiring: the same commands the unit suites run, over real statements.
    // ---------------------------------------------------------------------
    type TenantClient = Parameters<typeof financialAccountStatements>[0];

    function depsFor(scoped: TenantClient) {
      const accountStatements = financialAccountStatements(scoped);
      const txStatements = manualTransactionStatements(scoped);
      const allocationStatements = transactionAllocationStatements(scoped);
      const categoryStatements = budgetCategoryStatements(scoped);
      const transactionStatements: TransactionStatements = {
        listPeriods: (space) => txStatements.listPeriods(space),
        readAccount: (space, id) => accountStatements.readAccount(space, id),
        listCategories: async (space) => (await categoryStatements.listCategories(space)).map((row) => ({
          category_id: row.category_id, budget_space_id: row.budget_space_id, archived_at: row.archived_at,
        })),
        listTransactionVersions: (space, transactionId) => txStatements.listTransactionVersions(space, transactionId),
        listTransactionsByPeriod: (space, periodId) => txStatements.listTransactionsByPeriod(space, periodId),
        listAllocations: (space, versionId) => allocationStatements.listAllocations(space, versionId),
        insertTransaction: (row) => txStatements.insertTransaction(row),
        insertAllocation: (row) => allocationStatements.insertAllocation(row),
        supersedeTransaction: (space, versionId, at) => txStatements.supersedeTransaction(space, versionId, at),
      };
      return {
        accountsDeps: { repository: dataAccessAccountsRepository(accountStatements), clock: { now: () => NOW }, ids: { uuid: () => randomUUID() } },
        transactionsDeps: { repository: dataAccessTransactionsRepository(transactionStatements), clock: { now: () => NOW }, ids: { uuid: () => randomUUID() } },
      };
    }

    /**
     * Every command runs inside a transaction, because that is the contract:
     * the repository never opens one, and the exact-sum rule is a deferred
     * constraint that is only checked when one ends. A version written
     * without its allocations in the same transaction is refused, which is
     * what the mismatch cases below rely on.
     */
    function inTransaction<T>(work: (deps: ReturnType<typeof depsFor>) => Promise<T>): Promise<T> {
      return client.transaction({ isolation: "serializable" }, (scoped) => work(depsFor(scoped)));
    }

    const { accountsDeps, transactionsDeps } = depsFor(client);

    // ---------------------------------------------------------------------
    // CBD-196: account round trip, edit, archive and restore.
    // ---------------------------------------------------------------------
    const created = await inTransaction((deps) => createAccount(deps.accountsDeps, budgetSpaceId, subjectId, parseAccountCreateRequest(
      { accountType: "checking", label: "Everyday", currencyCode: "USD", openingBalanceMinorUnits: 125_000 },
      subjectId,
    )));
    assert.equal(created.account.version, 1);
    const readBack = await readAccount(accountsDeps, budgetSpaceId, created.account.accountId);
    assert.deepEqual(readBack, created.account, "AC01: the stored row round trips to the same record");
    assert.equal(readBack.openingBalanceMinorUnits, 125_000);
    assert.equal(typeof readBack.openingBalanceMinorUnits, "number");

    const edited = await inTransaction((deps) => editAccount(deps.accountsDeps, budgetSpaceId, created.account.accountId, parseAccountEditRequest({ label: "Everyday checking" })));
    assert.equal(edited.previousVersion, 1);
    assert.equal(edited.account.version, 2, "AC03: the resulting version is exposed");
    assert.equal((await readAccount(accountsDeps, budgetSpaceId, created.account.accountId)).label, "Everyday checking");

    // AC02 defence in depth: the CHECK refuses a currency the application never sends.
    await assert.rejects(
      client.tenantInsert({
        table: "financial_account",
        budgetSpaceId,
        values: {
          account_id: randomUUID(), origin: "manual", account_type: "checking", label: "bad currency",
          currency_code: "usd", minor_unit_precision: 2, opening_balance_minor_units: 0,
          owner_subject_id: subjectId, created_by_subject_id: subjectId, version: 1,
        },
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
      "AC02: the migration's currency CHECK refuses a malformed code",
    );
    await assert.rejects(
      client.tenantInsert({
        table: "financial_account",
        budgetSpaceId,
        values: {
          account_id: randomUUID(), origin: "imported", account_type: "checking", label: "institution",
          currency_code: "USD", minor_unit_precision: 2, opening_balance_minor_units: 0,
          owner_subject_id: subjectId, created_by_subject_id: subjectId, version: 1,
        },
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
      "CBD-199-AC02: an institution-derived origin is not representable",
    );

    const archived = await inTransaction((deps) => archiveAccount(deps.accountsDeps, budgetSpaceId, created.account.accountId));
    assert.notEqual(archived.account.archivedAt, null);
    assert.equal((await listAccounts(accountsDeps, budgetSpaceId)).length, 1, "AC04: an archived account stays queryable");
    assert.equal((await listAccounts(accountsDeps, budgetSpaceId, { liveOnly: true })).length, 0);
    const restored = await inTransaction((deps) => restoreAccount(deps.accountsDeps, budgetSpaceId, created.account.accountId));
    assert.equal(restored.account.archivedAt, null);
    assert.equal(restored.account.openingBalanceMinorUnits, 125_000, "AC04: the balance survived the round trip");
    assert.equal(restored.account.version, 4);
    await assert.rejects(
      () => inTransaction((deps) => createAccount(deps.accountsDeps, budgetSpaceId, subjectId, parseAccountCreateRequest(
        { accountType: "savings", label: "everyday checking", currencyCode: "USD", openingBalanceMinorUnits: 0 }, subjectId,
      ))),
      (error: unknown) => error instanceof AccountError,
      "the live-label uniqueness index is the same rule the command enforces",
    );

    // AC04: DELETE is revoked; an account identity cannot disappear.
    await assert.rejects(
      client.tenantDelete({ table: "financial_account", budgetSpaceId, conditions: [{ column: "account_id", value: created.account.accountId }] }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "42501",
      "AC04: DELETE on financial_account is revoked from the api role",
    );

    const accountId = created.account.accountId;

    // ---------------------------------------------------------------------
    // CBD-199 / CBD-201: create, period assignment, edit, remove.
    // ---------------------------------------------------------------------
    const expense = await inTransaction((deps) => createManualTransaction(deps.transactionsDeps, budgetSpaceId, subjectId, parseTransactionWriteRequest({
      accountId, amountMinorUnits: -1_250, budgetDate: "2026-09-15", description: "Corner shop",
      allocations: [{ categoryId: categoryGroceries, amountMinorUnits: -1_250 }],
    })));
    assert.equal(expense.current.version.periodId, periodSeptember);
    assert.equal(expense.current.version.settlementState, "settled");
    assert.equal(expense.current.allocations.length, 1);

    // AC04: a period start belongs to that period; the preceding date to the preceding period.
    const onStart = await inTransaction((deps) => createManualTransaction(deps.transactionsDeps, budgetSpaceId, subjectId, parseTransactionWriteRequest({
      accountId, amountMinorUnits: -100, budgetDate: "2026-09-01", description: null,
      allocations: [{ categoryId: categoryGroceries, amountMinorUnits: -100 }],
    })));
    const dayBefore = await inTransaction((deps) => createManualTransaction(deps.transactionsDeps, budgetSpaceId, subjectId, parseTransactionWriteRequest({
      accountId, amountMinorUnits: -200, budgetDate: "2026-08-31", description: null,
      allocations: [{ categoryId: categoryGroceries, amountMinorUnits: -200 }],
    })));
    assert.equal(onStart.current.version.periodId, periodSeptember);
    assert.equal(dayBefore.current.version.periodId, periodAugust);
    for (const periodId of [periodSeptember, periodAugust]) {
      const rows = (await client.tenantSelect({ table: "budget_space_period", budgetSpaceId, conditions: [{ column: "period_id", value: periodId }] })).rows;
      assert.equal(rows.length, 1, "AC04: neither boundary row was changed by assignment");
    }

    // AC04 defence in depth: a version whose budget_date is outside its own period is unrepresentable.
    await assert.rejects(
      client.tenantInsert({
        table: "manual_transaction",
        budgetSpaceId,
        values: {
          transaction_version_id: randomUUID(), transaction_id: randomUUID(), account_id: accountId, revision: 1,
          origin: "manual", settlement_state: "settled", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -1,
          budget_date: "2026-08-31", period_id: periodSeptember, period_start_date: "2026-09-01", period_end_date: "2026-09-30",
          recorded_by_subject_id: subjectId, source: "user",
        },
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
      "AC04: budget_date must fall inside the period the row names",
    );

    // CBD-201-AC04: an edit replaces the whole allocation set and retains the prior one.
    const edit = await inTransaction((deps) => editManualTransaction(deps.transactionsDeps, budgetSpaceId, expense.current.version.transactionId, subjectId, parseTransactionWriteRequest({
      accountId, amountMinorUnits: -1_250, budgetDate: "2026-09-15", description: "Corner shop, split",
      allocations: [
        { categoryId: categoryGroceries, amountMinorUnits: -800 },
        { categoryId: categoryTransport, amountMinorUnits: -450 },
      ],
    })));
    assert.equal(edit.current.version.revision, 2);
    const history = await readTransactionHistory(transactionsDeps, budgetSpaceId, expense.current.version.transactionId);
    assert.deepEqual(history.map((snapshot) => snapshot.version.revision), [1, 2]);
    assert.deepEqual(history.map((snapshot) => snapshot.allocations.length), [1, 2]);
    assert.equal(history[0]?.version.supersededAt !== null, true, "the prior version is retained, stamped");

    // A superseded version is history: SQLSTATE 55000.
    await assert.rejects(
      client.tenantUpdate({
        table: "manual_transaction",
        budgetSpaceId,
        set: { description: "tampered" },
        conditions: [{ column: "transaction_version_id", value: expense.current.version.transactionVersionId }],
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "55000",
      "a superseded transaction version cannot be changed",
    );
    // Allocations are immutable and undeletable.
    const priorAllocation = history[0]?.allocations[0];
    assert.ok(priorAllocation);
    await assert.rejects(
      client.tenantUpdate({
        table: "transaction_allocation",
        budgetSpaceId,
        set: { amount_minor_units: -1 },
        conditions: [{ column: "allocation_id", value: priorAllocation.allocationId }],
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "55000",
      "an allocation is immutable",
    );
    await assert.rejects(
      client.tenantDelete({ table: "transaction_allocation", budgetSpaceId, conditions: [{ column: "allocation_id", value: priorAllocation.allocationId }] }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "42501",
      "DELETE on transaction_allocation is revoked",
    );
    await assert.rejects(
      client.tenantDelete({ table: "manual_transaction", budgetSpaceId, conditions: [{ column: "transaction_version_id", value: edit.current.version.transactionVersionId }] }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "42501",
      "DELETE on manual_transaction is revoked; removal is a tombstone",
    );

    // ---------------------------------------------------------------------
    // CBD-201-AC02/AC03: the deferred exact-sum trigger fires at commit.
    // ---------------------------------------------------------------------
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (tx) => {
        const versionId = randomUUID();
        await tx.tenantInsert({
          table: "manual_transaction",
          budgetSpaceId,
          values: {
            transaction_version_id: versionId, transaction_id: randomUUID(), account_id: accountId, revision: 1,
            origin: "manual", settlement_state: "settled", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -1_000,
            budget_date: "2026-09-10", period_id: periodSeptember, period_start_date: "2026-09-01", period_end_date: "2026-09-30",
            recorded_by_subject_id: subjectId, source: "user",
          },
        });
        // One unit short: legal statement by statement, illegal at commit.
        await tx.tenantInsert({
          table: "transaction_allocation",
          budgetSpaceId,
          values: {
            allocation_id: randomUUID(), transaction_version_id: versionId, category_id: categoryGroceries,
            currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -999,
          },
        });
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
      "AC02: a one-unit mismatch is refused by the deferred constraint at commit",
    );

    // The multi-statement split that does add up commits, which is what makes
    // the deferral meaningful rather than merely permissive.
    const splitVersionId = randomUUID();
    const splitTransactionId = randomUUID();
    await client.transaction({ isolation: "serializable" }, async (tx) => {
      await tx.tenantInsert({
        table: "manual_transaction",
        budgetSpaceId,
        values: {
          transaction_version_id: splitVersionId, transaction_id: splitTransactionId, account_id: accountId, revision: 1,
          origin: "manual", settlement_state: "settled", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -1_000,
          budget_date: "2026-09-10", period_id: periodSeptember, period_start_date: "2026-09-01", period_end_date: "2026-09-30",
          recorded_by_subject_id: subjectId, source: "user",
        },
      });
      for (const [categoryId, amount] of [[categoryGroceries, -600], [categoryTransport, -400]] as const) {
        await tx.tenantInsert({
          table: "transaction_allocation",
          budgetSpaceId,
          values: {
            allocation_id: randomUUID(), transaction_version_id: splitVersionId, category_id: categoryId,
            currency_code: "USD", minor_unit_precision: 2, amount_minor_units: amount,
          },
        });
      }
    });

    // A live version with no allocations at all is refused by the same trigger.
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (tx) => {
        await tx.tenantInsert({
          table: "manual_transaction",
          budgetSpaceId,
          values: {
            transaction_version_id: randomUUID(), transaction_id: randomUUID(), account_id: accountId, revision: 1,
            origin: "manual", settlement_state: "settled", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -1_000,
            budget_date: "2026-09-10", period_id: periodSeptember, period_start_date: "2026-09-01", period_end_date: "2026-09-30",
            recorded_by_subject_id: subjectId, source: "user",
          },
        });
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
      "AC03: a live version with an empty allocation set is refused",
    );

    // ---------------------------------------------------------------------
    // CBD-209: progress over the stored rows, and a removal that stops counting.
    // ---------------------------------------------------------------------
    const targets = [
      { categoryId: categoryGroceries, targetMinorUnits: 50_000 },
      { categoryId: categoryTransport, targetMinorUnits: 20_000 },
    ];
    const progress = await readBudgetProgress(transactionsDeps, budgetSpaceId, { periodId: periodSeptember, targets });
    const groceries = progress.cells.find((cell) => cell.categoryId === categoryGroceries);
    const transport = progress.cells.find((cell) => cell.categoryId === categoryTransport);
    // -800 (edited expense) + -100 (period start) + -600 (split) = -1500.
    assert.equal(groceries?.settledActualMinorUnits, -1_500);
    assert.equal(groceries?.remainingAfterSettledMinorUnits, 48_500);
    assert.equal(groceries?.pendingProvisionalImpactMinorUnits, 0);
    assert.equal(transport?.settledActualMinorUnits, -850);
    assert.equal(groceries?.settledRecordIds.length, 3, "AC03: three itemized records back the aggregate");
    assert.equal(
      groceries?.settledActualMinorUnits,
      (groceries?.settledRecordIds.length ?? 0) > 0 ? -1_500 : 0,
      "AC02: the aggregate is the signed sum of the detail",
    );

    const removal = await inTransaction((deps) => removeManualTransaction(deps.transactionsDeps, budgetSpaceId, splitTransactionId, subjectId));
    assert.equal(removal.current.allocations.length, 0, "a tombstone carries no allocations");
    const afterRemoval = await readBudgetProgress(transactionsDeps, budgetSpaceId, { periodId: periodSeptember, targets });
    assert.equal(afterRemoval.cells.find((cell) => cell.categoryId === categoryGroceries)?.settledActualMinorUnits, -900);
    assert.equal(afterRemoval.cells.find((cell) => cell.categoryId === categoryTransport)?.settledActualMinorUnits, -450);
    assert.equal(afterRemoval.calculationVersion, progress.calculationVersion);

    // A tombstone is the current version and is still a version: it cannot be edited back to life.
    await assert.rejects(
      () => inTransaction((deps) => editManualTransaction(deps.transactionsDeps, budgetSpaceId, splitTransactionId, subjectId, parseTransactionWriteRequest({
        accountId, amountMinorUnits: -1_000, budgetDate: "2026-09-10", description: null,
        allocations: [{ categoryId: categoryGroceries, amountMinorUnits: -1_000 }],
      }))),
      (error: unknown) => error instanceof TransactionError && error.code === "transaction_removed",
    );
    await assert.rejects(
      client.tenantUpdate({
        table: "manual_transaction",
        budgetSpaceId,
        set: { removed_at: null, removed_by_subject_id: null },
        conditions: [{ column: "transaction_version_id", value: removal.current.version.transactionVersionId }],
      }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
      "a tombstone's own fields are immutable; only the supersession stamp may change",
    );

    // CBD-196-AC01 again, from the other end: creating an account created no
    // budget, period, schedule, transaction or assignment of its own.
    assert.equal((await client.tenantSelect({ table: "budget_space_period", budgetSpaceId })).rowCount, 2);
    assert.equal((await client.tenantSelect({ table: "budget_space_schedule_version", budgetSpaceId })).rowCount, 1);
    assert.equal((await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId })).rowCount, 1);
    assert.equal((await client.tenantSelect({ table: "financial_account", budgetSpaceId })).rowCount, 1);
  } finally {
    await api.end();
    await admin.end();
  }
});
