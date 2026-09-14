/** Deterministic fixtures shared by this module's tests and apps/api's route tests. */
import type { Cadence } from "@cobudget/budget-domain/schedule";
import { InMemoryTargetsRepository } from "./in-memory.ts";
import type { PlanContext } from "./records.ts";
import type { TargetsDependencies } from "./application.ts";

export const SPACE_A = "11111111-1111-4111-8111-111111111111";
export const SPACE_B = "22222222-2222-4222-8222-222222222222";
export const PERIOD_A_OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const PERIOD_A_DONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const PERIOD_B_OPEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const SUBJECT_1 = "33333333-3333-4333-8333-333333333333";
export const SCHEDULE_A = "44444444-4444-4444-8444-444444444444";
export const SCHEDULE_B = "55555555-5555-4555-8555-555555555555";

/** A clock frozen at noon UTC on 2026-09-15; New York's date is the same. */
export const FIXED_NOW = "2026-09-15T12:00:00.000Z";

export class SequenceIds {
  #next = 0;
  uuid(): string {
    this.#next += 1;
    return `00000000-0000-4000-8000-${String(this.#next).padStart(12, "0")}`;
  }
}

export function planContext(overrides: Partial<PlanContext> & { budgetSpaceId: string; periodId: string }): PlanContext {
  return {
    currencyCode: "USD", timeZone: "America/New_York", currentPeriodId: overrides.periodId, scheduleVersionId: SCHEDULE_A, periodStatus: "active",
    periodStart: "2026-09-01", periodEnd: "2026-09-30", cadence: "monthly" as Cadence, ...overrides,
  };
}

export interface TestWorld {
  readonly repository: InMemoryTargetsRepository;
  readonly deps: TargetsDependencies;
  readonly ids: SequenceIds;
  now: string;
}

/** Two budget spaces: A (USD, monthly) with an open September period and a completed August one; B (USD, weekly) with one open period. */
export function testWorld(): TestWorld {
  const ids = new SequenceIds();
  const world: TestWorld = { now: FIXED_NOW, ids, repository: undefined as unknown as InMemoryTargetsRepository, deps: undefined as unknown as TargetsDependencies };
  const repository = new InMemoryTargetsRepository(() => world.now.slice(0, 10));
  repository.seedPlanContext(planContext({ budgetSpaceId: SPACE_A, periodId: PERIOD_A_OPEN }));
  repository.seedPlanContext(planContext({ budgetSpaceId: SPACE_A, periodId: PERIOD_A_DONE, currentPeriodId: PERIOD_A_OPEN, periodStatus: "planned", periodStart: "2026-08-01", periodEnd: "2026-08-31" }));
  repository.seedPlanContext(planContext({ budgetSpaceId: SPACE_B, periodId: PERIOD_B_OPEN, scheduleVersionId: SCHEDULE_B, cadence: "weekly", periodStart: "2026-09-14", periodEnd: "2026-09-20" }));
  return Object.assign(world, { repository, deps: { repository, clock: { now: () => world.now }, ids } });
}
