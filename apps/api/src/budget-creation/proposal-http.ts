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
 * and rechecked at commit) or `proposal.create` when there is none.
 * PROTO-QA-FIXES-001 F2: only a well-formed locator names a target row. A
 * value that is not a proposal identifier (wrong type or shape) selects
 * `proposal.create` with no target row so the request reaches the canonical
 * CBD-232 section 5.2 validation, which reports
 * `supersedes-proposal-id.expected-string` / `.invalid` in section 5.1 order
 * next to every other field error; the absent or foreign well-formed
 * predecessor keeps the uniform 404. */
const PROPOSAL_ID_PATTERN = /^bcp_[0-9a-f]{32}$/u;
export function proposalHttp(dependencies: ProposalHttpDependencies): DynamicModule {
  const handlers = new ProposalHandlers(dependencies);
  @Controller("v1/budget-creation-proposals")
  class ProposalController {
    @Post()
    @Authorize({ action: "proposal.create", actions: ["proposal.create", "proposal.regenerate"], purpose: "user_delegated",
      resourceLocator: () => ({ fieldSet: "default", scope: "subject" }),
      select: async (request) => {
        const supersedes = (request.body as Record<string, unknown> | undefined)?.supersedesProposalId;
        // Not a proposal identifier (absent, null, wrong type, wrong shape): no target row; the handler's
        // validation owns the field error (F2). The body never becomes an authority fact either way.
        if (typeof supersedes !== "string" || !PROPOSAL_ID_PATTERN.test(supersedes)) return { action: "proposal.create", fieldSet: "default", scope: "subject" };
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
      if (typeof proposalId !== "string" || !PROPOSAL_ID_PATTERN.test(proposalId)) throw new RouteFailure(404, "proposal_not_found");
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
