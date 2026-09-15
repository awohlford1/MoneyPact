/**
 * Composition of the PK-7A Primary-transfer module for the API (PK-7B;
 * CBD-234 design sections 10, 12 and 15 PK-7 row; `INVITATIONS-DESIGN-001`).
 *
 * `primaryTransferRuntime` turns the process-wide pieces -- the disclosure
 * registry verified at startup, the PK-6 invitation composition (for the
 * design section 10.3 step 6 system cancel, which must run on the *same*
 * transaction client as the transfer) and the clock -- into one
 * `within(transaction)` that builds the dependency bundle every command needs
 * and the four obligation discharges `PrimaryTransferAuthorizationStore`
 * routes to, both on the transaction the route already holds. Every route is
 * exactly one `serializable` transaction, the boundary's, and nothing here
 * opens one.
 *
 * **The membership resource reader.** The six transfer cells name a
 * `membership` target (design section 10.2), and the merged datastore reader
 * produces `resource.*` only for the space-set types and the account,
 * transaction, category and invitation rows (`IMPL-PK4-F2`). PK-7A exported
 * `readMembershipResourceLeaves` -- a tenant-scoped read keyed on the acting
 * space -- so that this packet adds a call, not a read: `membershipLeaves`
 * below is what `sessions/budget-facts.ts` calls for a `membership` target,
 * over the dependency bundle composed on the assembler's own client.
 *
 * **Disclosure kinds.** The startup guard's required-kinds list still names
 * only the Primary Owner's self-disclosure, so this composition asks the
 * registry for both transfer kinds once at startup and fails the process if
 * either is missing -- the same fail-closed rule PK-6 applies for the
 * invitation kinds.
 *
 * **Assurance.** Nothing here reads a session or a grant. The evidence
 * reference the confirm path records is produced by `ApiTransactionStore`
 * when it spends the grant (`SEC-PK7A-F2`) and reaches the module only as
 * `ActorContext.freshAssuranceRef`.
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type { ConsentDisclosureSource } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";
import {
  OUTGOING_DISCLOSURE_KIND, RECIPIENT_DISCLOSURE_KIND, readMembershipResourceLeaves,
} from "../../../../packages/budget-application/src/primary-transfer/index.ts";
import type {
  MembershipResourceLeaves, PrimaryTransferDependencies, PrimaryTransferObligations, TransferLifetimes,
} from "../../../../packages/budget-application/src/primary-transfer/index.ts";
import {
  primaryTransferDischarges, primaryTransferPersistence,
} from "../../../../packages/budget-application/src/persistence/primary-transfer-store.ts";
import type { InvitationScope } from "../invitations/persistence.ts";

export interface PrimaryTransferRuntimeOptions {
  readonly disclosures: ConsentDisclosureSource;
  readonly now: () => Date;
  /** The PK-6 invitation composition on the same transaction: design section 10.3 step 6 cancels through PK-5's system path. */
  readonly invitations: (transaction: DataAccessClient) => InvitationScope;
  readonly lifetimes?: TransferLifetimes;
}

/** What one route gets on its transaction: the PK-7A dependency bundle and the four discharges over it. */
export interface PrimaryTransferScope {
  readonly deps: PrimaryTransferDependencies;
  readonly discharges: PrimaryTransferObligations;
}

/** The `resource.*` leaves of one membership row of the acting space, or null for any other identifier. */
export type MembershipLeavesReader = (client: DataAccessClient, budgetSpaceId: string, membershipId: string) => Promise<MembershipResourceLeaves | null>;

export interface PrimaryTransferRuntime {
  readonly within: (transaction: DataAccessClient) => PrimaryTransferScope;
  readonly membershipLeaves: MembershipLeavesReader;
}

const REQUIRED_TRANSFER_KINDS: readonly string[] = [RECIPIENT_DISCLOSURE_KIND, OUTGOING_DISCLOSURE_KIND];

export function primaryTransferRuntime(options: PrimaryTransferRuntimeOptions): PrimaryTransferRuntime {
  // Fail closed at composition, before any listener effect (CBD236-CONSENT-SEMANTICS-001 item 3).
  for (const kind of REQUIRED_TRANSFER_KINDS) options.disclosures.current(kind);
  const clock = { now: () => options.now().toISOString() };
  const bundle = (transaction: DataAccessClient, invitations: boolean): PrimaryTransferDependencies => {
    const persistence = primaryTransferPersistence({
      client: transaction,
      ...(invitations ? { invitations: options.invitations(transaction).deps } : {}),
    });
    return {
      repository: persistence.repository,
      clock,
      ids: { uuid: randomUUID },
      disclosures: options.disclosures,
      ...(options.lifetimes ? { lifetimes: options.lifetimes } : {}),
      ...(persistence.cancelPermissionLostInvitations ? { cancelPermissionLostInvitations: persistence.cancelPermissionLostInvitations } : {}),
    };
  };
  return {
    within(transaction) {
      const deps = bundle(transaction, true);
      return { deps, discharges: primaryTransferDischarges(deps) };
    },
    // The fact reader needs the repository's tenant-scoped membership read and nothing else; the
    // invitation composition is not built for it (no cancel path is ever reached from a fact read).
    membershipLeaves: (client, budgetSpaceId, membershipId) => readMembershipResourceLeaves(bundle(client, false), budgetSpaceId, membershipId),
  };
}
