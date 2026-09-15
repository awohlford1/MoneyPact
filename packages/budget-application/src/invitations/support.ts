/** Deterministic fixtures shared by this module's tests and, later, by PK-6's route tests. */
import type { ConsentDisclosure, ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import type { InvitationDependencies } from "./application.ts";
import { InMemoryInvitationRepository } from "./in-memory.ts";
import type { InviteeContext, OwnerContext } from "./ports.ts";
import { ROLE_DISCLOSURE_KIND } from "./records.ts";
import { codeVerifierDigest, createKeyedDigest } from "./secrets.ts";
import type { KeyedDigest } from "./secrets.ts";

export const SPACE = "11111111-1111-4111-8111-111111111111";
export const OWNER_SUBJECT = "22222222-2222-4222-8222-222222222222";
export const OWNER_MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
export const OWNER_PROFILE = "34343434-3434-4434-8434-343434343434";
export const INVITEE_SUBJECT = "44444444-4444-4444-8444-444444444444";
export const INVITEE_PROFILE = "55555555-5555-4555-8555-555555555555";
export const INVITEE_SESSION = "66666666-6666-4666-8666-666666666666";
export const OTHER_SUBJECT = "77777777-7777-4777-8777-777777777777";
export const ENVIRONMENT = "test";

/** A clock frozen at noon UTC on 2026-09-15, movable by a test that needs an expiry to pass. */
export class FakeClock {
  #instant: string;
  constructor(instant = "2026-09-15T12:00:00.000Z") {
    this.#instant = instant;
  }
  now(): string {
    return this.#instant;
  }
  advanceSeconds(seconds: number): void {
    this.#instant = new Date(Date.parse(this.#instant) + seconds * 1000).toISOString();
  }
  set(instant: string): void {
    this.#instant = instant;
  }
}

export class SequenceIds {
  #next = 0;
  uuid(): string {
    this.#next += 1;
    return `00000000-0000-4000-8000-${String(this.#next).padStart(12, "0")}`;
  }
}

/** The two registered invitation kinds at version 1, with stable digests. */
export function testDisclosures(overrides: Partial<Record<string, ConsentDisclosure>> = {}): ConsentDisclosureSource {
  const entries: Record<string, ConsentDisclosure> = {
    invitation_collaborator: {
      kind: "invitation_collaborator", version: 1, digest: "a".repeat(64),
      text: { heading: "Collaborator", items: [{ id: "1", text: "What you will be able to do." }], acknowledgement: "I agree." },
    },
    invitation_co_owner: {
      kind: "invitation_co_owner", version: 1, digest: "b".repeat(64),
      text: { heading: "Co-owner", items: [{ id: "1", text: "What you will be able to do." }], acknowledgement: "I agree." },
    },
    ...overrides,
  };
  return {
    current(kind: string): ConsentDisclosure {
      const entry = entries[kind];
      if (!entry) throw new Error(`unregistered disclosure kind: ${kind}`);
      return entry;
    },
  };
}

/** A local key provider standing in for the CBD-246 field-encryption provider. Never a real key. */
export function testDigest(): KeyedDigest {
  return createKeyedDigest({ currentKey: () => ({ key: Buffer.alloc(32, 7) }) });
}

export interface TestWorld {
  readonly repository: InMemoryInvitationRepository;
  readonly clock: FakeClock;
  readonly ids: SequenceIds;
  readonly digest: KeyedDigest;
  readonly deps: InvitationDependencies;
  readonly owner: OwnerContext;
  readonly invitee: InviteeContext;
  /** The raw bearer and challenge the simulated adapter would render for one invitation. */
  delivery(invitationId: string): { readonly destination: string; readonly bearer: string; readonly challenge: string };
}

/** One live budget space, one Primary Owner, one eligible invitee with an active profile. */
export function testWorld(options: { readonly correlationId?: string } = {}): TestWorld {
  const repository = new InMemoryInvitationRepository();
  const clock = new FakeClock();
  const ids = new SequenceIds();
  const digest = testDigest();
  const correlationId = options.correlationId ?? "99999999-9999-4999-8999-999999999999";

  repository.seedSpace({ budgetSpaceId: SPACE, lifecycle: "live" });
  repository.seedIdentity({
    accountSubjectId: OWNER_SUBJECT, profileId: OWNER_PROFILE, profileState: "active", displayName: "Alex", version: 1,
  });
  repository.seedIdentity({
    accountSubjectId: INVITEE_SUBJECT, profileId: INVITEE_PROFILE, profileState: "active", displayName: null, version: 1,
  });
  repository.seedMembership({
    membershipId: OWNER_MEMBERSHIP, budgetSpaceId: SPACE, profileId: OWNER_PROFILE, accountSubjectId: OWNER_SUBJECT,
    role: "primary_owner", status: "active", authorizationVersion: 1, createdBySubjectId: OWNER_SUBJECT, endedAt: null,
  });

  const deps: InvitationDependencies = {
    repository,
    locator: repository.locator((binding, presented) => codeVerifierDigest(digest, binding, presented)),
    clock: { now: () => clock.now() },
    ids: { uuid: () => ids.uuid() },
    digest,
    disclosures: testDisclosures(),
    // The unit fixtures do not exercise the CBD-246 cipher; they prove the raw
    // address never reaches a record, which is a property of the call graph.
    encryptDestination: async (_context, destination) => new TextEncoder().encode(`sealed:${destination}`),
    readDestination: async (_budgetSpaceId, invitationId) => repository.outbox.get(invitationId)?.destination ?? null,
    challengeReader: async (invitationId) => {
      const row = repository.outbox.get(invitationId);
      return row?.challenge ?? null;
    },
  };

  const owner: OwnerContext = {
    budgetSpaceId: SPACE, subjectId: OWNER_SUBJECT, membershipId: OWNER_MEMBERSHIP,
    decision: { policyVersion: "p5", policyDigest: "c".repeat(64), authorizationVersion: 1 },
    correlationId,
  };
  const invitee: InviteeContext = {
    subjectId: INVITEE_SUBJECT, sessionRowId: INVITEE_SESSION, environment: ENVIRONMENT, correlationId,
  };

  return {
    repository, clock, ids, digest, deps, owner, invitee,
    delivery(invitationId: string) {
      const row = repository.outbox.get(invitationId);
      if (!row || row.bearer === null || row.challenge === null || row.destination === null) {
        throw new Error(`no simulated delivery for ${invitationId}`);
      }
      return { destination: row.destination, bearer: row.bearer, challenge: row.challenge };
    },
  };
}

/** The kind a role's invitation carries, so a test does not restate the mapping. */
export function disclosureKindFor(role: "collaborator" | "co_owner"): string {
  return ROLE_DISCLOSURE_KIND[role];
}
