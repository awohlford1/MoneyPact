/** DEVELOPMENT ONLY. The mock's route module registry (CBD-35): each module owns some path prefix and returns
 * undefined for a request it does not own, so `mock-server.ts` can fall through in order and finally to its own
 * existing ladder. Imported by `mock-server.ts` only, never by browser components. */
import type { MockDirectory } from "./mock-invitations.ts";
import { handleMockInvitationRequest } from "./mock-invitations.ts";
import { handleMockReportsRequest } from "./mock-reports.ts";
import { handleMockGoalsRequest } from "./mock-goals.ts";

export type MockRouteModule = (
  directory: MockDirectory,
  session: { accountSubjectId: string; csrf: string } | undefined,
  request: Request,
  path: string[],
  body: Record<string, unknown>,
  now: () => number,
) => Promise<Response | undefined>;

// MOCK ROUTE MODULE REGISTRY -- append-only. Register your module as the next entry, after the ones already
// here; dispatch order matters, and the first module to answer with a Response wins.
export const MOCK_ROUTE_MODULES: MockRouteModule[] = [
  handleMockInvitationRequest,
  // UI-P04 (CBD-358): category and period reports, both reads derived from the existing progress engine.
  handleMockReportsRequest,
  // UI-P05 (CBD-341): savings goals and their contribution ledger.
  handleMockGoalsRequest,
];
