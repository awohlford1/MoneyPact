/** Deterministic fixtures shared by this module's tests and, later, by PK-7B's route tests. */
import type { ConsentDisclosure, ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import { InMemoryPrimaryTransferRepository } from "./in-memory.ts";
import {
  OUTGOING_DISCLOSURE_KIND, RECIPIENT_DISCLOSURE_KIND,
} from "./records.ts";
import type { ActorContext, PrimaryTransferDependencies, TransferActionCode } from "./ports.ts";

export const SPACE = "11111111-1111-4111-8111-111111111111";
export const PRIMARY_SUBJECT = "22222222-2222-4222-8222-222222222222";
export const PRIMARY_MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
export const PRIMARY_PROFILE = "34343434-3434-4434-8434-343434343434";
export const RECIPIENT_SUBJECT = "44444444-4444-4444-8444-444444444444";
export const RECIPIENT_MEMBERSHIP = "45454545-4545-4545-8545-454545454545";
export const RECIPIENT_PROFILE = "55555555-5555-4555-8555-555555555555";
export const OTHER_SUBJECT = "77777777-7777-4777-8777-777777777777";
export const PRIMARY_CONSENT = "88888888-8888-4888-8888-888888888888";
export const RECIPIENT_CONSENT = "89898989-8989-4989-8989-898989898989";
export const CORRELATION = "99999999-9999-4999-8999-999999999999";

/** The evidence reference PK-7B hands the confirm path after the boundary spent the grant. Never a token. */
export const ASSURANCE_REFERENCE = "fresh-assurance:0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

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

/** The two registered transfer disclosure kinds at version 1, with stable digests. */
export function testDisclosures(overrides: Partial<Record<string, ConsentDisclosure>> = {}): ConsentDisclosureSource {
  const entries: Record<string, ConsentDisclosure> = {
    [RECIPIENT_DISCLOSURE_KIND]: {
      kind: RECIPIENT_DISCLOSURE_KIND, version: 1, digest: "a".repeat(64),
      text: { heading: "Becoming the Primary Owner", items: [{ id: "1", text: "Full powers." }], acknowledgement: "I agree." },
    },
    [OUTGOING_DISCLOSURE_KIND]: {
      kind: OUTGOING_DISCLOSURE_KIND, version: 1, digest: "b".repeat(64),
      text: { heading: "Handing over", items: [{ id: "1", text: "You lose permission 26." }], acknowledgement: "I agree." },
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

export interface TestWorld {
  readonly repository: InMemoryPrimaryTransferRepository;
  readonly clock: FakeClock;
  readonly ids: SequenceIds;
  readonly deps: PrimaryTransferDependencies;
  /** Every invitation the canceller was asked to cancel, in call order. */
  readonly cancelled: string[];
  primary(action: TransferActionCode): ActorContext;
  recipient(action: TransferActionCode): ActorContext;
}

/**
 * One live budget space, one Primary Owner and one active Collaborator, each
 * with a `current` consent row, and one active permission-26 invitation the
 * Primary created.
 */
export function testWorld(options: {
  readonly recipientRole?: string;
  readonly correlationId?: string;
} = {}): TestWorld {
  const repository = new InMemoryPrimaryTransferRepository();
  const clock = new FakeClock();
  const ids = new SequenceIds();
  const correlationId = options.correlationId ?? CORRELATION;
  const cancelled: string[] = [];

  repository.seedSpace({
    budgetSpaceId: SPACE, lifecycle: "live",
    primaryOwnerMembershipId: PRIMARY_MEMBERSHIP, primaryOwnershipVersion: 1,
  });
  repository.seedMembership({
    membershipId: PRIMARY_MEMBERSHIP, budgetSpaceId: SPACE, profileId: PRIMARY_PROFILE,
    accountSubjectId: PRIMARY_SUBJECT, role: "primary_owner", status: "active",
    authorizationVersion: 1, endedAt: null,
  });
  repository.seedMembership({
    membershipId: RECIPIENT_MEMBERSHIP, budgetSpaceId: SPACE, profileId: RECIPIENT_PROFILE,
    accountSubjectId: RECIPIENT_SUBJECT, role: options.recipientRole ?? "collaborator", status: "active",
    authorizationVersion: 1, endedAt: null,
  });
  repository.seedConsent({
    consentId: PRIMARY_CONSENT, budgetSpaceId: SPACE, membershipId: PRIMARY_MEMBERSHIP,
    accountSubjectId: PRIMARY_SUBJECT, role: "primary_owner", state: "current",
    disclosureKind: "primary_owner_self", supersedesConsentId: null,
    endedAt: null, endedReasonClass: null, endedByEventId: null, assuranceRef: null,
  });
  repository.seedConsent({
    consentId: RECIPIENT_CONSENT, budgetSpaceId: SPACE, membershipId: RECIPIENT_MEMBERSHIP,
    accountSubjectId: RECIPIENT_SUBJECT, role: options.recipientRole ?? "collaborator", state: "current",
    disclosureKind: "invitation_collaborator", supersedesConsentId: null,
    endedAt: null, endedReasonClass: null, endedByEventId: null, assuranceRef: null,
  });
  repository.seedInvitation({
    invitationId: "12121212-1212-4212-8212-121212121212", budgetSpaceId: SPACE,
    createdByMembershipId: PRIMARY_MEMBERSHIP, requiredPermission: "26", state: "pending",
  });

  const deps: PrimaryTransferDependencies = {
    repository,
    clock: { now: () => clock.now() },
    ids: { uuid: () => ids.uuid() },
    disclosures: testDisclosures(),
    cancelPermissionLostInvitations: async (input) => {
      const open = await repository.listPermissionInvitations(
        input.budgetSpaceId, input.createdByMembershipId, input.requiredPermission,
      );
      for (const row of open) {
        repository.invitations.set(row.invitationId, { ...row, state: "cancelled" });
        cancelled.push(row.invitationId);
      }
      return open.map((row) => row.invitationId);
    },
  };

  const decision = { policyVersion: "p4", policyDigest: "c".repeat(64), authorizationVersion: 1 };

  return {
    repository, clock, ids, deps, cancelled,
    primary(action: TransferActionCode): ActorContext {
      const base: ActorContext = {
        budgetSpaceId: SPACE, subjectId: PRIMARY_SUBJECT, membershipId: PRIMARY_MEMBERSHIP,
        decision, permission: "29", actionCode: action, correlationId,
      };
      return action === "29.transfer_primary_ownership" ? { ...base, freshAssuranceRef: ASSURANCE_REFERENCE } : base;
    },
    recipient(action: TransferActionCode): ActorContext {
      return {
        budgetSpaceId: SPACE, subjectId: RECIPIENT_SUBJECT, membershipId: RECIPIENT_MEMBERSHIP,
        decision, permission: "29", actionCode: action, correlationId,
      };
    },
  };
}

/**
 * The same actor with the decided cell omitted -- what a PK-7B route that
 * forgot to pass one would supply. `exactOptionalPropertyTypes` makes
 * `permission: undefined` a different thing from an absent key, and it is the
 * absent key the check has to refuse (`SEC-PK5-F02`, `R-03`).
 */
export function actorWithoutCell(actor: ActorContext): ActorContext {
  const { permission, actionCode, ...rest } = actor;
  void permission;
  void actionCode;
  return rest;
}
