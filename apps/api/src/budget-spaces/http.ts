import { Controller, Get, Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { Authorize, Authorization } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { EffectContext } from "../authorization/boundary.js";
import { readBudgetSpaceDetail } from "../../../../packages/budget-application/src/persistence/budget-space-reader.ts";
import type { Clock } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";
import { displayLabel } from "../../../../packages/budget-application/src/invitations/index.ts";
import { financialProfileDisplayStatements } from "../../../../packages/data-access/src/financial-profile.ts";
import type { ProfileStatementClient } from "../../../../packages/data-access/src/financial-profile.ts";

export interface BudgetSpacesDependencies { readonly client: DataAccessClient; readonly clock: Clock }
export async function listOwnSpaces(client: DataAccessClient, subject: string): Promise<unknown> {
  if (!subject || !client.readOwnBudgetMemberships) throw new AuthorizationDenied();
  const memberships = await client.readOwnBudgetMemberships(subject);
  const spaces: unknown[] = [];
  for (const row of memberships.rows as { budget_space_id: string; membership_id: string }[]) {
    const result = await client.tenantSelect({ table: "budget_space", budgetSpaceId: row.budget_space_id,
      columns: ["budget_space_id", "name", "name_version", "lifecycle", "lifecycle_version", "currency_code", "time_zone"] });
    const space = result.rows[0] as Record<string, unknown> | undefined;
    // PROTO-ACTIVATION-001: the web budget list shows currency and time zone; both are budget settings (CBD-231), so the listing carries them.
    if (space) spaces.push({ budgetSpaceId: row.budget_space_id, membershipId: row.membership_id,
      name: space.name, nameVersion: space.name_version, lifecycle: space.lifecycle, lifecycleVersion: space.lifecycle_version,
      currencyCode: space.currency_code, timeZone: space.time_zone });
  }
  return { spaces };
}
/** One row of the members list: display identity, role and joined-at, and nothing else (CBD-234 design section 5.1; CBD-8-AC02/AC06). */
export interface MemberListEntry { readonly membershipId: string; readonly displayName: string; readonly role: string; readonly joinedAt: string }
/**
 * PK-6 (`1.view_members`; CBD-72 row 1; CBD-73 section 7.2 item 4): the active members of one space. The
 * membership read is tenant-scoped on the acting space and the display identity is the separate,
 * subject-scoped `display_name` read of `financial-profile.ts` -- never a contact, never personal state, never
 * another space -- shown as the neutral label until the person has chosen a name (design section 9).
 */
export async function listMembers(client: DataAccessClient, budgetSpaceId: string): Promise<{ budgetSpaceId: string; members: MemberListEntry[] }> {
  const found = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId, columns: ["membership_id", "account_subject_id", "role", "created_at"],
    conditions: [{ column: "status", value: "active" }] });
  const profiles = financialProfileDisplayStatements(client as unknown as ProfileStatementClient);
  const members: MemberListEntry[] = [];
  for (const row of found.rows as { membership_id?: unknown; account_subject_id?: unknown; role?: unknown; created_at?: unknown }[]) {
    if (typeof row.membership_id !== "string" || typeof row.account_subject_id !== "string" || typeof row.role !== "string") continue;
    const identity = await profiles.readDisplayIdentity(row.account_subject_id);
    const joinedAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
    members.push({ membershipId: row.membership_id, displayName: displayLabel(identity ? { accountSubjectId: identity.account_subject_id, profileId: identity.profile_id, profileState: identity.profile_state, displayName: identity.display_name, version: identity.version } : null), role: row.role, joinedAt });
  }
  members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.membershipId.localeCompare(b.membershipId));
  return { budgetSpaceId, members };
}
@Module({})
export class BudgetSpacesModule {}
export function budgetSpacesHttp(dependencies: BudgetSpacesDependencies): DynamicModule {
  const resolved = new WeakMap<FastifyRequest, { space: string; membership: string }>();
  /** The trusted pre-policy membership resolution `detail` and `members` share: the acting space from the path, the membership from storage. */
  const memberReplay = async (request: FastifyRequest, subject: string) => {
    const space = (request.params as Record<string, unknown>).budgetSpaceId;
    if (typeof space !== "string" || !space || !dependencies.client.readOwnBudgetMemberships) throw new AuthorizationDenied();
    const rows = (await dependencies.client.readOwnBudgetMemberships(subject)).rows as { budget_space_id: string; membership_id: string }[];
    const matches = rows.filter(row => row.budget_space_id === space);
    if (matches.length !== 1) throw new AuthorizationDenied();
    resolved.set(request, { space, membership: matches[0]!.membership_id });
    return { kind: "absent" as const };
  };
  const spaceLocator = (request: FastifyRequest) => {
    const identity = resolved.get(request); // WeakMap entry is released with the request object
    if (!identity) throw new AuthorizationDenied();
    return { fieldSet: "default" as const, resourceType: "space" as const, resourceId: identity.space,
      actingSpaceId: identity.space, actingMembershipId: identity.membership };
  };
  @Controller("v1/budget-spaces")
  class BudgetSpacesController {
    @Get()
    // PROTO-ACTIVATION-001: the p2 subject-self cell (CBD-236 section 8.5.1); the listing is loaded by the acting subject only.
    @Authorize({ action: "membership.list_own", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })
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
    /** PK-6: the members list on the p5 `1.view_members` cell (Primary Owner, Co-owner, Collaborator; a non-member is denied uniformly by the policy). */
    @Get(":budgetSpaceId/members")
    @Authorize({ action: "1.view_members", purpose: "user_delegated", replay: memberReplay, resourceLocator: spaceLocator })
    async members(@Authorization() effect: EffectContext): Promise<unknown> {
      const input = effect.input;
      if (!input.subject || !input.membership || input.resource?.owningSpaceId !== input.space.spaceId) throw new AuthorizationDenied();
      return listMembers(effect.transaction as DataAccessClient, input.space.spaceId);
    }
  }
  return { module: BudgetSpacesModule, controllers: [BudgetSpacesController] };
}
