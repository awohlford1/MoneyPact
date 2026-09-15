/**
 * Composition of the PK-5 invitations module for the API (PK-6; CBD-234
 * design sections 5, 5.3 and 13; `INVITATIONS-DESIGN-001`).
 *
 * `invitationRuntime` turns the process-wide pieces -- the CBD-246
 * field-encryption provider, the disclosure registry verified at startup, the
 * pre-authentication locator and the clock -- into one `within(transaction)`
 * that builds the dependency bundle every command needs on the transaction
 * the route already holds. Every route is exactly one `serializable`
 * transaction (the boundary's for a policy-evaluated route, the route's own
 * for the pre-authentication trio), and nothing here opens one.
 *
 * **The locator.** `packages/budget-application/src/persistence/invitation-store.ts`
 * needs a `Pick<Pool, "query">` for the three closed cross-space statements
 * (`listLiveInvitationCodes`, `locateInvitationCeremony`,
 * `locateInvitationByCode`): the code and ceremony tables are budget-space
 * scoped, and a pre-authentication request holds no budget space to scope a
 * tenant statement by. `SEC-PK5-R03` asks a later data-access packet to house
 * those statements as closed `DataAccessClient` members; until then this
 * module holds a role pool for that one purpose and never calls it itself --
 * the only readers are the three closed statement functions in
 * `packages/data-access` and `packages/budget-application`. Reported in the
 * PK-6 result as the standing CBD-246 exception it is.
 *
 * **Disclosure kinds.** The startup guard's required-kinds list
 * (`apps/api/src/budget-creation/consent-registry.ts`) still names only the
 * Primary Owner's self-disclosure, so this composition asks the registry for
 * both invitation kinds once at startup and fails the process if either is
 * missing -- the same fail-closed rule, applied where the routes that need the
 * kinds are composed.
 *
 * **Destination to subject.** `TR-73-15` suppresses a self-invitation or an
 * already-member destination at create time when the destination can be
 * resolved to an account subject. `SEC-PK5-R07` requires that resolution to
 * compare keyed tokens or ask the provider, never raw addresses. The
 * prototype's identity schema stores no contact for a subject and the local
 * provider has no directory, so `subjectForDestination` resolves nothing and
 * the recipient-side half of section 4.4 rule 6 (`attachAccount`, `TR-73-38`)
 * is what closes those two cases. The port exists so a provider-side lookup
 * can be composed later without touching a route.
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Pool } from "../../../../packages/data-access/src/driver.ts";
import type { KeyProvider } from "../../../../packages/data-access/src/encryption/provider.ts";
import { locateInvitationCeremony } from "../../../../packages/data-access/src/budget-space-invitation.ts";
import type { ConsentDisclosureSource } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";
import {
  ROLE_DISCLOSURE_KIND,
  createKeyedDigest,
} from "../../../../packages/budget-application/src/invitations/index.ts";
import type {
  InvitationDependencies, InvitationLifetimes, KeyedDigest, LocalDeliveryAdapter,
} from "../../../../packages/budget-application/src/invitations/index.ts";
import { invitationPersistence } from "../../../../packages/budget-application/src/persistence/invitation-store.ts";
import type { CeremonyLocator } from "../sessions/budget-facts.ts";

export interface InvitationRuntimeOptions {
  /** The role pool the three closed pre-authentication locator statements read. See the module comment. */
  readonly locator: Pick<Pool, "query">;
  readonly keys: KeyProvider;
  readonly disclosures: ConsentDisclosureSource;
  readonly now: () => Date;
  readonly lifetimes?: InvitationLifetimes;
}

/** What one route gets on its transaction: the PK-5 dependency bundle and the simulated delivery adapter. */
export interface InvitationScope {
  readonly deps: InvitationDependencies;
  readonly delivery: LocalDeliveryAdapter;
  /** The identifiers of every record of one space, for the owner's projection list (`24.view_invitations`). Identifiers only. */
  readonly listInvitationIds: (budgetSpaceId: string) => Promise<readonly string[]>;
}

export interface InvitationRuntime {
  readonly digest: KeyedDigest;
  /** Which budget space one ceremony id belongs to, and nothing more (the fact reader's and the surface gate's read). */
  readonly locateCeremony: CeremonyLocator;
  readonly within: (transaction: DataAccessClient) => InvitationScope;
}

const REQUIRED_INVITATION_KINDS: readonly string[] = Object.values(ROLE_DISCLOSURE_KIND);

export function invitationRuntime(options: InvitationRuntimeOptions): InvitationRuntime {
  // Fail closed at composition, before any listener effect (CBD236-CONSENT-SEMANTICS-001 item 3).
  for (const kind of REQUIRED_INVITATION_KINDS) options.disclosures.current(kind);
  const digest = createKeyedDigest(options.keys);
  const clock = { now: () => options.now().toISOString() };
  const locateCeremony: CeremonyLocator = async (ceremonyId) => {
    const row = await locateInvitationCeremony(options.locator, ceremonyId);
    return row ? { budgetSpaceId: row.budget_space_id, invitationId: row.invitation_id } : null;
  };
  return {
    digest,
    locateCeremony,
    within(transaction) {
      const persistence = invitationPersistence({ client: transaction, locatorQueryable: options.locator, keys: options.keys, clock }, digest);
      const deps: InvitationDependencies = {
        repository: persistence.repository,
        locator: persistence.locator,
        clock,
        ids: { uuid: randomUUID },
        digest,
        disclosures: options.disclosures,
        ...(options.lifetimes ? { lifetimes: options.lifetimes } : {}),
        encryptDestination: persistence.encryptDestination,
        readDestination: persistence.readDestination,
        challengeReader: (invitationId) => persistence.delivery.challengeFor(invitationId),
      };
      return {
        deps, delivery: persistence.delivery,
        listInvitationIds: async (budgetSpaceId) => (await persistence.statements.listInvitations(budgetSpaceId)).map((row) => row.invitation_id),
      };
    },
  };
}
