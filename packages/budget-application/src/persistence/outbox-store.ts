/**
 * The custody half of the simulated local delivery adapter (design proposal
 * SS5.3; `DR-73-02`).
 *
 * This is the only module in the repository that encrypts or decrypts an
 * invitation's destination, raw bearer or channel challenge. It lives in
 * `persistence/` for the same reason `consent-store.ts` does: the decision
 * about *what* a delivery contains is the application module's and has no
 * database in it (CBD-232 SS3.1), while the CBD-246 seam that writes it --
 * and here, the CBD-246 field-encryption provider that protects it -- is
 * composition.
 *
 * Every ciphertext is bound to its row by the cipher's own AAD: the tenant is
 * the budget space, the table and column are the ones it is stored in, and
 * the row id is the outbox row's. A ciphertext moved to another row, another
 * column or another space fails to decrypt with an authentication error
 * rather than silently returning a value, which is what makes the custody
 * boundary a property of the data and not of the code that reads it.
 */
import { decryptField, encryptField } from "../../../data-access/src/encryption/cipher.ts";
import type { Ciphertext, EncryptionContext } from "../../../data-access/src/encryption/cipher.ts";
import type { KeyProvider } from "../../../data-access/src/encryption/provider.ts";
import {
  insertInvitationOutbox, listLiveInvitationOutbox, markInvitationOutboxRendered,
  readInvitationOutbox, readInvitationOutboxPayload, tombstoneInvitationOutbox,
} from "../../../data-access/src/budget-space-invitation-outbox.ts";
import type { PlatformStatementClient } from "../../../data-access/src/budget-space-invitation-outbox.ts";
import type { DeliveryOutboxPort, SimulatedDelivery } from "../invitations/delivery.ts";
import type { OutboxInsert, OutboxTombstoneReason } from "../invitations/ports.ts";
import { DELIVERY_FIDELITY_LABEL } from "../invitations/records.ts";

const OUTBOX_TABLE = "budget_space_invitation_outbox";
const INVITATION_TABLE = "budget_space_invitation";

/** A `bytea` column holds the JSON envelope the CBD-246 cipher produces, UTF-8 encoded. */
function encode(value: Ciphertext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decode(value: Uint8Array): Ciphertext {
  return JSON.parse(new TextDecoder().decode(value)) as Ciphertext;
}

function context(tenantId: string, table: string, rowId: string, column: string): EncryptionContext {
  return { tenantId, table, rowId, column };
}

/**
 * The invitation row's own `destination_ciphertext`, bound to that row. This
 * is what `TR-73-01` hands the state service as its `encryptDestination`
 * port.
 */
export function destinationEncryptor(keys: KeyProvider) {
  return async (target: { readonly budgetSpaceId: string; readonly invitationId: string }, destination: string): Promise<Uint8Array> =>
    encode(await encryptField(keys, destination, context(target.budgetSpaceId, INVITATION_TABLE, target.invitationId, "destination_ciphertext")));
}

/** The decrypting read of one invitation's destination, for `TR-73-05` and the masked-projection reader. */
export function destinationReader(keys: KeyProvider, read: (budgetSpaceId: string, invitationId: string) => Promise<Uint8Array | null>) {
  return async (budgetSpaceId: string, invitationId: string): Promise<string | null> => {
    const stored = await read(budgetSpaceId, invitationId);
    if (!stored) return null;
    return decryptField(keys, decode(stored), context(budgetSpaceId, INVITATION_TABLE, invitationId, "destination_ciphertext"));
  };
}

/**
 * The outbox insert the state service's `TR-73-02` calls. It takes the three
 * raw values and returns nothing: after this call the address, the bearer and
 * the challenge exist in the database only as ciphertext, and in the process
 * only for as long as the caller's own local variables live.
 */
export function outboxWriter(client: PlatformStatementClient, keys: KeyProvider) {
  return async (row: OutboxInsert): Promise<void> => {
    const [destination, bearer, challenge] = await Promise.all([
      encryptField(keys, row.destination, context(row.budgetSpaceId, OUTBOX_TABLE, row.outboxId, "destination_ciphertext")),
      encryptField(keys, row.bearer, context(row.budgetSpaceId, OUTBOX_TABLE, row.outboxId, "bearer_ciphertext")),
      encryptField(keys, row.challenge, context(row.budgetSpaceId, OUTBOX_TABLE, row.outboxId, "challenge_ciphertext")),
    ]);
    await insertInvitationOutbox(client, {
      outbox_id: row.outboxId,
      invitation_id: row.invitationId,
      channel_type: row.channelType,
      destination_ciphertext: encode(destination),
      bearer_ciphertext: encode(bearer),
      challenge_ciphertext: encode(challenge),
      custody_deadline: row.custodyDeadline,
    });
  };
}

/**
 * The decrypting port the simulated local delivery adapter is built on.
 * `budgetSpaceIdFor` is how the AAD's tenant is recovered: the outbox row is
 * identity-scoped and carries no budget-space column, so the space comes from
 * the invitation the row belongs to.
 */
export function deliveryOutboxPort(
  client: PlatformStatementClient, keys: KeyProvider,
  budgetSpaceIdFor: (invitationId: string) => Promise<string | null>,
): DeliveryOutboxPort {
  async function open(row: Awaited<ReturnType<typeof readInvitationOutboxPayload>>): Promise<SimulatedDelivery | null> {
    if (!row || row.destination_ciphertext === null || row.bearer_ciphertext === null || row.challenge_ciphertext === null) return null;
    const budgetSpaceId = await budgetSpaceIdFor(row.invitation_id);
    if (budgetSpaceId === null) return null;
    const [destination, bearer, challenge] = await Promise.all([
      decryptField(keys, decode(row.destination_ciphertext), context(budgetSpaceId, OUTBOX_TABLE, row.outbox_id, "destination_ciphertext")),
      decryptField(keys, decode(row.bearer_ciphertext), context(budgetSpaceId, OUTBOX_TABLE, row.outbox_id, "bearer_ciphertext")),
      decryptField(keys, decode(row.challenge_ciphertext), context(budgetSpaceId, OUTBOX_TABLE, row.outbox_id, "challenge_ciphertext")),
    ]);
    return {
      invitationId: row.invitation_id, fidelityLabel: DELIVERY_FIDELITY_LABEL,
      destination, bearer, challenge, custodyDeadline: row.custody_deadline,
    };
  }

  return {
    read: async (invitationId) => open(await readInvitationOutboxPayload(client, invitationId)),
    listLive: async () => {
      const deliveries: SimulatedDelivery[] = [];
      for (const row of await listLiveInvitationOutbox(client)) {
        const delivery = await open(row);
        if (delivery) deliveries.push(delivery);
      }
      return deliveries;
    },
    markRendered: async (invitationId, at) => {
      await markInvitationOutboxRendered(client, invitationId, at);
    },
    tombstone: async (invitationId, reason: OutboxTombstoneReason, at) => {
      await tombstoneInvitationOutbox(client, invitationId, reason, at);
    },
  };
}

/** The payload-free projection the state service reads; it never sees a ciphertext. */
export function outboxProjectionReader(client: PlatformStatementClient) {
  return (invitationId: string) => readInvitationOutbox(client, invitationId);
}

/** The tombstone the state service calls when a code is consumed or invalidated. */
export function outboxTombstoner(client: PlatformStatementClient) {
  return (invitationId: string, reasonClass: string, at: string) => tombstoneInvitationOutbox(client, invitationId, reasonClass, at);
}
