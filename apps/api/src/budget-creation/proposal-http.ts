import { Controller, Get, Module, Post, Req, Res } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Authorize, Authorization, RouteFailure } from "../authorization/http.js";
import type { EffectContext } from "../authorization/boundary.js";
import { ProposalHandlers } from "./proposal-handlers.ts";
import type { ProposalHttpDependencies } from "./proposal-handlers.ts";

@Module({})
export class ProposalModule {}
/** Compose through AppModule's authorization.modules seam. PROTO-ACTIVATION-001
 * bound both routes to the released p2 subject-scoped cells (CBD-236 section
 * 8.5): the locator names the subject scope and, for the read, the proposal row
 * the datastore loads by environment and acting subject before the identifier.
 * Regeneration uses POST with supersedesProposalId, per CBD-232 section 4.1
 * (correction A5, review R05): the body's `supersedesProposalId` is read as an
 * untrusted locator by the route's pre-policy `select`, and the boundary then
 * evaluates the server-selected action -- `proposal.regenerate` with the
 * predecessor as the subject-owned target row (its lifecycle revision captured
 * and rechecked at commit) or `proposal.create` when there is none. */
export function proposalHttp(dependencies: ProposalHttpDependencies): DynamicModule {
  const handlers = new ProposalHandlers(dependencies);
  @Controller("v1/budget-creation-proposals")
  class ProposalController {
    @Post()
    @Authorize({ action: "proposal.create", actions: ["proposal.create", "proposal.regenerate"], purpose: "user_delegated",
      resourceLocator: () => ({ fieldSet: "default", scope: "subject" }),
      select: async (request) => {
        const supersedes = (request.body as Record<string, unknown> | undefined)?.supersedesProposalId;
        if (supersedes === undefined || supersedes === null) return { action: "proposal.create", fieldSet: "default", scope: "subject" };
        // A malformed predecessor locator is not a row; the boundary denies it as it denies any absent target row.
        if (typeof supersedes !== "string" || !/^bcp_[0-9a-f]{32}$/u.test(supersedes)) throw new RouteFailure(404, "proposal_not_found");
        return { action: "proposal.regenerate", fieldSet: "default", scope: "subject", resourceType: "proposal", resourceId: supersedes };
      } })
    async create(@Req() request: FastifyRequest, @Authorization() effect: EffectContext,
      @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
      const result = await handlers.createOrRegenerate(request, effect.input.subject?.accountSubjectId, effect.transaction);
      reply.code(result.status); return result.body;
    }
    @Get(":proposalId")
    @Authorize({ action: "proposal.read", purpose: "user_delegated", resourceLocator: (request) => {
      const proposalId = (request.params as Record<string, unknown>).proposalId;
      // The identifier is only a locator; the datastore loads the row by environment and subject first (section 4.4).
      if (typeof proposalId !== "string" || !/^bcp_[0-9a-f]{32}$/u.test(proposalId)) throw new RouteFailure(404, "proposal_not_found");
      return { fieldSet: "default", scope: "subject", resourceType: "proposal", resourceId: proposalId };
    } })
    async read(@Req() request: FastifyRequest, @Authorization() effect: EffectContext,
      @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
      const result = await handlers.read(request, effect.input.subject?.accountSubjectId, effect.transaction);
      reply.code(result.status); return result.body;
    }
  }
  return { module: ProposalModule, controllers: [ProposalController] };
}
