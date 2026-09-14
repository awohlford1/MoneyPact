/** Deterministic fixtures shared by this module's tests, the transactions module's tests, and (later) apps/api's route tests. */
import { InMemoryAccountsRepository } from "./in-memory.ts";
import type { AccountsDependencies } from "./application.ts";

export const ACCOUNT_SPACE_A = "11111111-1111-4111-8111-111111111111";
export const ACCOUNT_SPACE_B = "22222222-2222-4222-8222-222222222222";
export const ACCOUNT_SUBJECT_1 = "33333333-3333-4333-8333-333333333333";
export const ACCOUNT_SUBJECT_2 = "66666666-6666-4666-8666-666666666666";

/** A clock frozen at noon UTC on 2026-09-15. */
export const ACCOUNT_FIXED_NOW = "2026-09-15T12:00:00.000Z";

export class AccountSequenceIds {
  #next = 0;
  uuid(): string {
    this.#next += 1;
    return `aaaa0000-0000-4000-8000-${String(this.#next).padStart(12, "0")}`;
  }
}

export interface AccountWorld {
  readonly repository: InMemoryAccountsRepository;
  readonly deps: AccountsDependencies;
  readonly ids: AccountSequenceIds;
  now: string;
}

export function accountWorld(): AccountWorld {
  const ids = new AccountSequenceIds();
  const repository = new InMemoryAccountsRepository();
  const world: AccountWorld = { now: ACCOUNT_FIXED_NOW, ids, repository, deps: undefined as unknown as AccountsDependencies };
  return Object.assign(world, { deps: { repository, clock: { now: () => world.now }, ids } });
}
