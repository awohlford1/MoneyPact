import type { FastifyRequest } from "fastify";
import { createOrRegenerateProposal, readProposal } from "../../../../packages/budget-application/src/creation-proposals/application.ts";
import type { AuthenticatedSubjectContext, Ports } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";

export interface ProposalHttpDependencies {
  readonly context: (request: FastifyRequest, authenticatedSubject: string, transaction?: unknown) => Promise<AuthenticatedSubjectContext>;
  /** `transaction` is the boundary's transaction-scoped client (PROTO-ACTIVATION-001): the proposal store must write through it. */
  readonly ports: (context: AuthenticatedSubjectContext, transaction?: unknown) => Promise<Ports>;
}
export interface ProposalHttpResponse { readonly status: number; readonly body: unknown }

/** Transport mapping only. The caller must obtain the subject from the
 * authorization boundary; request bodies never provide authenticated context. */
export class ProposalHandlers {
  private readonly dependencies: ProposalHttpDependencies;
  constructor(dependencies: ProposalHttpDependencies) { this.dependencies = dependencies; }

  private async resolve(request: FastifyRequest, subject: string | undefined, transaction?: unknown): Promise<AuthenticatedSubjectContext | null> {
    if (!subject) return null;
    const context = await this.dependencies.context(request, subject, transaction);
    return context.subjectId === subject ? context : null;
  }

  async createOrRegenerate(request: FastifyRequest, subject: string | undefined, transaction?: unknown): Promise<ProposalHttpResponse> {
    const context = await this.resolve(request, subject, transaction);
    if (!context) return { status: 401, body: { error: "unauthenticated" } };
    const header = request.headers["idempotency-key"];
    const outcome = await createOrRegenerateProposal({ subjectContext: context,
      idempotencyKeyHeader: Array.isArray(header) ? header.join(",") : header,
      body: request.body }, await this.dependencies.ports(context, transaction));
    switch (outcome.kind) {
      case "created": case "replayed": return { status: outcome.status, body: outcome.response };
      case "validation_failed": return { status: 400, body: { error: "validation_failed", fieldErrors: outcome.fieldErrors } };
      case "conflict": return { status: 409, body: outcome.conflict };
      case "predecessor_not_found": return { status: 404, body: { error: "proposal_not_found" } };
    }
  }

  async read(request: FastifyRequest, subject: string | undefined, transaction?: unknown): Promise<ProposalHttpResponse> {
    const context = await this.resolve(request, subject, transaction);
    if (!context) return { status: 401, body: { error: "unauthenticated" } };
    const proposalId = (request.params as Record<string, unknown>).proposalId;
    if (typeof proposalId !== "string" || !/^bcp_[0-9a-f]{32}$/u.test(proposalId)) {
      return { status: 404, body: { error: "proposal_not_found" } };
    }
    const outcome = await readProposal({ ...context, proposalId }, await this.dependencies.ports(context, transaction));
    return outcome.kind === "found" ? { status: 200, body: outcome.response }
      : { status: 404, body: { error: "proposal_not_found" } };
  }
}
