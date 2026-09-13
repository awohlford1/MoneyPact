import { randomUUID } from "node:crypto";
import { Controller, Module, Post, Req } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { Authorize, Authorization } from "../authorization/http.js";
import type { EffectContext } from "../authorization/boundary.js";
import type { FactSourceAdapter, ProposalCandidateProvider } from "../authorization/facts.js";
import { ConfirmationError, confirmationRequest, confirmWithin } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import type { ConfirmBudgetCreationRequest, CreationPlan } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import type { AuthenticatedSubjectContext } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";
import { DurableProposalStore } from "../../../../packages/budget-application/src/persistence/proposal-store.ts";
import { DurableConfirmationTransaction, lookupConfirmation } from "../../../../packages/budget-application/src/persistence/confirmation-store.ts";
import type { ConfirmationDependencies } from "../../../../packages/budget-application/src/persistence/confirmation-store.ts";
import { confirmationFailure } from "./transaction-store.js";
import type { CreationAuthorizationStore } from "./transaction-store.js";

export interface CreationHttpDependencies {
  readonly client: DataAccessClient;
  readonly proposals: DurableProposalStore;
  readonly transactions: CreationAuthorizationStore;
  readonly persistence: ConfirmationDependencies;
  /** Resolve current account/profile/session context through trusted adapters. */
  readonly context: (request: FastifyRequest, authenticatedSubject: string) => Promise<AuthenticatedSubjectContext>;
}
@Module({})
export class BudgetCreationModule {}
/** Explicit composition avoids global mutable dependencies and candidate authority
 * from route/body fields. Register this module with the supplied candidate provider. */
export function budgetCreationHttp(dependencies: CreationHttpDependencies): { module: DynamicModule; candidates: ProposalCandidateProvider; facts: (source: FactSourceAdapter) => FactSourceAdapter } {
  type Resolved = { context: AuthenticatedSubjectContext; request: ConfirmBudgetCreationRequest; reference: string };
  const requests = new WeakMap<FastifyRequest, Resolved | undefined>();
  const attempts: Record<string, { request: FastifyRequest; resolved: Resolved } | undefined> = Object.create(null);
  const candidates: Record<string, { spaceId: string; membershipId: string } | undefined> = Object.create(null);
  @Controller("v1/budget-creation-proposals")
  class ConfirmationController {
    @Post(":proposalId/confirm")
    @Authorize({ action: "space.create", purpose: "user_delegated",
      replay: async (request, subject) => {
        try {
          const context = await dependencies.context(request, subject);
          if (context.subjectId !== subject) throw new ConfirmationError("unauthenticated");
          const command = confirmationRequest((request.params as Record<string, unknown>).proposalId, request.headers["idempotency-key"], request.body);
          try {
            const response = await lookupConfirmation(dependencies.client, context, command);
            if (response) return { kind: "committed", response };
          } catch (error) { if (error instanceof ConfirmationError && error.code === "idempotency_key_reused") return { kind: "conflict" }; throw error; }
          const proposal = await dependencies.proposals.locate({ ...context, proposalId: command.proposalId });
          if (!proposal) throw new ConfirmationError("proposal_not_found");
          if (proposal.record.status !== "previewed" || proposal.record.successorProposalId !== null) throw new ConfirmationError("proposal_not_current");
          const reference = randomUUID();
          candidates[reference] = { spaceId: proposal.candidateBudgetSpaceId, membershipId: proposal.candidatePrimaryMembershipId };
          const resolved = { context, request: command, reference };
          requests.set(request, resolved); attempts[reference] = { request, resolved };
          const expiry = setTimeout(() => { delete attempts[reference]; delete candidates[reference]; }, 60_000); expiry.unref();
          return { kind: "absent" };
        } catch (error) { if (error instanceof ConfirmationError) throw confirmationFailure(error); throw error; }
      },
      resourceLocator: request => {
        const resolved = requests.get(request); if (!resolved) throw new ConfirmationError("unauthenticated");
        return { fieldSet: "default", proposalReference: resolved.reference };
      } })
    async confirm(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const resolved = requests.get(request); requests.set(request, undefined);
      if (!resolved || effect.input.subject?.accountSubjectId !== resolved.context.subjectId) throw new ConfirmationError("unauthenticated");
      const client = effect.transaction as DataAccessClient;
      const tx = new DurableConfirmationTransaction(client, dependencies.proposals, { ...dependencies.persistence, membershipDischarged: true,
        authorize: async (_client, proposal) => {
          if (proposal.candidateBudgetSpaceId !== effect.input.bootstrap?.candidateSpaceId
            || proposal.candidatePrimaryMembershipId !== effect.input.bootstrap.candidatePrimaryMembershipId) throw new ConfirmationError("confirmation_stale");
          return { policyVersion: effect.decision.policyVersion, policyDigest: effect.decision.policyDigest, inputSchemaVersion: 1, authorizationVersion: 1 };
        },
        // The boundary appends the restricted allow event after postcondition checks,
        // still using this same client, and aborts on audit failure.
        allowAudit: async (_client, plan: CreationPlan) => { dependencies.transactions.recordPlan(client, plan); },
      });
      return confirmWithin(tx, resolved.context, resolved.request);
    }
  }
  return { module: { module: BudgetCreationModule, controllers: [ConfirmationController] }, facts: source => ({
    read: async (sourceName, lookup, transaction) => {
      const facts = await source.read(sourceName, lookup, transaction);
      if (sourceName === "session_store" && transaction && lookup.operation.action === "space.create") {
        const attempt = attempts[lookup.operation.proposalReference ?? ""];
        const subject = facts?.["subject.accountSubjectId"];
        if (!attempt || typeof subject !== "string" || subject !== attempt.resolved.context.subjectId) throw new ConfirmationError("unauthenticated");
        const context = await dependencies.context(attempt.request, subject);
        if (context.subjectId !== subject) throw new ConfirmationError("unauthenticated");
        await dependencies.transactions.replayAfterSession(transaction as DataAccessClient, context, attempt.resolved.request);
      }
      return facts;
    },
  }), candidates: async operation => {
    const reference = operation.proposalReference; const value = reference ? candidates[reference] : undefined;
    if (reference) delete candidates[reference];
    if (!value) throw new ConfirmationError("proposal_not_found"); return value;
  } };
}
