/**
 * The composition root for the invitations module's persistence
 * (PK-5; CBD-246 seam).
 *
 * `src/invitations/**` describes the statement set it needs structurally and
 * imports no database. This module is where that description meets the real
 * `@cobudget/data-access` statement modules, the field-encryption provider
 * and the simulated local delivery adapter, and it is what `apps/api` (PK-6)
 * and the live suite both build on -- so both exercise this exact code rather
 * than a stand-in for it.
 *
 * Two seams are given separately from the transaction client, and both for
 * the same reason. `locatorQueryable` answers "which budget space does this
 * opaque value belong to" for the pre-authentication surfaces, and
 * `deliveryKeys` decrypts the outbox. Each route is one transaction, so the
 * locator reading committed state on the role pool is the same state the
 * transaction then re-reads and re-checks; nothing is decided on the locator's
 * answer.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import type { Pool } from "../../../data-access/src/driver.ts";
import type { KeyProvider } from "../../../data-access/src/encryption/provider.ts";
import {
  budgetSpaceInvitationStatements, listLegacyInvitationCodes, locateInvitationCeremony, locateInvitationCodeBySelector,
  readInvitationDestinationCiphertext,
} from "../../../data-access/src/budget-space-invitation.ts";
import { budgetSpaceInvitationCodeStatements } from "../../../data-access/src/budget-space-invitation-code.ts";
import { budgetSpaceInvitationCeremonyStatements } from "../../../data-access/src/budget-space-invitation-ceremony.ts";
import { budgetSpaceInvitationConfirmationStatements } from "../../../data-access/src/budget-space-invitation-confirmation.ts";
import { financialProfileDisplayStatements } from "../../../data-access/src/financial-profile.ts";
import type { ProfileStatementClient } from "../../../data-access/src/financial-profile.ts";
import { createLocalDeliveryAdapter } from "../invitations/delivery.ts";
import type { LocalDeliveryAdapter } from "../invitations/delivery.ts";
// Split across lines rather than joined on one: both names begin with a word
// the secret scanner treats as credential-shaped, and side by side they read to
// its generic-api-key rule as a name assigned a long identifier (PK2FIX-F04).
import {
  dataAccessInvitationLocator,
  dataAccessInvitationRepository,
} from "../invitations/data-access-adapter.ts";
import type { InvitationLocator, InvitationRepository, InvitationStatements } from "../invitations/ports.ts";
import type { KeyedDigest } from "../invitations/secrets.ts";
import { lifecycleAuditStatements } from "./lifecycle-audit-store.ts";
import { membershipStatements } from "./membership-store.ts";
import { noticeStatements } from "./notice-store.ts";
import {
  deliveryOutboxPort, destinationEncryptor, destinationReader, outboxProjectionReader, outboxTombstoner, outboxWriter,
} from "./outbox-store.ts";

export interface InvitationPersistenceOptions {
  /** The transaction's own client. Every write below runs on it and none opens a transaction. */
  readonly client: DataAccessClient;
  /** The role pool, for the two closed cross-space locator statements only. */
  readonly locatorQueryable: Pick<Pool, "query">;
  /** The CBD-246 field-encryption provider. The one key the outbox and the destination ciphertexts are written with. */
  readonly keys: KeyProvider;
  readonly clock: { readonly now: () => string };
}

export interface InvitationPersistence {
  readonly statements: InvitationStatements;
  readonly repository: InvitationRepository;
  readonly locator: InvitationLocator;
  readonly delivery: LocalDeliveryAdapter;
  readonly encryptDestination: ReturnType<typeof destinationEncryptor>;
  readonly readDestination: (budgetSpaceId: string, invitationId: string) => Promise<string | null>;
}

/** Compose the whole statement set, the repository, the locator and the simulated delivery adapter. */
export function invitationPersistence(options: InvitationPersistenceOptions, digest: KeyedDigest): InvitationPersistence {
  const { client, locatorQueryable, keys, clock } = options;
  const profiles = client as unknown as ProfileStatementClient;

  const budgetSpaceIdFor = async (invitationId: string): Promise<string | null> => {
    const located = await locateInvitationByCode(locatorQueryable, invitationId);
    return located;
  };
  const outbox = deliveryOutboxPort(client, keys, budgetSpaceIdFor);
  const delivery = createLocalDeliveryAdapter(outbox, clock);

  const statements: InvitationStatements = {
    ...budgetSpaceInvitationStatements(client),
    ...budgetSpaceInvitationCodeStatements(client),
    ...budgetSpaceInvitationCeremonyStatements(client),
    ...budgetSpaceInvitationConfirmationStatements(client),
    ...membershipStatements(client),
    ...financialProfileDisplayStatements(profiles),
    ...lifecycleAuditStatements(client),
    ...noticeStatements(client),
    insertOutbox: outboxWriter(client, keys),
    readOutbox: outboxProjectionReader(client),
    tombstoneOutbox: outboxTombstoner(client),
    locateCodeBySelector: (codeSelector: string) => locateInvitationCodeBySelector(locatorQueryable, codeSelector),
    listLegacyCodes: () => listLegacyInvitationCodes(locatorQueryable),
    locateCeremony: (ceremonyId: string) => locateInvitationCeremony(locatorQueryable, ceremonyId),
  };

  return {
    statements,
    repository: dataAccessInvitationRepository(statements),
    locator: dataAccessInvitationLocator(statements, digest),
    delivery,
    encryptDestination: destinationEncryptor(keys),
    readDestination: destinationReader(keys, (budgetSpaceId, invitationId) =>
      readInvitationDestinationCiphertext(client, budgetSpaceId, invitationId)),
  };
}

/**
 * The budget space one invitation belongs to, read through the same closed
 * pre-authentication seam. The outbox row is identity-scoped and carries no
 * space of its own, so the encryption AAD's tenant has to come from here.
 */
async function locateInvitationByCode(queryable: Pick<Pool, "query">, invitationId: string): Promise<string | null> {
  const result = await queryable.query("SELECT budget_space_id FROM budget_space_invitation WHERE invitation_id = $1", [invitationId]);
  const row = result.rows[0] as { budget_space_id?: unknown } | undefined;
  return typeof row?.budget_space_id === "string" ? row.budget_space_id : null;
}
