import { Controller, Get, Module, Post, Req, Res } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Authorize, Authorization } from "../authorization/http.js";
import type { EffectContext } from "../authorization/boundary.js";
import { ProposalHandlers } from "./proposal-handlers.ts";
import type { ProposalHttpDependencies } from "./proposal-handlers.ts";

@Module({})
export class ProposalModule {}
/** Compose through AppModule's authorization.modules seam. Activation is the
 * Manager-owned p2 authorization release (including its subject-scoped fact
 * assembly), plus the separately approved rate-limit projection. No route
 * rename or handler relocation is needed; p1 deliberately denies these actions.
 * Regeneration uses POST with supersedesProposalId, per CBD-232 section 4.1. */
export function proposalHttp(dependencies: ProposalHttpDependencies): DynamicModule {
  const handlers = new ProposalHandlers(dependencies);
  @Controller("v1/budget-creation-proposals")
  class ProposalController {
    @Post()
    @Authorize({ action: "proposal.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
    async create(@Req() request: FastifyRequest, @Authorization() effect: EffectContext,
      @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
      const result = await handlers.createOrRegenerate(request, effect.input.subject?.accountSubjectId);
      reply.code(result.status); return result.body;
    }
    @Get(":proposalId")
    @Authorize({ action: "proposal.read", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
    async read(@Req() request: FastifyRequest, @Authorization() effect: EffectContext,
      @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
      const result = await handlers.read(request, effect.input.subject?.accountSubjectId);
      reply.code(result.status); return result.body;
    }
  }
  return { module: ProposalModule, controllers: [ProposalController] };
}
