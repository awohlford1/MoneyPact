/**
 * Manual account routes (CBD-196, CBD-200; PROTO-INCREMENT-B-001).
 *
 *   POST   /v1/budget-spaces/:budgetSpaceId/accounts                manual_account.create_manual_account   (mutate, account)
 *   GET    /v1/budget-spaces/:budgetSpaceId/accounts                14.view_accounts_balances_transactions (read,   account)
 *   PATCH  /v1/budget-spaces/:budgetSpaceId/accounts/:accountId     manual_account.edit_manual_account     (mutate, account)
 *   POST   /v1/budget-spaces/:budgetSpaceId/accounts/:accountId/archive   manual_account.archive_manual_account
 *   POST   /v1/budget-spaces/:budgetSpaceId/accounts/:accountId/restore   manual_account.restore_manual_account
 *
 * Every route carries `@Authorize`, denies by default, and runs its command
 * inside `client.transaction({ isolation: "serializable" })` -- the deferred
 * constraints of the increment-A tables are only checked when a transaction
 * ends, so a command outside one is not merely slower, it is wrong (F-INCA-003).
 *
 * **The action for the list.** The packet leaves the choice between row 14 and
 * row 15 to the contract. Row 15 (`15.view_planning_and_reports`) is the
 * planning and reporting permission and its target type is `report`; CBD-72
 * row 14 is literally "view accounts, balances, and transactions", which is
 * what this route returns. The list therefore binds
 * `14.view_accounts_balances_transactions`. Its target type is `account`, and
 * a list has no single account row, so it names the space's account *set* --
 * see the next paragraph.
 *
 * **Whole-set targets (INV-54), and where they are not used.** `create` and
 * `list` have no account row to name: the created row does not exist when the
 * policy is evaluated, and the list spans every row. Both name the space's
 * account set, identified by the budget space identifier, exactly as the
 * merged CBD-153 module names the category set and the plan for
 * `4.edit_category` and `2a.edit_target`. `decide` has no predicate on
 * `resource.id`; it requires the declared `resourceType` and an
 * `owningSpaceId` equal to the acting space, and the whole-set target
 * satisfies both from the space row itself. `edit`, `archive` and `restore`
 * name the real `financial_account` row, whose own `version` is the
 * `targetVersion` that `recheck_at_commit` compares (contract section 8.6.1).
 *
 * **Account-state admissibility is the handler's (SEC-P3-F1, contract 8.6.2,
 * HO-236-09).** `decide` never evaluates `resource.lifecycle` for these cells,
 * so the policy allows archive on an archived account, restore on a live one
 * and edit on an archived one. The commands refuse all three --
 * `account_archived`, `account_not_archived` -- inside the transaction, before
 * anything is written, and `http.test.ts` has one negative case per
 * transition through the real Fastify instance. Refusing a transaction against
 * an archived account is the same rule, enforced in `../transactions/http.ts`
 * by the command's own `resolveAccount`.
 *
 * Composition is explicit, as for targets: `accountsHttp(dependencies)` builds
 * the controller around its dependencies, so no module-level mutable state
 * exists and two applications in one process cannot see each other.
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
import { financialAccountStatements } from "../../../../packages/data-access/src/financial-account.ts";
import {
  AccountError,
  archiveAccount,
  createAccount,
  dataAccessAccountsRepository,
  editAccount,
  listAccounts,
  parseAccountCreateRequest,
  parseAccountEditRequest,
  restoreAccount,
} from "../../../../packages/budget-application/src/accounts/index.ts";
import type { AccountErrorCode, AccountsDependencies, AccountsRepository, Clock, IdGenerator } from "../../../../packages/budget-application/src/accounts/index.ts";

export const ACCOUNT_ACTIONS = {
  create: "manual_account.create_manual_account",
  edit: "manual_account.edit_manual_account",
  archive: "manual_account.archive_manual_account",
  restore: "manual_account.restore_manual_account",
  read: "14.view_accounts_balances_transactions",
} as const;

export interface AccountsHttpDependencies {
  /** A repository bound to the effect's transaction; production wraps the transaction-scoped `DataAccessClient`. */
  readonly repository: (transaction: unknown) => AccountsRepository;
  /** The subject's active membership in the space, from trusted storage; null when there is none. */
  readonly membership: (subject: string, budgetSpaceId: string) => Promise<string | null>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The PR #335 error vocabulary, mapped once. A 409 is a state conflict; a 400 is a malformed or rejected field. */
const STATUS: Readonly<Record<AccountErrorCode, number>> = Object.freeze({
  invalid_request: 400, label_invalid: 400, account_type_unsupported: 400, currency_unsupported: 400,
  currency_precision_unsupported: 400, amount_not_integer: 400, amount_overflow: 400, owner_invalid: 400,
  account_not_found: 404,
  label_taken: 409, account_archived: 409, account_not_archived: 409, version_conflict: 409,
  constraint_violation: 409, conflict: 409,
});

/** Application failures travel as `RouteFailure`, which the boundary transports only after rollback. */
export function accountsFailure(error: unknown): never {
  if (error instanceof AccountError) throw new RouteFailure(STATUS[error.code] ?? 409, error.code);
  throw error;
}

@Module({})
export class AccountsModule {}

export function accountsHttp(dependencies: AccountsHttpDependencies): { module: DynamicModule } {
  interface Acting { readonly subject: string; readonly budgetSpaceId: string; readonly accountId: string | null; readonly membershipId: string | null }
  const acting = new WeakMap<FastifyRequest, Acting | undefined>();
  const spaceOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).budgetSpaceId;
    if (typeof id !== "string" || !UUID.test(id)) throw new RouteFailure(404, "budget_space_not_found");
    return id.toLowerCase();
  };
  const accountOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).accountId;
    if (typeof id !== "string" || !UUID.test(id)) throw new RouteFailure(404, "account_not_found");
    return id.toLowerCase();
  };
  /** `row` names the account the path carries; otherwise the target is the space's account set. */
  const authorize = (action: string, resourceType: ResourceType, row: boolean) => Authorize({
    action, purpose: "user_delegated",
    replay: async (request, subject) => {
      const budgetSpaceId = spaceOf(request);
      const accountId = row ? accountOf(request) : null;
      acting.set(request, { subject, budgetSpaceId, accountId, membershipId: await dependencies.membership(subject, budgetSpaceId) });
      return { kind: "absent" };
    },
    resourceLocator: (request) => {
      const resolved = acting.get(request);
      if (!resolved) throw new AuthorizationDenied();
      return {
        fieldSet: "default", resourceType, resourceId: resolved.accountId ?? resolved.budgetSpaceId,
        actingSpaceId: resolved.budgetSpaceId,
        ...(resolved.membershipId ? { actingMembershipId: resolved.membershipId } : {}),
      };
    },
  });
  const within = (request: FastifyRequest, effect: EffectContext): { deps: AccountsDependencies; budgetSpaceId: string; accountId: string | null; subject: string } => {
    const resolved = acting.get(request); acting.set(request, undefined);
    const subject = effect.input.subject?.accountSubjectId;
    if (!resolved || typeof subject !== "string" || subject !== resolved.subject || effect.input.space?.spaceId !== resolved.budgetSpaceId) throw new AuthorizationDenied();
    return {
      deps: { repository: dependencies.repository(effect.transaction), clock: dependencies.clock, ids: dependencies.ids },
      budgetSpaceId: resolved.budgetSpaceId, accountId: resolved.accountId, subject,
    };
  };

  @Controller("v1/budget-spaces/:budgetSpaceId/accounts")
  class AccountsController {
    @Post()
    @authorize(ACCOUNT_ACTIONS.create, "account", false)
    async create(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, subject } = within(request, effect);
      try { return await createAccount(deps, budgetSpaceId, subject, parseAccountCreateRequest(request.body, subject)); }
      catch (error) { return accountsFailure(error); }
    }

    @Get()
    @authorize(ACCOUNT_ACTIONS.read, "account", false)
    async list(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId } = within(request, effect);
      try { return { budgetSpaceId, accounts: await listAccounts(deps, budgetSpaceId) }; }
      catch (error) { return accountsFailure(error); }
    }

    @Patch(":accountId")
    @authorize(ACCOUNT_ACTIONS.edit, "account", true)
    async edit(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, accountId } = within(request, effect);
      try { return await editAccount(deps, budgetSpaceId, accountId!, parseAccountEditRequest(request.body)); }
      catch (error) { return accountsFailure(error); }
    }

    /** SEC-P3-F1: only a live account may be archived. The policy allows either way; this refuses. */
    @Post(":accountId/archive")
    @authorize(ACCOUNT_ACTIONS.archive, "account", true)
    async archive(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, accountId } = within(request, effect);
      try { return await archiveAccount(deps, budgetSpaceId, accountId!); }
      catch (error) { return accountsFailure(error); }
    }

    /** SEC-P3-F1: only an archived account may be restored. */
    @Post(":accountId/restore")
    @authorize(ACCOUNT_ACTIONS.restore, "account", true)
    async restore(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, accountId } = within(request, effect);
      try { return await restoreAccount(deps, budgetSpaceId, accountId!); }
      catch (error) { return accountsFailure(error); }
    }
  }
  return { module: { module: AccountsModule, controllers: [AccountsController] } };
}

/** Denies everything: a composition that installs the routes without a database, for inventory and registration proof. */
export function unavailableAccountsDependencies(): AccountsHttpDependencies {
  return {
    repository: () => { throw new AuthorizationDenied(); },
    membership: async () => null,
    clock: { now: () => new Date().toISOString() },
    ids: { uuid: randomUUID },
  };
}

/** Production composition over the API role's client. */
export function dataAccessAccountsDependencies(client: DataAccessClient): AccountsHttpDependencies {
  return {
    repository: (transaction) => dataAccessAccountsRepository(financialAccountStatements(transaction as DataAccessClient)),
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

const ACCOUNT_ACTION_SET: readonly string[] = Object.values(ACCOUNT_ACTIONS);

/**
 * The transaction store for the five account actions: one serializable
 * transaction per effect (F-INCA-003), and the `p3` obligations discharged
 * structurally. `preserve` is the `financial_account` version chain -- every
 * update advances a monotonic version the migration's trigger forces, and
 * creation provenance is immutable; `invalidate` and `bind_cache_key` are
 * satisfied because this prototype holds no derived cache to invalidate and
 * every read is computed from the rows inside the same transaction; `confirm`
 * on archive and restore is the client's explicit, separately addressed
 * endpoint -- the route exists for no other purpose than the lifecycle change
 * it names, so the request is itself the confirmation; `mask` is structural in
 * that no account field this route returns is a masked one. An action outside
 * the set is refused so the store cannot be mistaken for a general one.
 */
export class AccountsAuthorizationStore implements AuthorizationTransactionStore {
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
    return ACCOUNT_ACTION_SET.includes(input.request.action)
      && ["preserve", "invalidate", "confirm", "mask", "bind_cache_key"].includes(obligation.kind);
  }
  async verify(_transaction: unknown, input: PolicyInput, _obligations: readonly Obligation[]): Promise<boolean> {
    return ACCOUNT_ACTION_SET.includes(input.request.action);
  }
}
