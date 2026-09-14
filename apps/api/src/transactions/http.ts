/**
 * Manual transaction and budget-progress routes (CBD-199, CBD-200, CBD-201,
 * CBD-209, CBD-211; PROTO-INCREMENT-B-001).
 *
 *   POST  /v1/budget-spaces/:id/transactions                      9.add_manual_transaction     (mutate, transaction)
 *   PATCH /v1/budget-spaces/:id/transactions/:transactionId       9.edit_manual_transaction    (mutate, transaction)
 *   POST  /v1/budget-spaces/:id/transactions/:transactionId/remove 9.remove_manual_transaction (mutate, transaction)
 *   GET   /v1/budget-spaces/:id/transactions/:transactionId/history
 *                                             14.view_accounts_balances_transactions (read, account)
 *   GET   /v1/budget-spaces/:id/periods/:periodId/progress        15.view_planning_and_reports (read, report)
 *   GET   /v1/budget-spaces/:id/periods/:periodId/progress/:categoryId
 *                                             14.view_progress_detail (read, category)
 *
 * Row 9 of CBD-72 carries `remove_manual_transaction` in the released `p1`
 * matrix (`policy/v1.ts`), so the removal route needs no new cell and nothing
 * is denied for want of one.
 *
 * **The CBD-211 detail target (HO-236-09).** The drill-down binds
 * `14.view_progress_detail` with the CATEGORY ROW as its target -- never a
 * space and never an account. The datastore fact reader loads
 * `budget_category` tenant-scoped on the acting space, so a category owned by
 * another budget produces no `resource.*` leaf, the assembler refuses the
 * input and the boundary denies inertly before the handler runs and before
 * this module executes a single query. That is the `XSP-02` requirement: the
 * isolation is the policy's, not the query's.
 *
 * **The aggregate.** `15.view_planning_and_reports` over the whole report
 * surface of the space (INV-54, identified by the budget space id, exactly as
 * the merged CBD-153 module names the plan). The targets a cell is measured
 * against come from `readPlan`, so the aggregate and the plan can never
 * disagree about what the target was -- the CBD-209 aggregate/detail identity
 * begins with both sides reading the same number.
 *
 * **Signed amounts (increment A decision 1).** An expense is negative at every
 * layer. `settledActualMinorUnits` is the signed sum and
 * `remainingAfterSettledMinorUnits = target + actual` with no clamp, so an
 * overspent cell reports a negative remaining. The route passes both through
 * unchanged; presentation is the web's.
 *
 * Every command runs inside `client.transaction({ isolation: "serializable" })`
 * (F-INCA-003): the exact-sum rule and the new one-current-version rule are
 * deferred constraints that are only checked when a transaction ends.
 * `ProgressError` is mapped as well as `TransactionError` (F-REV-007), so a
 * duplicate cell or a fractional stored target is a canonical 400, never an
 * untranslated 500.
 */
import { randomUUID } from "node:crypto";
import { Controller, Get, Module, Patch, Post, Req } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput, ResourceType } from "@cobudget/contracts/authorization";
import { Authorize, Authorization, RouteFailure } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { AuthorizationTransactionStore, EffectContext } from "../authorization/boundary.js";
import { ProgressError } from "../../../../packages/budget-domain/src/progress/index.ts";
import { financialAccountStatements } from "../../../../packages/data-access/src/financial-account.ts";
import { manualTransactionStatements } from "../../../../packages/data-access/src/manual-transaction.ts";
import { transactionAllocationStatements } from "../../../../packages/data-access/src/transaction-allocation.ts";
import { budgetCategoryStatements } from "../../../../packages/data-access/src/budget-category.ts";
import { budgetCategoryBaseTargetStatements } from "../../../../packages/data-access/src/budget-category-base-target.ts";
import { budgetCategoryPeriodTargetStatements } from "../../../../packages/data-access/src/budget-category-period-target.ts";
import {
  TransactionError,
  createManualTransaction,
  dataAccessTransactionsRepository,
  editManualTransaction,
  parseTransactionWriteRequest,
  readBudgetProgress,
  readTransactionHistory,
  removeManualTransaction,
} from "../../../../packages/budget-application/src/transactions/index.ts";
import type {
  Clock,
  IdGenerator,
  TransactionErrorCode,
  TransactionSnapshot,
  TransactionStatements,
  TransactionsDependencies,
  TransactionsRepository,
} from "../../../../packages/budget-application/src/transactions/index.ts";
import { TargetsError, dataAccessTargetsRepository, readPlan } from "../../../../packages/budget-application/src/targets/index.ts";
import type { TargetsDependencies, TargetsRepository } from "../../../../packages/budget-application/src/targets/index.ts";

export const TRANSACTION_ACTIONS = {
  add: "9.add_manual_transaction",
  edit: "9.edit_manual_transaction",
  remove: "9.remove_manual_transaction",
  history: "14.view_accounts_balances_transactions",
  progress: "15.view_planning_and_reports",
  detail: "14.view_progress_detail",
} as const;

export interface TransactionsHttpDependencies {
  /** Repositories bound to the effect's transaction; production wraps the transaction-scoped `DataAccessClient`. */
  readonly repository: (transaction: unknown) => TransactionsRepository;
  readonly targets: (transaction: unknown) => TargetsRepository;
  /** The subject's active membership in the space, from trusted storage; null when there is none. */
  readonly membership: (subject: string, budgetSpaceId: string) => Promise<string | null>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const STATUS: Readonly<Record<TransactionErrorCode, number>> = Object.freeze({
  invalid_request: 400, currency_unsupported: 400, amount_not_integer: 400, amount_overflow: 400, date_invalid: 400, description_invalid: 400,
  allocations_empty: 400, allocation_duplicate_category: 400, allocation_category_invalid: 400, allocation_sum_mismatch: 400,
  account_not_found: 404, period_not_found: 404, transaction_not_found: 404,
  account_archived: 409, account_inaccessible: 409, currency_mismatch: 409, period_ambiguous: 409, transaction_removed: 409,
  constraint_violation: 409, conflict: 409,
});

/**
 * F-REV-007: `readBudgetProgress` passes stored targets straight to the domain
 * calculator, so a duplicate cell or a fractional stored target surfaces as a
 * `ProgressError` that the transaction vocabulary does not enumerate. It is a
 * refusal to compute over the stored plan, which is a 409 conflict in the
 * stored state -- except the two "not an integer" codes, which are malformed
 * values and answer 400. Every case is canonical; none is a 500.
 */
const PROGRESS_STATUS: Readonly<Record<string, number>> = Object.freeze({
  amount_not_integer: 400, target_not_integer: 400, duplicate_cell: 409, duplicate_record: 409, overflow: 409,
});

/** Application failures travel as `RouteFailure`, which the boundary transports only after rollback. */
export function transactionsFailure(error: unknown): never {
  if (error instanceof TransactionError) throw new RouteFailure(STATUS[error.code] ?? 409, error.code);
  if (error instanceof ProgressError) throw new RouteFailure(PROGRESS_STATUS[error.code] ?? 409, error.code);
  // The plan read the aggregate is measured against carries its own vocabulary; only the two shapes this route can produce are mapped.
  if (error instanceof TargetsError) throw new RouteFailure(error.code === "period_not_found" ? 404 : error.code === "budget_space_not_found" ? 404 : 409, error.code);
  throw error;
}

@Module({})
export class TransactionsModule {}

/** The itemized rows behind one category's progress figure for one period (CBD-211). */
export function itemizeCategory(ledger: readonly TransactionSnapshot[], categoryId: string): readonly unknown[] {
  const items: { transactionId: string; transactionVersionId: string; revision: number; accountId: string; budgetDate: string; description: string | null; allocationId: string; amountMinorUnits: number; currencyCode: string; minorUnitPrecision: number }[] = [];
  for (const snapshot of ledger) {
    // Superseded versions and tombstones never reach the aggregate, so they never reach the detail either.
    if (snapshot.version.supersededAt !== null || snapshot.version.removedAt !== null) continue;
    for (const allocation of snapshot.allocations) {
      if (allocation.categoryId !== categoryId) continue;
      items.push({
        transactionId: snapshot.version.transactionId, transactionVersionId: snapshot.version.transactionVersionId,
        revision: snapshot.version.revision, accountId: snapshot.version.accountId, budgetDate: snapshot.version.budgetDate,
        description: snapshot.version.description, allocationId: allocation.allocationId,
        amountMinorUnits: allocation.amountMinorUnits, currencyCode: allocation.currencyCode, minorUnitPrecision: allocation.minorUnitPrecision,
      });
    }
  }
  return items.sort((a, b) => (a.budgetDate < b.budgetDate ? -1 : a.budgetDate > b.budgetDate ? 1 : a.allocationId < b.allocationId ? -1 : a.allocationId > b.allocationId ? 1 : 0));
}

export function transactionsHttp(dependencies: TransactionsHttpDependencies): { module: DynamicModule } {
  interface Acting { readonly subject: string; readonly budgetSpaceId: string; readonly targetId: string | null; readonly membershipId: string | null }
  const acting = new WeakMap<FastifyRequest, Acting | undefined>();
  const param = (request: FastifyRequest, name: string, status: number, error: string): string => {
    const id = (request.params as Record<string, unknown>)[name];
    if (typeof id !== "string" || !UUID.test(id)) throw new RouteFailure(status, error);
    return id.toLowerCase();
  };
  const spaceOf = (request: FastifyRequest): string => param(request, "budgetSpaceId", 404, "budget_space_not_found");
  /** `target` names the path parameter whose row is the policy target, or null for a whole-set target. */
  const authorize = (action: string, resourceType: ResourceType, target: { readonly name: string; readonly status: number; readonly error: string } | null) => Authorize({
    action, purpose: "user_delegated",
    replay: async (request, subject) => {
      const budgetSpaceId = spaceOf(request);
      const targetId = target ? param(request, target.name, target.status, target.error) : null;
      acting.set(request, { subject, budgetSpaceId, targetId, membershipId: await dependencies.membership(subject, budgetSpaceId) });
      return { kind: "absent" };
    },
    resourceLocator: (request) => {
      const resolved = acting.get(request);
      if (!resolved) throw new AuthorizationDenied();
      return {
        fieldSet: "default", resourceType, resourceId: resolved.targetId ?? resolved.budgetSpaceId,
        actingSpaceId: resolved.budgetSpaceId,
        ...(resolved.membershipId ? { actingMembershipId: resolved.membershipId } : {}),
      };
    },
  });
  const within = (request: FastifyRequest, effect: EffectContext): { deps: TransactionsDependencies; plan: TargetsDependencies; budgetSpaceId: string; targetId: string | null; subject: string } => {
    const resolved = acting.get(request); acting.set(request, undefined);
    const subject = effect.input.subject?.accountSubjectId;
    if (!resolved || typeof subject !== "string" || subject !== resolved.subject || effect.input.space?.spaceId !== resolved.budgetSpaceId) throw new AuthorizationDenied();
    return {
      deps: { repository: dependencies.repository(effect.transaction), clock: dependencies.clock, ids: dependencies.ids },
      plan: { repository: dependencies.targets(effect.transaction), clock: dependencies.clock, ids: dependencies.ids },
      budgetSpaceId: resolved.budgetSpaceId, targetId: resolved.targetId, subject,
    };
  };

  @Controller("v1/budget-spaces/:budgetSpaceId")
  class TransactionsController {
    @Post("transactions")
    @authorize(TRANSACTION_ACTIONS.add, "transaction", null)
    async create(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, subject } = within(request, effect);
      try { return await createManualTransaction(deps, budgetSpaceId, subject, parseTransactionWriteRequest(request.body)); }
      catch (error) { return transactionsFailure(error); }
    }

    @Patch("transactions/:transactionId")
    @authorize(TRANSACTION_ACTIONS.edit, "transaction", { name: "transactionId", status: 404, error: "transaction_not_found" })
    async edit(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, targetId, subject } = within(request, effect);
      try { return await editManualTransaction(deps, budgetSpaceId, targetId!, subject, parseTransactionWriteRequest(request.body)); }
      catch (error) { return transactionsFailure(error); }
    }

    /** Removal is a tombstone version, never a DELETE; `remove` is a POST because it writes one. */
    @Post("transactions/:transactionId/remove")
    @authorize(TRANSACTION_ACTIONS.remove, "transaction", { name: "transactionId", status: 404, error: "transaction_not_found" })
    async remove(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, targetId, subject } = within(request, effect);
      try { return await removeManualTransaction(deps, budgetSpaceId, targetId!, subject); }
      catch (error) { return transactionsFailure(error); }
    }

    @Get("transactions/:transactionId/history")
    @authorize(TRANSACTION_ACTIONS.history, "account", null)
    async history(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId } = within(request, effect);
      const transactionId = param(request, "transactionId", 404, "transaction_not_found");
      try { return { budgetSpaceId, transactionId, history: await readTransactionHistory(deps, budgetSpaceId, transactionId) }; }
      catch (error) { return transactionsFailure(error); }
    }

    @Get("periods/:periodId/progress")
    @authorize(TRANSACTION_ACTIONS.progress, "report", null)
    async progress(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, plan, budgetSpaceId, subject } = within(request, effect);
      const periodId = param(request, "periodId", 404, "period_not_found");
      try {
        const targets = await planTargets(plan, budgetSpaceId, periodId, subject);
        const progress = await readBudgetProgress(deps, budgetSpaceId, { periodId, targets: targets.amounts });
        return { budgetSpaceId, periodId, currencyCode: targets.currencyCode, minorUnitPrecision: targets.minorUnitPrecision, labels: targets.labels, ...progress };
      } catch (error) { return transactionsFailure(error); }
    }

    /** CBD-211: the itemized set behind one category's figure, bound to that category row. */
    @Get("periods/:periodId/progress/:categoryId")
    @authorize(TRANSACTION_ACTIONS.detail, "category", { name: "categoryId", status: 404, error: "allocation_category_invalid" })
    async detail(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, plan, budgetSpaceId, targetId, subject } = within(request, effect);
      const periodId = param(request, "periodId", 404, "period_not_found");
      try {
        const targets = await planTargets(plan, budgetSpaceId, periodId, subject);
        const progress = await readBudgetProgress(deps, budgetSpaceId, { periodId, targets: targets.amounts.filter((target) => target.categoryId === targetId) });
        const ledger = await deps.repository.readPeriodLedger(budgetSpaceId, periodId);
        return {
          budgetSpaceId, periodId, categoryId: targetId, label: targets.labels[targetId!] ?? null,
          currencyCode: targets.currencyCode, minorUnitPrecision: targets.minorUnitPrecision,
          cell: progress.cells[0] ?? null, calculationVersion: progress.calculationVersion,
          items: itemizeCategory(ledger, targetId!),
        };
      } catch (error) { return transactionsFailure(error); }
    }
  }
  return { module: { module: TransactionsModule, controllers: [TransactionsController] } };
}

/**
 * The targets the period's cells are measured against, read through the same
 * `readPlan` the merged CBD-153 plan route uses, so the aggregate and the plan
 * report the same target for the same cell. `readPlan` materializes the
 * period's target rows when the base targets have moved, which is the
 * behaviour the plan route already has; it happens inside this route's
 * serializable transaction and writes nothing else.
 */
async function planTargets(deps: TargetsDependencies, budgetSpaceId: string, periodId: string, subject: string): Promise<{
  amounts: readonly { categoryId: string; targetMinorUnits: number }[]; labels: Record<string, string>; currencyCode: string; minorUnitPrecision: number;
}> {
  const plan = await readPlan(deps, budgetSpaceId, periodId, subject);
  const labels: Record<string, string> = {};
  for (const category of plan.categories) labels[category.categoryId] = category.label;
  return {
    amounts: plan.categories.map((category) => ({ categoryId: category.categoryId, targetMinorUnits: category.periodTarget.amountMinorUnits })),
    labels, currencyCode: plan.currencyCode, minorUnitPrecision: plan.minorUnitPrecision,
  };
}

/** Denies everything: a composition that installs the routes without a database, for inventory and registration proof. */
export function unavailableTransactionsDependencies(): TransactionsHttpDependencies {
  return {
    repository: () => { throw new AuthorizationDenied(); },
    targets: () => { throw new AuthorizationDenied(); },
    membership: async () => null,
    clock: { now: () => new Date().toISOString() },
    ids: { uuid: randomUUID },
  };
}

/** Production composition over the API role's client. */
export function dataAccessTransactionsDependencies(client: DataAccessClient): TransactionsHttpDependencies {
  return {
    repository: (transaction) => {
      const scoped = transaction as DataAccessClient;
      const accounts = financialAccountStatements(scoped);
      const manual = manualTransactionStatements(scoped);
      const allocations = transactionAllocationStatements(scoped);
      const categories = budgetCategoryStatements(scoped);
      const statements: TransactionStatements = {
        listPeriods: (space) => manual.listPeriods(space),
        readAccount: (space, id) => accounts.readAccount(space, id),
        listCategories: async (space) => (await categories.listCategories(space)).map((row) => ({ category_id: row.category_id, budget_space_id: row.budget_space_id, archived_at: row.archived_at })),
        listTransactionVersions: (space, transactionId) => manual.listTransactionVersions(space, transactionId),
        listTransactionsByPeriod: (space, periodId) => manual.listTransactionsByPeriod(space, periodId),
        listAllocations: (space, versionId) => allocations.listAllocations(space, versionId),
        insertTransaction: (row) => manual.insertTransaction(row),
        insertAllocation: (row) => allocations.insertAllocation(row),
        supersedeTransaction: (space, versionId, at) => manual.supersedeTransaction(space, versionId, at),
      };
      return dataAccessTransactionsRepository(statements);
    },
    targets: (transaction) => {
      const scoped = transaction as DataAccessClient;
      return dataAccessTargetsRepository({ ...budgetCategoryStatements(scoped), ...budgetCategoryBaseTargetStatements(scoped), ...budgetCategoryPeriodTargetStatements(scoped) });
    },
    membership: async (subject, budgetSpaceId) => {
      const found = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId, columns: ["membership_id"],
        conditions: [{ column: "account_subject_id", value: subject }, { column: "status", value: "active" }] });
      const row = found.rows[0] as { membership_id?: unknown } | undefined;
      return typeof row?.membership_id === "string" ? row.membership_id : null;
    },
    clock: { now: () => new Date().toISOString() },
    ids: { uuid: randomUUID },
  };
}

const TRANSACTION_ACTION_SET: readonly string[] = [...new Set(Object.values(TRANSACTION_ACTIONS))];

/**
 * The transaction store for the row-9, row-14 and row-15 actions this module
 * owns: one serializable transaction per effect (F-INCA-003), and the `p1`
 * and `p3` obligations discharged structurally. `preserve` is the retained
 * version chain -- an edit writes a new version and stamps the old one, a
 * removal writes a tombstone, and the migrations make DELETE and mutation of
 * history impossible; `invalidate` and `bind_cache_key` hold because this
 * prototype keeps no derived cache and every figure is computed from the rows
 * inside the same transaction; `confirm` on removal is the separately
 * addressed `/remove` endpoint; `mask` is structural in that these routes
 * return only the fields the acting Primary Owner's own budget rows carry.
 * An action outside the set is refused.
 */
export class TransactionsAuthorizationStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  #outcomes: { committed(handle: object): void; rolledBack(handle: object): void } | undefined;
  constructor(client: DataAccessClient) { this.#client = client; }
  observe(outcomes: { committed(handle: object): void; rolledBack(handle: object): void }): void { this.#outcomes = outcomes; }
  async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    let handle: object | undefined;
    try {
      const result = await this.#client.transaction({ isolation: "serializable" }, (client) => { handle = client; return work(client); });
      if (handle) this.#outcomes?.committed(handle);
      return result;
    } catch (error) {
      if (handle) this.#outcomes?.rolledBack(handle);
      if (error instanceof RouteFailure) return error as T;
      throw error;
    }
  }
  async discharge(_transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean> {
    return TRANSACTION_ACTION_SET.includes(input.request.action)
      && ["preserve", "invalidate", "confirm", "mask", "bind_cache_key"].includes(obligation.kind);
  }
  async verify(_transaction: unknown, input: PolicyInput, _obligations: readonly Obligation[]): Promise<boolean> {
    return TRANSACTION_ACTION_SET.includes(input.request.action);
  }
}
