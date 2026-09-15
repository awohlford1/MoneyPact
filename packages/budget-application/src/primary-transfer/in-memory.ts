/**
 * The in-memory `PrimaryTransferRepository`, for the unit proofs.
 *
 * It is not a mock: it enforces the same predicates the statement modules
 * enforce, because a double that accepted a write the database refuses would
 * make every unit test a statement about nothing. In particular it reproduces
 * the `M3` partial unique index (one live workflow per space), the consent
 * table's one-current-row-per-membership index, and the optimistic predicates
 * on `state_version`, `authorization_version` and `primary_ownership_version`
 * that stand in for `FOR UPDATE`.
 *
 * The live proof runs the same commands over the real statement modules, so
 * neither adapter is the only one exercised.
 */
import {
  OUTGOING_ROLE_AFTER, PrimaryTransferError, RECIPIENT_ROLE_AFTER, isLiveTransferState,
} from "./records.ts";
import type {
  PrimaryTransferRecord, TransferAuditEvent, TransferConsentInsert, TransferConsentRecord,
  TransferMembershipRecord, TransferNotice, TransferSpaceFacts,
} from "./records.ts";
import type {
  ConsentSupersedePatch, PermissionLostInvitation, PrimaryTransferRepository, TransferPatch,
} from "./ports.ts";

export class InMemoryPrimaryTransferRepository implements PrimaryTransferRepository {
  readonly transfers = new Map<string, PrimaryTransferRecord>();
  readonly memberships = new Map<string, TransferMembershipRecord>();
  readonly spaces = new Map<string, TransferSpaceFacts>();
  readonly consents = new Map<string, TransferConsentRecord>();
  readonly invitations = new Map<string, PermissionLostInvitation>();
  readonly audit: TransferAuditEvent[] = [];
  readonly notices: TransferNotice[] = [];

  // --- seeding ---------------------------------------------------------------

  seedSpace(facts: TransferSpaceFacts): void {
    this.spaces.set(facts.budgetSpaceId, facts);
  }

  seedMembership(record: TransferMembershipRecord): void {
    this.memberships.set(`${record.budgetSpaceId}/${record.membershipId}`, record);
  }

  seedConsent(record: TransferConsentRecord): void {
    this.consents.set(record.consentId, record);
  }

  seedInvitation(record: PermissionLostInvitation): void {
    this.invitations.set(record.invitationId, record);
  }

  // --- the workflow record ---------------------------------------------------

  async readTransfer(budgetSpaceId: string, transferId: string): Promise<PrimaryTransferRecord | null> {
    const record = this.transfers.get(transferId);
    return record && record.budgetSpaceId === budgetSpaceId ? { ...record } : null;
  }

  async findLiveTransfer(budgetSpaceId: string): Promise<PrimaryTransferRecord | null> {
    for (const record of this.transfers.values()) {
      if (record.budgetSpaceId === budgetSpaceId && isLiveTransferState(record.state)) return { ...record };
    }
    return null;
  }

  async insertTransfer(record: PrimaryTransferRecord): Promise<void> {
    if (this.transfers.has(record.transferId)) throw new PrimaryTransferError("conflict", "transferId");
    if (record.proposerMembershipId === record.recipientMembershipId) {
      throw new PrimaryTransferError("constraint_violation", "distinct_parties");
    }
    // The partial unique index.
    if (isLiveTransferState(record.state) && (await this.findLiveTransfer(record.budgetSpaceId))) {
      throw new PrimaryTransferError("conflict", "one_live_per_space");
    }
    this.transfers.set(record.transferId, { ...record });
  }

  async updateTransfer(
    budgetSpaceId: string, transferId: string, expectedStateVersion: number, patch: TransferPatch,
  ): Promise<boolean> {
    const record = this.transfers.get(transferId);
    if (!record || record.budgetSpaceId !== budgetSpaceId || record.stateVersion !== expectedStateVersion) return false;
    const advances = patch.state !== undefined && patch.state !== record.state;
    const next: PrimaryTransferRecord = {
      ...record,
      ...patch,
      stateVersion: advances ? expectedStateVersion + 1 : record.stateVersion,
    };
    this.transfers.set(transferId, next);
    return true;
  }

  // --- memberships and the space ---------------------------------------------

  async readMembership(budgetSpaceId: string, membershipId: string): Promise<TransferMembershipRecord | null> {
    const record = this.memberships.get(`${budgetSpaceId}/${membershipId}`);
    return record ? { ...record } : null;
  }

  /** Test support only: not on the repository port (`SEC-PK7A-F8`). */
  async listMemberships(budgetSpaceId: string): Promise<readonly TransferMembershipRecord[]> {
    return [...this.memberships.values()]
      .filter((row) => row.budgetSpaceId === budgetSpaceId)
      .map((row) => ({ ...row }));
  }

  async updateMembershipRole(
    budgetSpaceId: string, membershipId: string, expectedAuthorizationVersion: number, role: string,
  ): Promise<boolean> {
    const found = this.memberships.get(`${budgetSpaceId}/${membershipId}`);
    if (!found || found.authorizationVersion !== expectedAuthorizationVersion) return false;
    if (found.status !== "active") throw new PrimaryTransferError("constraint_violation", "membership.status");
    if (role === RECIPIENT_ROLE_AFTER) {
      // The partial unique index over one active primary_owner per space.
      const other = [...this.memberships.values()].find((row) =>
        row.budgetSpaceId === budgetSpaceId && row.membershipId !== membershipId
        && row.role === RECIPIENT_ROLE_AFTER && row.status === "active");
      if (other) throw new PrimaryTransferError("constraint_violation", "one_active_primary_owner");
    }
    if (role !== RECIPIENT_ROLE_AFTER && role !== OUTGOING_ROLE_AFTER) {
      throw new PrimaryTransferError("constraint_violation", "membership.role");
    }
    const nextVersion = 1 + expectedAuthorizationVersion;
    this.memberships.set(`${budgetSpaceId}/${membershipId}`, { ...found, role, authorizationVersion: nextVersion });
    return true;
  }

  async readSpace(budgetSpaceId: string): Promise<TransferSpaceFacts | null> {
    const facts = this.spaces.get(budgetSpaceId);
    return facts ? { ...facts } : null;
  }

  async movePrimaryOwnership(
    budgetSpaceId: string, recipientMembershipId: string, expectedPrimaryOwnershipVersion: number,
  ): Promise<boolean> {
    const facts = this.spaces.get(budgetSpaceId);
    if (!facts || facts.primaryOwnershipVersion !== expectedPrimaryOwnershipVersion) return false;
    // The deferred creation-invariant trigger, checked here at the same
    // instant the database checks it: at the end of the statement's
    // transaction. The double checks it eagerly, which is stricter and
    // therefore never admits something the database would refuse.
    const target = this.memberships.get(`${budgetSpaceId}/${recipientMembershipId}`);
    if (!target || target.role !== RECIPIENT_ROLE_AFTER || target.status !== "active") {
      throw new PrimaryTransferError("constraint_violation", "budget_space_creation_invariants");
    }
    this.spaces.set(budgetSpaceId, {
      ...facts,
      primaryOwnerMembershipId: recipientMembershipId,
      primaryOwnershipVersion: expectedPrimaryOwnershipVersion + 1,
    });
    return true;
  }

  // --- consent ----------------------------------------------------------------

  async readCurrentConsent(budgetSpaceId: string, membershipId: string): Promise<TransferConsentRecord | null> {
    for (const row of this.consents.values()) {
      if (row.budgetSpaceId === budgetSpaceId && row.membershipId === membershipId && row.state === "current") return { ...row };
    }
    return null;
  }

  /** Test support only: not on the repository port (`SEC-PK7A-F8`). */
  async readConsent(budgetSpaceId: string, consentId: string): Promise<TransferConsentRecord | null> {
    const row = this.consents.get(consentId);
    return row && row.budgetSpaceId === budgetSpaceId ? { ...row } : null;
  }

  async supersedeConsent(budgetSpaceId: string, consentId: string, patch: ConsentSupersedePatch): Promise<boolean> {
    const row = this.consents.get(consentId);
    if (!row || row.budgetSpaceId !== budgetSpaceId || row.state !== "current") return false;
    this.consents.set(consentId, {
      ...row, state: "superseded",
      endedAt: patch.endedAt, endedReasonClass: patch.endedReasonClass, endedByEventId: patch.endedByEventId,
    });
    return true;
  }

  async insertConsent(record: TransferConsentInsert): Promise<void> {
    if (this.consents.has(record.consentId)) throw new PrimaryTransferError("conflict", "consentId");
    if (record.accountSubjectId !== record.recordedBySubjectId) {
      throw new PrimaryTransferError("constraint_violation", "consent.recordedBySubjectId");
    }
    const membership = this.memberships.get(`${record.budgetSpaceId}/${record.membershipId}`);
    if (membership && membership.accountSubjectId !== record.accountSubjectId) {
      throw new PrimaryTransferError("constraint_violation", "consent.accountSubjectId");
    }
    // The one-current-row-per-membership unique index.
    if (await this.readCurrentConsent(record.budgetSpaceId, record.membershipId)) {
      throw new PrimaryTransferError("conflict", "one_current_per_membership");
    }
    this.consents.set(record.consentId, {
      consentId: record.consentId,
      budgetSpaceId: record.budgetSpaceId,
      membershipId: record.membershipId,
      accountSubjectId: record.accountSubjectId,
      role: record.role,
      state: record.state,
      disclosureKind: record.disclosureKind,
      supersedesConsentId: record.supersedesConsentId,
      endedAt: null,
      endedReasonClass: null,
      endedByEventId: null,
      assuranceRef: record.assuranceRef,
    });
  }

  // --- open work --------------------------------------------------------------

  async listPermissionInvitations(
    budgetSpaceId: string, createdByMembershipId: string, requiredPermission: string,
  ): Promise<readonly PermissionLostInvitation[]> {
    return [...this.invitations.values()].filter((row) =>
      row.budgetSpaceId === budgetSpaceId
      && row.createdByMembershipId === createdByMembershipId
      && row.requiredPermission === requiredPermission
      && (row.state === "created" || row.state === "pending" || row.state === "awaiting_confirmation"));
  }

  // --- audit and notices --------------------------------------------------------

  async insertAudit(event: TransferAuditEvent): Promise<void> {
    this.audit.push(event);
  }

  async insertNotice(notice: TransferNotice): Promise<void> {
    this.notices.push(notice);
  }

  // --- assertions the tests read ------------------------------------------------

  /** Every audit row of one correlation, in write order. */
  auditFor(correlationId: string): readonly TransferAuditEvent[] {
    return this.audit.filter((row) => row.correlationId === correlationId);
  }

  /** Every consent row of one membership, current first. */
  consentsFor(budgetSpaceId: string, membershipId: string): readonly TransferConsentRecord[] {
    return [...this.consents.values()]
      .filter((row) => row.budgetSpaceId === budgetSpaceId && row.membershipId === membershipId)
      .sort((a, b) => (a.state === "current" ? -1 : b.state === "current" ? 1 : 0));
  }
}
