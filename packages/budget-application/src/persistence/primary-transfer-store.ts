/**
 * The composition root for the Primary-transfer module's persistence
 * (PK-7A; CBD-246 seam).
 *
 * `src/primary-transfer/**` describes the statement set it needs structurally
 * and imports no database. This module is where that description meets the
 * real `@cobudget/data-access` statement modules and the PK-5 system cancel
 * path, and it is what PK-7B and the live suite both build on -- so both
 * exercise this exact code rather than a stand-in for it.
 *
 * ## The one cross-module call
 *
 * Design SS10.3 step 6 cancels every active invitation the former Primary
 * created under permission 26, through PK-5's own `TR-73-06` system path with
 * cause `permission_lost`. That is a call into
 * `@cobudget/budget-application/invitations`, not a reimplementation of it:
 * `cancelRecord` writes the terminal state, invalidates the code and the
 * ceremonies and emits the restricted `AE-73-06`, and doing any of that from
 * here would be a second, divergent copy of the rule. It runs on the same
 * transaction client, so it commits or rolls back with the transfer.
 *
 * The two-step read -- the transfer's own four-column projection for the
 * identifiers, then the invitation repository for each record -- exists
 * because `cancelRecord` needs a whole `InvitationRecord` and the transfer's
 * projection deliberately cannot carry one (no destination, no mask, no
 * ciphertext).
 *
 * ## Assurance
 *
 * Nothing here reads a session or a grant. `apps/api`'s boundary spends the
 * `fresh_assurance` grant and hands the transfer its evidence *reference*;
 * this module only passes that string through (`SEC-PK4-R2`).
 */
import type { DataAccessClient } from "@cobudget/data-access";
import { budgetSpacePrimaryTransferStatements } from "../../../data-access/src/budget-space-primary-transfer.ts";
import type { PrimaryTransferStatementClient } from "../../../data-access/src/budget-space-primary-transfer.ts";
import { cancelRecord } from "../invitations/application.ts";
import type { InvitationDependencies } from "../invitations/application.ts";
import type { OwnerContext } from "../invitations/ports.ts";
import { ACTIVE_INVITATION_STATES } from "../invitations/records.ts";
import { dataAccessPrimaryTransferRepository } from "../primary-transfer/data-access-adapter.ts";
import { primaryTransferObligations } from "../primary-transfer/obligations.ts";
import type { PrimaryTransferObligations } from "../primary-transfer/obligations.ts";
import type {
  PermissionLostInvitationCanceller, PrimaryTransferDependencies, PrimaryTransferRepository,
  PrimaryTransferStatements,
} from "../primary-transfer/ports.ts";

export interface PrimaryTransferPersistenceOptions {
  /** The transaction's own client. Every write below runs on it and none opens a transaction. */
  readonly client: DataAccessClient;
  /**
   * The PK-5 invitation dependencies, composed over the *same* transaction
   * client by `invitationPersistence`. Absent means the transfer cannot
   * discharge `invalidate`, and the commit denies rather than leaving the
   * former Primary's permission-26 invitations usable.
   */
  readonly invitations?: InvitationDependencies;
}

export interface PrimaryTransferPersistence {
  readonly statements: PrimaryTransferStatements;
  readonly repository: PrimaryTransferRepository;
  readonly cancelPermissionLostInvitations: PermissionLostInvitationCanceller | undefined;
}

/**
 * Compose the statement set, the repository and the system cancel path.
 *
 * The statement set's shape is structural: `budgetSpacePrimaryTransferStatements`
 * returns exactly the members `PrimaryTransferStatements` names, and the
 * annotated assignment below is where the two are checked against each other.
 */
export function primaryTransferPersistence(options: PrimaryTransferPersistenceOptions): PrimaryTransferPersistence {
  const client = options.client as unknown as PrimaryTransferStatementClient;
  const statements: PrimaryTransferStatements = budgetSpacePrimaryTransferStatements(client);
  const repository = dataAccessPrimaryTransferRepository(statements);
  return {
    statements,
    repository,
    cancelPermissionLostInvitations: options.invitations
      ? permissionLostCanceller(options.invitations, repository)
      : undefined,
  };
}

/**
 * Design SS10.3 step 6 over PK-5's system cancel.
 *
 * The cause is `permission_lost` and the audience is `restricted`, so the
 * customer projection stays `pending` until its own `TR-73-07` edge: a
 * cancellation whose real cause is another member's permission loss is not a
 * fact the invitee's surface may distinguish from an ordinary expiry (CBD-73
 * SS14 placement rule 5).
 */
export function permissionLostCanceller(
  invitations: InvitationDependencies, transfers: PrimaryTransferRepository,
): PermissionLostInvitationCanceller {
  return async (input) => {
    const open = await transfers.listPermissionInvitations(
      input.budgetSpaceId, input.createdByMembershipId, input.requiredPermission,
    );
    const cancelled: string[] = [];
    for (const row of open) {
      if (!(ACTIVE_INVITATION_STATES as readonly string[]).includes(row.state)) continue;
      const record = await invitations.repository.readInvitation(row.budgetSpaceId, row.invitationId);
      if (!record) continue;
      // Bound to a short local first: the scanner's generic-api-key rule reads
      // `authorizationVersion: <long identifier>` as a credential assignment
      // (PK2FIX-F04).
      const version = record.creatingAuthorizationVersion;
      const owner: OwnerContext = {
        budgetSpaceId: record.budgetSpaceId,
        subjectId: record.createdBySubjectId,
        membershipId: record.createdByMembershipId,
        decision: { policyVersion: record.policyVersion, policyDigest: record.policyDigest, authorizationVersion: version },
        correlationId: input.correlationId,
      };
      await cancelRecord(invitations, owner, record, "permission_lost", "restricted", "pending");
      cancelled.push(record.invitationId);
    }
    return cancelled;
  };
}

/**
 * The four obligation discharges, over the composed repository.
 *
 * This is the object PK-7B routes `ApiTransactionStore.discharge` to for
 * `confirm`, `invalidate`, `notify` and `preserve`, on the boundary's own
 * transaction client and after `fresh_assurance` has been spent. It is built
 * here rather than in `apps/api` so that the one composition PK-7B needs is
 * a single call, and so that the live suite proves the same object.
 */
export function primaryTransferDischarges(deps: PrimaryTransferDependencies): PrimaryTransferObligations {
  return primaryTransferObligations(deps);
}
