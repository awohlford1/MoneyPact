/**
 * Datastore facts for the budget-space and proposal routes (PROTO-ACTIVATION-001,
 * targets F-TARGETS-003), layered through `createApiFactSource`'s `extend` hook.
 *
 * Ordinary p1 variant (`1.view_space`, `4.edit_category`, `2a.edit_target`):
 * the acting space and membership are named by the route's trusted locator
 * (`actingSpaceId`, `actingMembershipId`, both resolved from storage by the
 * route's pre-policy hook, never from a request field). This reader loads the
 * membership row by (space, membership, acting subject, active) and the space
 * row by tenant, and produces
 *
 *   space.*       from `budget_space`
 *   membership.*  from `budget_space_membership`
 *   consent.*     see below
 *   resource.*    for resource id = budgetSpaceId with types `space`,
 *                 `category` and `plan`: the budget's category set and plan are
 *                 whole-set resources owned by the space (INV-54), so the
 *                 owning space is the space itself, the version is the space's
 *                 lifecycle version and the lifecycle is the space's.
 *
 * Consent (PROTO-ACTIVATION-001 A6, review R06 / SEC-ACT-F01): CBD-236
 * requires `consent.{consentId, disclosureVersion, state}` on every ordinary
 * input (CBD-73 DI-91-007), but no migration creates a consent row and the
 * prototype records no disclosure. `interimOwnerSelfConsent` below is the
 * interim rule of docs/cbd-236-consent-facts-proposal.md section 9
 * (`CF-236-008`, pending the Executive decision drafted in its section 14 as
 * CBD236-CONSENT-SEMANTICS-001): a *tolerated absence of consent evidence*
 * for the local synthetic-identity prototype, not a definition of consent.
 * It emits consent facts only when every condition a to e holds and no
 * consent fact at all otherwise, so `decide` denies `input_invalid` for any
 * other membership. The emitted values are labelled constants
 * (`interim-owner-self:<membership id>`, INTERIM_DISCLOSURE_VERSION, the
 * literal source `runtime_prototype_derivation`) so every audit line shows
 * that no consent was recorded. The interim ends with the consent landing.
 *
 * Bootstrap variant (`space.create`): the server-allocated candidate space and
 * Primary-membership identifiers (`lookup.candidates`) are checked for
 * absence in the datastore -- `bootstrap.spaceState` and
 * `bootstrap.primaryMembershipState` are `absent` when no row uses the
 * identifier and `present` otherwise. The commit-time recheck repeats the
 * same reads on the transaction client, and the uniqueness constraints make
 * both absences conditions of the insert (CBD-236 section 4.3).
 *
 * Subject-scoped variant (`proposal.read`, `proposal.regenerate`; CBD-236
 * section 4.4): the proposal row is loaded only through the subject-keyed
 * statement (environment, account subject, then identifier, exactly as
 * `DurableProposalStore.locate` composes it) and its own `account_subject_id`
 * and `environment` columns are copied into `resource.owningSubjectId` and
 * `resource.environmentId` for `decide` to re-prove. `resource.version` is
 * the row's `lifecycle_revision`, so a lifecycle change between precheck and
 * commit denies `stale_version`; `resource.lifecycle` is the proposal status.
 * A row the statement does not return is simply absent from the facts.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import type { FactSource } from "@cobudget/contracts/authorization";
import type { FactLookup } from "../authorization/facts.js";
import { proposalUuid } from "../../../../packages/budget-application/src/persistence/proposal-store.ts";
import type { FactReader } from "./fact-source.ts";

const SPACE_RESOURCE_TYPES: ReadonlySet<string> = new Set(["space", "category", "plan"]);
/** The membership columns the ordinary variant and the interim consent rule read. */
const MEMBERSHIP_COLUMNS: readonly string[] = [
  "membership_id",
  "role",
  "status",
  "authorization_version", // the membership's own version (never relabelled as a disclosure version)
  "account_subject_id", // the acting subject, condition a
  "created_by_subject_id", // self-created, condition d
];

/** No disclosure was shown; this is not a registry version. `decide` requires a positive integer, so 0 cannot label it. */
export const INTERIM_DISCLOSURE_VERSION = 1;
/** The label carried on every interim consent fact, so the derivation is visible wherever the fact travels. */
export const INTERIM_CONSENT_SOURCE = "runtime_prototype_derivation";
export const INTERIM_CONSENT_ID_PREFIX = "interim-owner-self:";
/** The CBD-231 membership migration literals the interim's safety rests on; budget-facts.test.ts pins them against the migration file. */
export const INTERIM_MEMBERSHIP_ROLE = "primary_owner";
export const INTERIM_MEMBERSHIP_STATUS = "active";

export interface InterimConsentInput {
  /** `budget_space.primary_owner_membership_id` of the acting space. */
  readonly primaryOwnerMembershipId: unknown;
  /** The membership row loaded by (space, membership id, acting subject). */
  readonly membership: { readonly membership_id?: unknown; readonly role?: unknown; readonly status?: unknown; readonly account_subject_id?: unknown; readonly created_by_subject_id?: unknown } | undefined;
  readonly actingSubjectId: string;
  /** The process's identity configuration is the explicitly local adapter (development or test). */
  readonly localRuntime: boolean;
}

/**
 * docs/cbd-236-consent-facts-proposal.md section 9 (`CF-236-008`), conditions a to e. Returns the consent
 * leaves for the ordinary input or `undefined` (no consent fact at all) when any condition fails.
 */
export function interimOwnerSelfConsent(input: InterimConsentInput): Readonly<Record<string, unknown>> | undefined {
  const { membership } = input;
  if (!membership) return undefined;                                                                  // a: the acting subject's own membership exists
  if (membership.account_subject_id !== input.actingSubjectId) return undefined;                    // a: loaded for the acting subject
  if (membership.role !== INTERIM_MEMBERSHIP_ROLE || membership.status !== INTERIM_MEMBERSHIP_STATUS) return undefined; // b
  if (typeof membership.membership_id !== "string" || membership.membership_id !== input.primaryOwnerMembershipId) return undefined; // c
  if (membership.created_by_subject_id !== membership.account_subject_id) return undefined;         // d: self-created through CBD-233
  if (!input.localRuntime) return undefined;                                                          // e: local prototype only
  return {
    "consent.consentId": `${INTERIM_CONSENT_ID_PREFIX}${membership.membership_id}`,
    "consent.disclosureVersion": INTERIM_DISCLOSURE_VERSION,
    "consent.state": "current",
    // Not a PolicyInput leaf (the contract's provenance vocabulary has no such producer): a label the assembler ignores
    // and evidence readers can see on the raw fact set.
    "consent.source": INTERIM_CONSENT_SOURCE,
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function integer(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

async function spaceFacts(client: DataAccessClient, lookup: FactLookup, subjectId: string, localRuntime: boolean): Promise<Record<string, unknown> | null> {
  const { operation } = lookup;
  const spaceId = operation.actingSpaceId;
  if (typeof spaceId !== "string" || !UUID.test(spaceId)) return null;
  const facts: Record<string, unknown> = {};
  const spaces = await client.tenantSelect({ table: "budget_space", budgetSpaceId: spaceId, columns: ["budget_space_id", "lifecycle", "lifecycle_version", "primary_owner_membership_id"] });
  const space = spaces.rows[0] as Record<string, unknown> | undefined;
  if (space) {
    facts["space.spaceId"] = space.budget_space_id;
    facts["space.lifecycle"] = space.lifecycle;
    facts["space.lifecycleVersion"] = integer(space.lifecycle_version);
    facts["space.primaryOwnerMembershipId"] = space.primary_owner_membership_id;
    if (operation.resourceType && SPACE_RESOURCE_TYPES.has(operation.resourceType) && operation.resourceId === spaceId) {
      facts["resource.owningSpaceId"] = space.budget_space_id;
      facts["resource.version"] = integer(space.lifecycle_version);
      facts["resource.lifecycle"] = space.lifecycle;
    }
  }
  const membershipId = operation.actingMembershipId;
  if (typeof membershipId === "string" && UUID.test(membershipId)) {
    const memberships = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: spaceId,
      columns: MEMBERSHIP_COLUMNS,
      conditions: [{ column: "membership_id", value: membershipId }, { column: "account_subject_id", value: subjectId }] });
    const membership = memberships.rows[0] as Record<string, unknown> | undefined;
    if (membership) {
      facts["membership.membershipId"] = membership.membership_id;
      facts["membership.role"] = membership.role;
      facts["membership.status"] = membership.status;
      facts["membership.authorizationVersion"] = integer(membership.authorization_version);
      // A6: the interim owner-only derivation (section 9); any other membership gets no consent fact and denies.
      Object.assign(facts, interimOwnerSelfConsent({ primaryOwnerMembershipId: space?.primary_owner_membership_id, membership, actingSubjectId: subjectId, localRuntime }) ?? {});
    }
  }
  return facts;
}

async function proposalFacts(client: DataAccessClient, lookup: FactLookup, subjectId: string, environmentId: string): Promise<Record<string, unknown> | null> {
  const proposalId = lookup.operation.resourceId;
  if (typeof proposalId !== "string" || !/^bcp_[0-9a-f]{32}$/u.test(proposalId)) return null;
  // Environment and acting subject precede the identifier (CBD-232 section 8.1, CBD-236 section 4.4).
  const found = await client.platformSelect({ table: "budget_creation_proposal", columns: ["account_subject_id", "environment", "lifecycle_revision", "proposal_payload"], conditions: [
    { column: "environment", value: environmentId }, { column: "account_subject_id", value: subjectId }, { column: "proposal_id", value: proposalUuid(proposalId) },
  ] });
  const row = found.rows[0] as { account_subject_id?: unknown; environment?: unknown; lifecycle_revision?: unknown; proposal_payload?: { status?: unknown } } | undefined;
  if (!row) return null;
  const status = row.proposal_payload?.status;
  return {
    "resource.owningSpaceId": "none",
    "resource.version": integer(row.lifecycle_revision),
    "resource.lifecycle": typeof status === "string" ? status : undefined,
    "resource.owningSubjectId": row.account_subject_id,
    "resource.environmentId": row.environment,
  };
}

async function bootstrapFacts(client: DataAccessClient, candidates: { readonly spaceId: string; readonly membershipId: string }): Promise<Record<string, unknown> | null> {
  if (!UUID.test(candidates.spaceId) || !UUID.test(candidates.membershipId)) return null;
  const spaces = await client.tenantSelect({ table: "budget_space", budgetSpaceId: candidates.spaceId, columns: ["budget_space_id"] });
  const memberships = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId: candidates.spaceId, columns: ["membership_id"], conditions: [{ column: "membership_id", value: candidates.membershipId }] });
  return {
    "bootstrap.spaceState": spaces.rows.length === 0 ? "absent" : "present",
    "bootstrap.primaryMembershipState": memberships.rows.length === 0 ? "absent" : "present",
  };
}

/**
 * The `extend` reader for `createApiFactSource`: `environmentId` is the process's configured environment, used
 * only as a statement predicate; `localRuntime` states that the identity adapter is the explicitly local one
 * (condition e of the interim consent rule) and is false for anything else.
 */
export function budgetFactReader(environmentId: string, localRuntime: boolean): FactReader {
  return async (source: FactSource, lookup: FactLookup, client: DataAccessClient) => {
    if (source !== "datastore") return null;
    const subjectId = lookup.identity?.["subject.accountSubjectId"];
    if (typeof subjectId !== "string" || !subjectId) return null;
    if (lookup.operation.scope === "subject") return lookup.operation.resourceType === "proposal" ? proposalFacts(client, lookup, subjectId, environmentId) : null;
    if (lookup.operation.action === "space.create") return lookup.candidates ? bootstrapFacts(client, lookup.candidates) : null;
    return spaceFacts(client, lookup, subjectId, localRuntime);
  };
}
