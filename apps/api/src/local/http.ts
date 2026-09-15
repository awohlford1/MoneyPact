/**
 * The simulated local delivery surface (PK-6; CBD-234 design section 5.3,
 * `IV-005`; `PROVIDERS-LOCAL-001`).
 *
 *   GET /v1/local/invitation-deliveries
 *
 * The prototype has no email provider. `TR-73-02` writes the raw bearer, the
 * raw destination and the six-digit channel challenge to the envelope-encrypted
 * outbox, and the PK-5 adapter (`FIDELITY_LABEL = "simulated"`, the CBD-190
 * local adapter's label) is the one component allowed to decrypt them. This
 * route renders what that adapter would have delivered -- the link and the
 * channel challenge -- on a developer-only surface, so the whole ceremony is
 * exercised end to end with the real bounded-attempt logic.
 *
 * It exists only under `COBUDGET_IDENTITY_PROVIDER=local`: `localDeliveriesHttp`
 * refuses to build the module for any other adapter, and `sessions/runtime.ts`
 * composes it only on the local path, so a non-local process never mounts the
 * route and startup fails closed if a composition ever tries. It is registered
 * as a bounded operations query (`surf-266-operations-query`,
 * `rlp-266-local-delivery-v1`, CBD266-INVITATION-RECORDS-001) on the verified
 * actor's own pool and authorized on the released `profile.read` subject-self
 * cell exactly as the identity recovery view is -- the released policy carries
 * no cell for a developer surface and this packet invents none; the cell
 * requires a live session and the local adapter's synthetic subjects are the
 * only subjects that can hold one. Reported as a finding for the Manager.
 *
 * Custody: the on-request sweep tombstones every row past its custody deadline
 * before the list is read (`DR-73-02`; there is no scheduler), so a delivery is
 * never rendered after the invitation it belongs to could still be used.
 */
import { Controller, Get, Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { DataAccessClient } from "@cobudget/data-access";
import { Authorize, Authorization } from "../authorization/http.js";
import type { EffectContext } from "../authorization/boundary.js";
import { DELIVERY_FIDELITY_LABEL } from "../../../../packages/budget-application/src/invitations/index.ts";
import type { InvitationScope } from "../invitations/persistence.ts";

export interface LocalDeliveriesDependencies {
  /** The configured identity adapter; anything but `local` is refused at composition. */
  readonly adapterKind: string;
  readonly within: (transaction: DataAccessClient) => InvitationScope;
  readonly now: () => Date;
}

export class LocalDeliverySurfaceRefused extends Error {
  constructor(adapterKind: string) {
    super(`local delivery surface refused: COBUDGET_IDENTITY_PROVIDER is "${adapterKind}", not "local" (CBD-234 design section 5.3)`);
    this.name = "LocalDeliverySurfaceRefused";
  }
}

@Module({})
export class LocalDeliveriesModule {}

export function localDeliveriesHttp(dependencies: LocalDeliveriesDependencies): { module: DynamicModule } {
  if (dependencies.adapterKind !== "local") throw new LocalDeliverySurfaceRefused(dependencies.adapterKind);

  @Controller("v1/local")
  class LocalDeliveriesController {
    @Get("invitation-deliveries")
    @Authorize({ action: "profile.read", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })
    async list(@Authorization() effect: EffectContext): Promise<unknown> {
      const { delivery } = dependencies.within(effect.transaction as DataAccessClient);
      await delivery.sweepCustody(dependencies.now().toISOString());
      const deliveries = await delivery.list();
      return {
        fidelityLabel: DELIVERY_FIDELITY_LABEL,
        deliveries: deliveries.map((item) => ({
          invitationId: item.invitationId, fidelityLabel: item.fidelityLabel, destination: item.destination,
          code: item.bearer, channelChallenge: item.challenge, custodyDeadline: item.custodyDeadline,
        })),
      };
    }
  }

  return { module: { module: LocalDeliveriesModule, controllers: [LocalDeliveriesController] } };
}
