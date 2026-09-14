import { budgetCreationHttp } from "./http.ts";
import type { CreationHttpDependencies } from "./http.ts";
import { proposalHttp } from "./proposal-http.ts";
import type { ProposalHttpDependencies } from "./proposal-handlers.ts";
import { budgetSpacesHttp } from "../budget-spaces/http.ts";
import type { BudgetSpacesDependencies } from "../budget-spaces/http.ts";

/** Pass modules to AppModule.register's authorization.modules; use the returned
 * candidates and facts decorators on that same boundary. Identity/startup owns
 * the production dependencies. This composes the unchanged CBD-233 binding. */
export function budgetApiHttp(creation: CreationHttpDependencies, proposals: ProposalHttpDependencies, spaces: BudgetSpacesDependencies) {
  const confirmation = budgetCreationHttp(creation);
  return { ...confirmation, modules: [confirmation.module, proposalHttp(proposals), budgetSpacesHttp(spaces)] };
}
