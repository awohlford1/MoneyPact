import { Controller, Get, Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { Authorize, Authorization } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { EffectContext } from "../authorization/boundary.js";
import { readBudgetSpaceDetail } from "../../../../packages/budget-application/src/persistence/budget-space-reader.ts";
import type { Clock } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";

export interface BudgetSpacesDependencies { readonly client: DataAccessClient; readonly clock: Clock }
export async function listOwnSpaces(client: DataAccessClient, subject: string): Promise<unknown> {
  if (!subject || !client.readOwnBudgetMemberships) throw new AuthorizationDenied();
  const memberships = await client.readOwnBudgetMemberships(subject);
  const spaces: unknown[] = [];
  for (const row of memberships.rows as { budget_space_id: string; membership_id: string }[]) {
    const result = await client.tenantSelect({ table: "budget_space", budgetSpaceId: row.budget_space_id,
      columns: ["budget_space_id", "name", "name_version", "lifecycle", "lifecycle_version"] });
    const space = result.rows[0] as Record<string, unknown> | undefined;
    if (space) spaces.push({ budgetSpaceId: row.budget_space_id, membershipId: row.membership_id,
      name: space.name, nameVersion: space.name_version, lifecycle: space.lifecycle, lifecycleVersion: space.lifecycle_version });
  }
  return { spaces };
}
@Module({})
export class BudgetSpacesModule {}
export function budgetSpacesHttp(dependencies: BudgetSpacesDependencies): DynamicModule {
  const resolved = new WeakMap<FastifyRequest, { space: string; membership: string }>();
  @Controller("v1/budget-spaces")
  class BudgetSpacesController {
    @Get()
    @Authorize({ action: "membership.list_own", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
    async list(@Authorization() effect: EffectContext): Promise<unknown> {
      return listOwnSpaces(effect.transaction as DataAccessClient, effect.input.subject?.accountSubjectId ?? "");
    }
    @Get(":budgetSpaceId")
    @Authorize({ action: "1.view_space", purpose: "user_delegated",
      replay: async (request, subject) => {
        const space = (request.params as Record<string, unknown>).budgetSpaceId;
        if (typeof space !== "string" || !space || !dependencies.client.readOwnBudgetMemberships) throw new AuthorizationDenied();
        const rows = (await dependencies.client.readOwnBudgetMemberships(subject)).rows as { budget_space_id: string; membership_id: string }[];
        const matches = rows.filter(row => row.budget_space_id === space);
        if (matches.length !== 1) throw new AuthorizationDenied();
        resolved.set(request, { space, membership: matches[0]!.membership_id });
        return { kind: "absent" };
      },
      resourceLocator: request => {
        const identity = resolved.get(request); // WeakMap entry is released with the request object
        if (!identity) throw new AuthorizationDenied();
        return { fieldSet: "default", resourceType: "space", resourceId: identity.space,
          actingSpaceId: identity.space, actingMembershipId: identity.membership };
      } })
    async detail(@Authorization() effect: EffectContext): Promise<unknown> {
      const input = effect.input;
      if (!input.subject || !input.membership || input.resource?.owningSpaceId !== input.space.spaceId) throw new AuthorizationDenied();
      const result = await readBudgetSpaceDetail(effect.transaction as DataAccessClient, input.space.spaceId,
        input.subject.accountSubjectId, input.membership.membershipId, dependencies.clock);
      if (!result) throw new AuthorizationDenied();
      return result;
    }
  }
  return { module: BudgetSpacesModule, controllers: [BudgetSpacesController] };
}
