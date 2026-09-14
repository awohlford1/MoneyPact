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
 * Regeneration uses POST with supersedesProposalId, per CBD-232 section 4.1;
 * the shared route is authorized under `proposal.create` (subject-self) because
 * one route carries one action and the predecessor is only known from the
 * body, which is never a locator -- reported as a finding, not silently widened. */
export function proposalHttp(dependencies: ProposalHttpDependencies): DynamicModule {
  const handlers = new ProposalHandlers(dependencies);
  @Controller("v1/budget-creation-proposals")
  class ProposalController {
    @Post()
    @Authorize({ action: "proposal.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })
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
