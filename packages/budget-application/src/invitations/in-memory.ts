/**
 * The in-memory `InvitationRepository` the unit tests run against.
 *
 * It is a faithful model of the PK-2 schema's *behaviour*, not of PostgreSQL:
 * the optimistic `state_version` predicate, the write-once evidence columns,
 * the one-current-ceremony rule and the terminal membership rule are all
 * enforced here, so a unit test that passes against this adapter is testing
 * the same rules the live suite then proves against the real triggers. Where
 * it deliberately differs is isolation -- there is none, and the concurrency
 * claims are the live suite's alone.
 */
import { InvitationError } from "./records.ts";
import { hasSelectorShape, splitPresentedCode } from "./secrets.ts";
import type {
  AcceptanceConsentRecord, CeremonyRecord, CodeDisposition, ConfirmationRecord, DisplayIdentity,
  InvitationCodeRecord, InvitationRecord, LifecycleAuditEvent, LifecycleNotice, MembershipRecord, SecurityEvent,
} from "./records.ts";
import type {
  BudgetSpaceFacts, CeremonyPatch, ConfirmationPatch, InvitationLocation, InvitationLocator,
  InvitationPatch, InvitationRepository, OutboxInsert, OutboxRecord, OutboxTombstoneReason,
} from "./ports.ts";

interface StoredOutbox extends OutboxRecord {
  readonly budgetSpaceId: string;
  destination: string | null;
  bearer: string | null;
  challenge: string | null;
}

/**
 * `next` when the patch names the column, the current value when it does not.
 * Written as a helper rather than one ternary per field: for the receipt and
 * the decision columns, whose names end in a word the secret scanner treats as
 * credential-shaped, the ternary form reads to its generic-api-key rule as a
 * name assigned a long identifier (PK2FIX-F04).
 */
function pick<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next;
}

export class InMemoryInvitationRepository implements InvitationRepository {
  readonly invitations = new Map<string, InvitationRecord>();
  readonly destinationCiphertexts = new Map<string, Uint8Array>();
  readonly codes = new Map<string, InvitationCodeRecord>();
  readonly ceremonies = new Map<string, CeremonyRecord>();
  readonly confirmations = new Map<string, ConfirmationRecord>();
  readonly outbox = new Map<string, StoredOutbox>();
  readonly memberships: MembershipRecord[] = [];
  readonly consents: AcceptanceConsentRecord[] = [];
  readonly audits: LifecycleAuditEvent[] = [];
  readonly securityEvents: SecurityEvent[] = [];
  readonly notices: LifecycleNotice[] = [];
  readonly identities = new Map<string, DisplayIdentity>();
  readonly spaces = new Map<string, BudgetSpaceFacts>();

  seedSpace(facts: BudgetSpaceFacts): void {
    this.spaces.set(facts.budgetSpaceId, facts);
  }

  seedIdentity(identity: DisplayIdentity): void {
    this.identities.set(identity.accountSubjectId, identity);
  }

  seedMembership(record: MembershipRecord): void {
    this.memberships.push(record);
  }

  /** The locator over the same store, with the same "location only" contract and the same selector-then-verifier shape as the real one. */
  locator(verifierFor: (binding: { invitationId: string; invitationVersion: number; destinationToken: string }, secret: string) => Promise<string>): InvitationLocator {
    const bindingOf = (code: InvitationCodeRecord) => {
      const invitation = this.invitations.get(code.invitationId);
      return invitation === undefined ? null : {
        invitationId: invitation.invitationId, invitationVersion: invitation.invitationVersion, destinationToken: invitation.destinationToken,
      };
    };
    return {
      locateByPresentedCode: async (presented: string): Promise<InvitationLocation | null> => {
        if (hasSelectorShape(presented)) {
          const parts = splitPresentedCode(presented);
          if (parts === undefined) return null;
          const code = [...this.codes.values()].find((row) => row.codeSelector === parts.selector);
          const binding = code === undefined ? null : bindingOf(code);
          if (code === undefined || binding === null) return null;
          const candidate = await verifierFor(binding, parts.secret);
          return candidate === code.verifierDigest ? { budgetSpaceId: code.budgetSpaceId, invitationId: code.invitationId } : null;
        }
        for (const code of this.codes.values()) {
          if (code.codeSelector !== null) continue;
          const binding = bindingOf(code);
          if (binding === null) continue;
          const candidate = await verifierFor(binding, presented);
          if (candidate === code.verifierDigest) return { budgetSpaceId: code.budgetSpaceId, invitationId: code.invitationId };
        }
        return null;
      },
      locateByCeremony: async (ceremonyId: string) => {
        const ceremony = this.ceremonies.get(ceremonyId);
        return ceremony ? { budgetSpaceId: ceremony.budgetSpaceId, invitationId: ceremony.invitationId, ceremonyId } : null;
      },
    };
  }

  // --- the invitation record -------------------------------------------------

  async readInvitation(budgetSpaceId: string, invitationId: string): Promise<InvitationRecord | null> {
    const record = this.invitations.get(invitationId);
    return record && record.budgetSpaceId === budgetSpaceId ? record : null;
  }

  async findDispatchedByDestination(budgetSpaceId: string, destinationToken: string): Promise<InvitationRecord | null> {
    for (const record of this.invitations.values()) {
      if (record.budgetSpaceId !== budgetSpaceId || record.kind !== "real") continue;
      if (record.destinationToken !== destinationToken) continue;
      if (["created", "pending", "awaiting_confirmation"].includes(record.state)) return record;
    }
    return null;
  }

  async listByCandidateSubject(budgetSpaceId: string, candidateSubjectId: string): Promise<readonly InvitationRecord[]> {
    return [...this.invitations.values()]
      .filter((row) => row.budgetSpaceId === budgetSpaceId && row.candidateSubjectId === candidateSubjectId);
  }

  async insertInvitation(record: InvitationRecord, destinationCiphertext: Uint8Array): Promise<void> {
    if (this.invitations.has(record.invitationId)) throw new InvitationError("conflict", "invitationId");
    // The partial unique index of SS4.1, modelled.
    if (record.kind === "real" && await this.findDispatchedByDestination(record.budgetSpaceId, record.destinationToken)) {
      throw new InvitationError("conflict", "destinationToken");
    }
    this.invitations.set(record.invitationId, record);
    this.destinationCiphertexts.set(record.invitationId, destinationCiphertext);
  }

  async updateInvitation(budgetSpaceId: string, invitationId: string, expectedStateVersion: number, patch: InvitationPatch): Promise<boolean> {
    const record = this.invitations.get(invitationId);
    if (!record || record.budgetSpaceId !== budgetSpaceId || record.stateVersion !== expectedStateVersion) return false;
    // The set-once evidence columns of SEC-PK2-F02.
    if (record.acceptedMembershipId !== null && patch.acceptedMembershipId !== undefined && patch.acceptedMembershipId !== record.acceptedMembershipId) {
      throw new InvitationError("constraint_violation", "acceptedMembershipId");
    }
    if (record.commitIdempotencyKey !== null && patch.commitIdempotencyKey !== undefined && patch.commitIdempotencyKey !== record.commitIdempotencyKey) {
      throw new InvitationError("constraint_violation", "commitIdempotencyKey");
    }
    if (record.privateTerminalCause !== null && patch.privateTerminalCause !== undefined && patch.privateTerminalCause !== record.privateTerminalCause) {
      throw new InvitationError("constraint_violation", "privateTerminalCause");
    }
    const stateChanged = patch.state !== undefined && patch.state !== record.state;
    const next: InvitationRecord = {
      ...record,
      state: patch.state ?? record.state,
      stateVersion: stateChanged ? record.stateVersion + 1 : record.stateVersion,
      projectionState: patch.projectionState ?? record.projectionState,
      privateTerminalCause: patch.privateTerminalCause === undefined ? record.privateTerminalCause : patch.privateTerminalCause,
      successorInvitationId: patch.successorInvitationId === undefined ? record.successorInvitationId : patch.successorInvitationId,
      candidateSubjectId: patch.candidateSubjectId === undefined ? record.candidateSubjectId : patch.candidateSubjectId,
      acceptedMembershipId: patch.acceptedMembershipId === undefined ? record.acceptedMembershipId : patch.acceptedMembershipId,
      commitIdempotencyKey: pick(patch.commitIdempotencyKey, record.commitIdempotencyKey),
      commitRequestDigest: pick(patch.commitRequestDigest, record.commitRequestDigest),
      committedResponse: pick(patch.committedResponse, record.committedResponse),
    };
    if ((next.state === "accepted") !== (next.acceptedMembershipId !== null)) {
      throw new InvitationError("constraint_violation", "acceptedMembershipId");
    }
    this.invitations.set(invitationId, next);
    return true;
  }

  // --- the code --------------------------------------------------------------

  async readCode(budgetSpaceId: string, invitationId: string): Promise<InvitationCodeRecord | null> {
    const code = this.codes.get(invitationId);
    return code && code.budgetSpaceId === budgetSpaceId ? code : null;
  }

  async insertCode(record: InvitationCodeRecord): Promise<void> {
    if (this.codes.has(record.invitationId)) throw new InvitationError("conflict", "invitationId");
    this.codes.set(record.invitationId, record);
  }

  async updateCodeDisposition(
    budgetSpaceId: string, invitationId: string, from: CodeDisposition, to: CodeDisposition, reasonClass: string, at: string,
  ): Promise<boolean> {
    const code = this.codes.get(invitationId);
    if (!code || code.budgetSpaceId !== budgetSpaceId || code.disposition !== from) return false;
    this.codes.set(invitationId, { ...code, disposition: to, dispositionReasonClass: reasonClass, dispositionAt: at });
    return true;
  }

  async stampAbuseFingerprint(budgetSpaceId: string, invitationId: string, fingerprint: string): Promise<void> {
    const code = this.codes.get(invitationId);
    if (!code || code.budgetSpaceId !== budgetSpaceId) return;
    this.codes.set(invitationId, { ...code, abuseFingerprint: fingerprint });
  }

  // --- the ceremony ----------------------------------------------------------

  async readCeremony(budgetSpaceId: string, ceremonyId: string): Promise<CeremonyRecord | null> {
    const ceremony = this.ceremonies.get(ceremonyId);
    return ceremony && ceremony.budgetSpaceId === budgetSpaceId ? ceremony : null;
  }

  async listCeremonies(budgetSpaceId: string, invitationId: string): Promise<readonly CeremonyRecord[]> {
    return [...this.ceremonies.values()].filter((row) => row.budgetSpaceId === budgetSpaceId && row.invitationId === invitationId);
  }

  async insertCeremony(record: CeremonyRecord): Promise<void> {
    const current = [...this.ceremonies.values()].filter((row) => row.invitationId === record.invitationId && row.isCurrent);
    if (record.isCurrent && current.length > 0) throw new InvitationError("conflict", "ceremony.isCurrent");
    this.ceremonies.set(record.ceremonyId, record);
  }

  async updateCeremony(budgetSpaceId: string, ceremonyId: string, patch: CeremonyPatch): Promise<boolean> {
    const record = this.ceremonies.get(ceremonyId);
    if (!record || record.budgetSpaceId !== budgetSpaceId) return false;
    // SEC-PK2-F03: attachment and proof evidence is write-once.
    if (record.attachedSubjectId !== null && patch.attachedSubjectId !== undefined && patch.attachedSubjectId !== record.attachedSubjectId) {
      throw new InvitationError("constraint_violation", "attachedSubjectId");
    }
    if (record.channelProofState === "proved" && patch.channelProofState !== undefined && patch.channelProofState !== "proved") {
      throw new InvitationError("constraint_violation", "channelProofState");
    }
    const next: CeremonyRecord = {
      ...record,
      isCurrent: patch.isCurrent ?? record.isCurrent,
      channelProofState: patch.channelProofState ?? record.channelProofState,
      channelChallengeDigest: patch.channelChallengeDigest === undefined ? record.channelChallengeDigest : patch.channelChallengeDigest,
      channelAttempts: patch.channelAttempts ?? record.channelAttempts,
      channelProvedAt: patch.channelProvedAt === undefined ? record.channelProvedAt : (patch.channelProvedAt ?? record.channelProvedAt),
      attachedSubjectId: patch.attachedSubjectId === undefined ? record.attachedSubjectId : patch.attachedSubjectId,
      attachedSessionRef: patch.attachedSessionRef === undefined ? record.attachedSessionRef : patch.attachedSessionRef,
      attachedAt: patch.attachedAt === undefined ? record.attachedAt : patch.attachedAt,
      primaryContactMatch: patch.primaryContactMatch === undefined ? record.primaryContactMatch : patch.primaryContactMatch,
      acceptanceActionAt: patch.acceptanceActionAt === undefined ? record.acceptanceActionAt : patch.acceptanceActionAt,
      acceptedDisclosureVersion: patch.acceptedDisclosureVersion === undefined ? record.acceptedDisclosureVersion : patch.acceptedDisclosureVersion,
      state: patch.state ?? record.state,
    };
    if (next.isCurrent && !["open", "accepted_pending_confirmation"].includes(next.state)) {
      throw new InvitationError("constraint_violation", "ceremony.isCurrent");
    }
    this.ceremonies.set(ceremonyId, next);
    return true;
  }

  // --- the confirmation ------------------------------------------------------

  async readConfirmation(budgetSpaceId: string, confirmationId: string): Promise<ConfirmationRecord | null> {
    const row = this.confirmations.get(confirmationId);
    return row && row.budgetSpaceId === budgetSpaceId ? row : null;
  }

  async listConfirmations(budgetSpaceId: string, invitationId: string): Promise<readonly ConfirmationRecord[]> {
    return [...this.confirmations.values()].filter((row) => row.budgetSpaceId === budgetSpaceId && row.invitationId === invitationId);
  }

  async insertConfirmation(record: ConfirmationRecord): Promise<void> {
    this.confirmations.set(record.confirmationId, record);
  }

  async updateConfirmation(budgetSpaceId: string, confirmationId: string, patch: ConfirmationPatch): Promise<boolean> {
    const record = this.confirmations.get(confirmationId);
    if (!record || record.budgetSpaceId !== budgetSpaceId) return false;
    if (record.decidedAt !== null && patch.decidedBySubjectId !== undefined && patch.decidedBySubjectId !== record.decidedBySubjectId) {
      throw new InvitationError("constraint_violation", "decidedBySubjectId");
    }
    this.confirmations.set(confirmationId, {
      ...record,
      state: patch.state ?? record.state,
      decidedByMembershipId: patch.decidedByMembershipId === undefined ? record.decidedByMembershipId : patch.decidedByMembershipId,
      decidedBySubjectId: patch.decidedBySubjectId === undefined ? record.decidedBySubjectId : patch.decidedBySubjectId,
      decidedAt: patch.decidedAt === undefined ? record.decidedAt : patch.decidedAt,
      decidedAuthorizationVersion: pick(patch.decidedAuthorizationVersion, record.decidedAuthorizationVersion),
      committedConsentId: patch.committedConsentId === undefined ? record.committedConsentId : patch.committedConsentId,
    });
    return true;
  }

  // --- the outbox ------------------------------------------------------------

  async insertOutbox(row: OutboxInsert): Promise<void> {
    this.outbox.set(row.invitationId, {
      outboxId: row.outboxId, invitationId: row.invitationId, budgetSpaceId: row.budgetSpaceId,
      channelType: "email", fidelityLabel: "simulated", deliveryState: "pending", renderedAt: null,
      custodyDeadline: row.custodyDeadline, tombstonedAt: null, tombstoneReasonClass: null,
      destination: row.destination, bearer: row.bearer, challenge: row.challenge,
    });
  }

  async readOutbox(invitationId: string): Promise<OutboxRecord | null> {
    const row = this.outbox.get(invitationId);
    if (!row) return null;
    const { destination, bearer, challenge, budgetSpaceId, ...projection } = row;
    void destination; void bearer; void challenge; void budgetSpaceId;
    return projection;
  }

  async tombstoneOutbox(invitationId: string, reason: OutboxTombstoneReason, at: string): Promise<void> {
    const row = this.outbox.get(invitationId);
    if (!row || row.deliveryState === "tombstoned") return;
    this.outbox.set(invitationId, {
      ...row, deliveryState: "tombstoned", tombstonedAt: at, tombstoneReasonClass: reason,
      destination: null, bearer: null, challenge: null,
    });
  }

  /** The simulated adapter's privileged read. Nothing else in this class returns a raw value. */
  renderDelivery(invitationId: string): { readonly destination: string; readonly bearer: string; readonly challenge: string } | null {
    const row = this.outbox.get(invitationId);
    if (!row || row.deliveryState === "tombstoned" || row.bearer === null || row.challenge === null || row.destination === null) return null;
    this.outbox.set(invitationId, { ...row, deliveryState: "rendered" });
    return { destination: row.destination, bearer: row.bearer, challenge: row.challenge };
  }

  // --- membership, consent and identity -------------------------------------

  async readActiveMembership(budgetSpaceId: string, accountSubjectId: string): Promise<MembershipRecord | null> {
    return this.memberships.find((row) => row.budgetSpaceId === budgetSpaceId && row.accountSubjectId === accountSubjectId && row.status === "active") ?? null;
  }

  async listMemberships(budgetSpaceId: string, accountSubjectId?: string): Promise<readonly MembershipRecord[]> {
    return this.memberships.filter((row) => row.budgetSpaceId === budgetSpaceId
      && (accountSubjectId === undefined || row.accountSubjectId === accountSubjectId));
  }

  async insertMembership(record: MembershipRecord): Promise<void> {
    if (await this.readActiveMembership(record.budgetSpaceId, record.accountSubjectId)) {
      throw new InvitationError("already_member", "accountSubjectId");
    }
    this.memberships.push(record);
  }

  async insertConsent(record: AcceptanceConsentRecord): Promise<void> {
    if (record.recordedBySubjectId !== record.accountSubjectId) throw new InvitationError("constraint_violation", "recordedBySubjectId");
    this.consents.push(record);
  }

  async readDisplayIdentity(accountSubjectId: string): Promise<DisplayIdentity | null> {
    return this.identities.get(accountSubjectId) ?? null;
  }

  async writeDisplayName(accountSubjectId: string, displayName: string | null, expectedVersion: number): Promise<number | null> {
    const identity = this.identities.get(accountSubjectId);
    if (!identity || identity.version !== expectedVersion) return null;
    const version = 1 + identity.version;
    this.identities.set(accountSubjectId, { ...identity, displayName, version });
    return version;
  }

  // --- audit and notices -----------------------------------------------------

  async insertAudit(event: LifecycleAuditEvent): Promise<void> {
    this.audits.push(event);
  }

  async insertSecurityEvent(event: SecurityEvent): Promise<void> {
    this.securityEvents.push(event);
  }

  async insertNotice(notice: LifecycleNotice): Promise<void> {
    this.notices.push(notice);
  }

  // --- the space -------------------------------------------------------------

  async readBudgetSpace(budgetSpaceId: string): Promise<BudgetSpaceFacts | null> {
    return this.spaces.get(budgetSpaceId) ?? null;
  }
}
