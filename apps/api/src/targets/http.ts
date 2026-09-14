/**
 * Category and target routes (CBD-153, PROTO-TARGETS-001).
 *
 *   GET /v1/budget-spaces/:budgetSpaceId/categories          1.view_space      (read,   resource: space)
 *   PUT /v1/budget-spaces/:budgetSpaceId/categories          4.edit_category   (mutate, resource: category)
 *   PUT /v1/budget-spaces/:budgetSpaceId/targets             2a.edit_target    (mutate, resource: plan)
 *   GET /v1/budget-spaces/:budgetSpaceId/plan?periodId=      1.view_space      (read,   resource: space)
 *
 * Every route carries an `@Authorize` decision the released p1 matrix
 * already defines; no new policy cell was needed. The resource a mutation
 * names is the budget's category set or plan as a whole, identified by the
 * budget space id, because both commands are whole-set operations (INV-54);
 * the datastore fact source is expected to answer `resource.owningSpaceId`,
 * `resource.version` and `resource.lifecycle` for that identity.
 *
 * The acting membership is not a request field. The pre-policy hook that
 * already authenticates the session resolves it from trusted storage for the
 * subject and the space in the path, in the same way the creation route
 * resolves proposal candidates; a subject with no active membership gets no
 * `actingMembershipId`, the fact assembler refuses the operation, and the
 * boundary denies with the one external denial. That is PROTO-PLAN-02's
 * "invisible to a subject without membership".
 *
 * Explicit composition, as for the creation route: `targetsHttp(dependencies)`
 * builds the controller around its dependencies, so no module-level mutable
 * state exists and two applications in one process (the tests) cannot see
 * each other. The module is passed through `authorization.modules`; the
 * default `AppModule` does not compose it. The CBD-266 registrations for the
 * four routes (and the HEAD routes Fastify derives from the two GETs) are
 * kept in `registrations.json` beside this file and proven schema-valid and
 * route-exact by `registrations.test.ts`; they are not yet in
 * `config/rate-limit/registrations.json` because every prototype parameter
 * record is still `pending` approval (OPEN-266-APPROVALS), so an active
 * registration would fail `check:rate-limit-registry` as unapproved and a
 * composed-but-unregistered route would fail it as undiscovered. Until that
 * approval lands the rate-limit gate denies these routes at runtime, which is
 * the fail-closed behaviour CBD-266 intends.
 */
import { randomUUID } from "node:crypto";
import { Controller, Get, Module, Put, Req } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Obligation, PolicyInput, ResourceType } from "@cobudget/contracts/authorization";
import { Authorize, Authorization, RouteFailure } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { AuthorizationTransactionStore, EffectContext } from "../authorization/boundary.js";
import { budgetCategoryStatements } from "../../../../packages/data-access/src/budget-category.ts";
import { budgetCategoryBaseTargetStatements } from "../../../../packages/data-access/src/budget-category-base-target.ts";
import { budgetCategoryPeriodTargetStatements } from "../../../../packages/data-access/src/budget-category-period-target.ts";
import { TargetsError, dataAccessTargetsRepository, listCategories, parseBaseTargetRequest, parseCategoryUpsertRequest, readPlan, setBaseTargets, upsertCategories } from "../../../../packages/budget-application/src/targets/index.ts";
import type { Clock, IdGenerator, TargetsDependencies, TargetsErrorCode, TargetsRepository } from "../../../../packages/budget-application/src/targets/index.ts";

export const TARGET_ACTIONS = { read: "1.view_space", editCategories: "4.edit_category", editTargets: "2a.edit_target" } as const;

export interface TargetsHttpDependencies {
  /** A repository bound to the effect's transaction; production wraps the transaction-scoped `DataAccessClient`. */
  readonly repository: (transaction: unknown) => TargetsRepository;
  /** The subject's active membership in the space, from trusted storage; null when there is none. */
  readonly membership: (subject: string, budgetSpaceId: string) => Promise<string | null>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const STATUS: Readonly<Record<TargetsErrorCode, number>> = Object.freeze({
  invalid_request: 400, label_invalid: 400, position_invalid: 400, amount_invalid: 400, amount_negative: 400,
  currency_unsupported: 400, currency_precision_unsupported: 400, cadence_unsupported: 400,
  budget_space_not_found: 404, period_not_found: 404, category_not_found: 404,
  category_archived: 409, duplicate_category: 409, label_taken: 409, completed_period_immutable: 409, constraint_violation: 409, conflict: 409,
});

/** Application failures travel as `RouteFailure`, which the boundary transports only after rollback. */
export function targetsFailure(error: unknown): never {
  if (error instanceof TargetsError) throw new RouteFailure(STATUS[error.code], error.code);
  throw error;
}

@Module({})
export class TargetsModule {}

export function targetsHttp(dependencies: TargetsHttpDependencies): { module: DynamicModule } {
  interface Acting { readonly subject: string; readonly budgetSpaceId: string; readonly membershipId: string | null }
  const acting = new WeakMap<FastifyRequest, Acting | undefined>();
  const spaceOf = (request: FastifyRequest): string => {
    const id = (request.params as Record<string, unknown>).budgetSpaceId;
    if (typeof id !== "string" || !UUID.test(id)) throw new RouteFailure(404, "budget_space_not_found");
    return id.toLowerCase();
  };
  const authorize = (action: string, resourceType: ResourceType) => Authorize({
    action, purpose: "user_delegated",
    replay: async (request, subject) => {
      const budgetSpaceId = spaceOf(request);
      acting.set(request, { subject, budgetSpaceId, membershipId: await dependencies.membership(subject, budgetSpaceId) });
      return { kind: "absent" };
    },
    resourceLocator: (request) => {
      const resolved = acting.get(request);
      if (!resolved) throw new AuthorizationDenied();
      return { fieldSet: "default", resourceType, resourceId: resolved.budgetSpaceId, actingSpaceId: resolved.budgetSpaceId, ...(resolved.membershipId ? { actingMembershipId: resolved.membershipId } : {}) };
    },
  });
  const within = (request: FastifyRequest, effect: EffectContext): { deps: TargetsDependencies; budgetSpaceId: string; subject: string } => {
    const resolved = acting.get(request); acting.set(request, undefined);
    const subject = effect.input.subject?.accountSubjectId;
    if (!resolved || typeof subject !== "string" || subject !== resolved.subject || effect.input.space?.spaceId !== resolved.budgetSpaceId) throw new AuthorizationDenied();
    return { deps: { repository: dependencies.repository(effect.transaction), clock: dependencies.clock, ids: dependencies.ids }, budgetSpaceId: resolved.budgetSpaceId, subject };
  };

  @Controller("v1/budget-spaces/:budgetSpaceId")
  class TargetsController {
    @Get("categories")
    @authorize(TARGET_ACTIONS.read, "space")
    async listCategories(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId } = within(request, effect);
      try { return { budgetSpaceId, categories: await listCategories(deps, budgetSpaceId) }; } catch (error) { return targetsFailure(error); }
    }

    @Put("categories")
    @authorize(TARGET_ACTIONS.editCategories, "category")
    async putCategories(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId } = within(request, effect);
      try { return { budgetSpaceId, categories: await upsertCategories(deps, budgetSpaceId, parseCategoryUpsertRequest(request.body)) }; } catch (error) { return targetsFailure(error); }
    }

    @Put("targets")
    @authorize(TARGET_ACTIONS.editTargets, "plan")
    async putTargets(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, subject } = within(request, effect);
      try { return await setBaseTargets(deps, budgetSpaceId, subject, parseBaseTargetRequest(request.body)); } catch (error) { return targetsFailure(error); }
    }

    @Get("plan")
    @authorize(TARGET_ACTIONS.read, "space")
    async getPlan(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const { deps, budgetSpaceId, subject } = within(request, effect);
      const periodId = (request.query as Record<string, unknown>).periodId;
      if (periodId !== undefined && (typeof periodId !== "string" || !UUID.test(periodId))) throw new RouteFailure(400, "invalid_request");
      try { return await readPlan(deps, budgetSpaceId, typeof periodId === "string" ? periodId.toLowerCase() : null, subject); } catch (error) { return targetsFailure(error); }
    }
  }
  return { module: { module: TargetsModule, controllers: [TargetsController] } };
}

/** Denies everything: a composition that installs the routes without a database, for inventory and registration proof. */
export function unavailableTargetsDependencies(): TargetsHttpDependencies {
  return {
    repository: () => { throw new AuthorizationDenied(); },
    membership: async () => null,
    clock: { now: () => new Date().toISOString() },
    ids: { uuid: randomUUID },
  };
}

/** Production composition over the API role's client. The boundary's transaction store must be {@link TargetsAuthorizationStore} (or dispatch to it for these actions). */
export function dataAccessTargetsDependencies(client: DataAccessClient): TargetsHttpDependencies {
  return {
    repository: (transaction) => {
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

const TARGET_ACTION_SET: readonly string[] = Object.values(TARGET_ACTIONS);

/**
 * The transaction store for the three target actions: one serializable
 * transaction per effect, and the p1 `preserve` obligation (record classes
 * history and provenance) discharged structurally -- base targets are
 * append-only rows and period targets carry origin, inputs and formula
 * version on every row, which the CBD-153 migrations enforce. No other
 * obligation is claimed; an action outside this set is refused so the store
 * cannot be mistaken for a general one.
 */
export class TargetsAuthorizationStore implements AuthorizationTransactionStore {
  readonly #client: DataAccessClient;
  #outcomes: { committed(handle: object): void; rolledBack(handle: object): void } | undefined;
  constructor(client: DataAccessClient) { this.#client = client; }
  /** PROTO-ACTIVATION-001 A3: binds the explicit per-handle outcome channel of the dispatching store. */
  observe(outcomes: { committed(handle: object): void; rolledBack(handle: object): void }): void { this.#outcomes = outcomes; }
  /** A `RouteFailure` is returned, not thrown, once the transaction has rolled back: the boundary transports it as the route's status while every other failure stays a denial. */
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
    return TARGET_ACTION_SET.includes(input.request.action) && obligation.kind === "preserve";
  }
  async verify(_transaction: unknown, input: PolicyInput, _obligations: readonly Obligation[]): Promise<boolean> {
    return TARGET_ACTION_SET.includes(input.request.action);
  }
}
