/**
 * The simulated local delivery adapter (design proposal SS5.3, `IV-005`,
 * under `PROVIDERS-LOCAL-001`).
 *
 * There is no email provider in the prototype. `TR-73-02` writes the raw
 * bearer, the raw destination and the six-digit channel challenge to
 * `budget_space_invitation_outbox`, each envelope-encrypted with the existing
 * `COBUDGET_FIELD_ENCRYPTION` provider, and this adapter is the one component
 * allowed to decrypt them. It carries `FIDELITY_LABEL = "simulated"` exactly
 * as the CBD-190 local adapter does, for the same reason: a record of a
 * simulated delivery must never be mistaken for a real one.
 *
 * PK-6 mounts the developer-only surface
 * (`GET /v1/local/invitation-deliveries`, present only under
 * `COBUDGET_IDENTITY_PROVIDER=local` and refused at startup in any other
 * configuration). This module is the adapter behind it and holds no HTTP.
 *
 * Custody. A rendered delivery is still tombstoned when the code is consumed
 * or invalidated or at the custody deadline, whichever comes first
 * (`DR-73-02`): rendering is not the end of custody, the terminal state of
 * the code is. {@link sweepCustody} is the on-request sweep that stands in for
 * the scheduler the prototype does not have.
 */
import { DELIVERY_FIDELITY_LABEL, InvitationError } from "./records.ts";
import type { OutboxTombstoneReason } from "./ports.ts";

export { DELIVERY_FIDELITY_LABEL };

/** The decrypted payload of one outbox row. Exists only inside this adapter and its caller's response. */
export interface SimulatedDelivery {
  readonly invitationId: string;
  readonly fidelityLabel: typeof DELIVERY_FIDELITY_LABEL;
  readonly destination: string;
  /** The raw bearer, as it appears in the recipient's link. Never stored again and never logged. */
  readonly bearer: string;
  /** The six-digit channel-verification challenge `TR-73-09` compares. */
  readonly challenge: string;
  readonly custodyDeadline: string;
}

/** What the adapter needs from persistence: decrypt one row, list the live ones, mark one rendered, tombstone one. */
export interface DeliveryOutboxPort {
  readonly read: (invitationId: string) => Promise<SimulatedDelivery | null>;
  readonly listLive: () => Promise<readonly SimulatedDelivery[]>;
  readonly markRendered: (invitationId: string, at: string) => Promise<void>;
  readonly tombstone: (invitationId: string, reason: OutboxTombstoneReason, at: string) => Promise<void>;
}

export interface LocalDeliveryAdapter {
  readonly fidelityLabel: typeof DELIVERY_FIDELITY_LABEL;
  /** Every live simulated delivery, for the developer-only surface. */
  readonly list: () => Promise<readonly SimulatedDelivery[]>;
  /** One delivery, marked rendered. */
  readonly render: (invitationId: string) => Promise<SimulatedDelivery>;
  /** The channel challenge alone, which is what `TR-73-08` binds into the new ceremony. */
  readonly challengeFor: (invitationId: string) => Promise<string | null>;
  /** Tombstone every row past its custody deadline. On request, because there is no scheduler. */
  readonly sweepCustody: (now: string) => Promise<number>;
}

export function createLocalDeliveryAdapter(outbox: DeliveryOutboxPort, clock: { readonly now: () => string }): LocalDeliveryAdapter {
  return {
    fidelityLabel: DELIVERY_FIDELITY_LABEL,
    list: () => outbox.listLive(),
    render: async (invitationId) => {
      const delivery = await outbox.read(invitationId);
      if (!delivery) throw new InvitationError("invitation_not_found", "invitationId");
      await outbox.markRendered(invitationId, clock.now());
      return delivery;
    },
    challengeFor: async (invitationId) => (await outbox.read(invitationId))?.challenge ?? null,
    sweepCustody: async (now) => {
      let swept = 0;
      for (const delivery of await outbox.listLive()) {
        if (Date.parse(delivery.custodyDeadline) <= Date.parse(now)) {
          await outbox.tombstone(delivery.invitationId, "custody_deadline", now);
          swept += 1;
        }
      }
      return swept;
    },
  };
}
