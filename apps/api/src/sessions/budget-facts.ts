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
 *                 `category`, `plan`, `report`, `account` and `transaction`:
 *                 the budget's category set, plan, report surface, account set
 *                 and transaction set are whole-set resources owned by the
 *                 space (INV-54), so the owning space is the space itself, the
 *                 version is the space's lifecycle version and the lifecycle is
 *                 the space's. When the locator instead names a row --
 *                 PROTO-INCREMENT-B-001's `p3` account cells, the row-9
 *                 transaction cells and the CBD-211 category drill-down -- the
 *                 row's own columns answer (`rowResourceFacts`).
 *
 * Consent (CBD236-CONSENT-SEMANTICS-001 item 4; docs/cbd-236-consent-facts-
 * proposal.md section 8, `CF-236-007`): CBD-236 section 4.1 requires
 * `consent.{consentId, disclosureVersion, state}` on every ordinary input,
 * sourced from the application datastore (CBD-91 `DI-91-007`). This reader
 * reads `budget_space_consent` by a tenant-scoped statement keyed on the
 * acting membership and subject and derives NOTHING: the consent identifier,
 * the disclosure version and the state are the row's own columns. A membership
 * with a `current` row emits its facts; a membership whose rows have all left
 * `current` emits the most recent row's stored state, so `decide` denies
 * `consent_not_current`; a membership with no row emits no consent fact at
 * all, so `decide` denies `input_invalid`. Both are the same external class
 * (CBD-236 section 5.2). The interim owner-only derivation of section 9 was
 * deleted by this change, as item 5 of the decision requires -- it is gone,
 * not switched off.
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

/**
 * Resource types whose target is the budget's whole set rather than one row
 * (INV-54): the space itself, its category set, its plan, its report surface,
 * its account set and its transaction set. All six are named by the budget
 * space identifier, own the space, and carry the space's lifecycle version.
 * `account`, `transaction` and `category` are also row types -- when the
 * locator names something other than the space, the row's own columns answer
 * instead (see `rowResourceFacts`).
 */
const SPACE_RESOURCE_TYPES: ReadonlySet<string> = new Set(["space", "category", "plan", "report", "account", "transaction"]);
/** The membership columns the ordinary variant reads. `authorization_version` is the membership's own version and is never relabelled as a disclosure version. */
const MEMBERSHIP_COLUMNS: readonly string[] = ["membership_id", "role", "status", "authorization_version"];
/** The consent evidence columns of `budget_space_consent`; `recorded_at` orders the terminal rows and is not a fact. */
const CONSENT_COLUMNS: readonly string[] = ["consent_id", "disclosure_version", "state", "recorded_at"];

interface ConsentRow { readonly consent_id?: unknown; readonly disclosure_version?: unknown; readonly state?: unknown; readonly recorded_at?: unknown }

/**
 * docs/cbd-236-consent-facts-proposal.md section 8 steps 2 and 3, over the rows the tenant-scoped
 * statement returned for (space, membership, acting subject). The `current` row wins; otherwise the
 * most recently recorded row is reported with ITS OWN stored state, so `decide` denies
 * `consent_not_current` rather than being told a state no row carries. No row yields no fact.
 */
export function currentConsentRow(rows: readonly ConsentRow[]): ConsentRow | undefined {
  const current = rows.filter(row => row.state === "current");
  // The partial unique index admits at most one; more than one means the evidence is not trustworthy.
  if (current.length === 1) return current[0];
  if (current.length > 1) return undefined;
  const ordered = [...rows].sort((a, b) => Date.parse(String(b.recorded_at ?? 0)) - Date.parse(String(a.recorded_at ?? 0)));
  return ordered[0];
}

/** The consent leaves of one evidence row, or `undefined` when the row cannot supply all three. */
export function consentFactsOf(row: ConsentRow | undefined): Readonly<Record<string, unknown>> | undefined {
  if (!row) return undefined;
  const version = integer(row.disclosure_version);
  if (typeof row.consent_id !== "string" || !row.consent_id || version === undefined || version < 1 || typeof row.state !== "string" || !row.state) return undefined;
  return { "consent.consentId": row.consent_id, "consent.disclosureVersion": version, "consent.state": row.state };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function integer(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

/**
 * PROTO-INCREMENT-B-001: the `p3` and row-9 route targets that name a real row.
 *
 * `account`      -> `financial_account`: the account's own version, and a
 *                   lifecycle of `active` or `archived` projected from
 *                   `archived_at`. `decide` does not evaluate it (`SEC-P3-F1`);
 *                   the CBD-200 handler owns account-state admissibility.
 * `transaction`  -> the current `manual_transaction` version of the identity:
 *                   `revision` is the version a concurrent edit moves, so a
 *                   stale captured version denies `stale_version`.
 * `category`     -> `budget_category`, the CBD-211 drill-down target required
 *                   by `HO-236-09`. The table carries no version column, so the
 *                   row's own `updated_at` is projected to whole seconds: a
 *                   monotonic integer that changes exactly when the row does.
 *
 * Every read is tenant-scoped on the acting space, so a row belonging to
 * another budget returns nothing, no `resource.*` leaf is produced, and the
 * assembler's provenance comparison denies `input_invalid` before the handler
 * runs and before any query of the route's own. The denial is inert and
 * indistinguishable from a row that does not exist anywhere.
 */
async function rowResourceFacts(client: DataAccessClient, spaceId: string, resourceType: string, resourceId: string): Promise<Record<string, unknown> | null> {
  if (!UUID.test(resourceId)) return null;
  if (resourceType === "account") {
    const found = await client.tenantSelect({ table: "financial_account", budgetSpaceId: spaceId, columns: ["budget_space_id", "version", "archived_at"],
      conditions: [{ column: "account_id", value: resourceId }] });
    const row = found.rows[0] as { budget_space_id?: unknown; version?: unknown; archived_at?: unknown } | undefined;
    if (!row) return null;
    return { "resource.owningSpaceId": row.budget_space_id, "resource.version": integer(row.version), "resource.lifecycle": row.archived_at === null ? "active" : "archived" };
  }
  if (resourceType === "transaction") {
    const found = await client.tenantSelect({ table: "manual_transaction", budgetSpaceId: spaceId, columns: ["budget_space_id", "revision", "removed_at", "superseded_at"],
      conditions: [{ column: "transaction_id", value: resourceId }] });
    const rows = found.rows as { budget_space_id?: unknown; revision?: unknown; removed_at?: unknown; superseded_at?: unknown }[];
    const current = rows.find((row) => row.superseded_at === null);
    if (!current) return null;
    return { "resource.owningSpaceId": current.budget_space_id, "resource.version": integer(current.revision), "resource.lifecycle": current.removed_at === null ? "active" : "removed" };
  }
  if (resourceType === "category") {
    const found = await client.tenantSelect({ table: "budget_category", budgetSpaceId: spaceId, columns: ["budget_space_id", "archived_at", "updated_at"],
      conditions: [{ column: "category_id", value: resourceId }] });
    const row = found.rows[0] as { budget_space_id?: unknown; archived_at?: unknown; updated_at?: unknown } | undefined;
    if (!row) return null;
    const changed = Date.parse(String(row.updated_at));
    if (!Number.isFinite(changed)) return null;
    return { "resource.owningSpaceId": row.budget_space_id, "resource.version": Math.floor(changed / 1000), "resource.lifecycle": row.archived_at === null ? "active" : "archived" };
  }
  return null;
}

async function spaceFacts(client: DataAccessClient, lookup: FactLookup, subjectId: string): Promise<Record<string, unknown> | null> {
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
    if (operation.resourceType && SPACE_RESOURCE_TYPES.has(operation.resourceType)) {
      if (operation.resourceId === spaceId) {
        facts["resource.owningSpaceId"] = space.budget_space_id;
        facts["resource.version"] = integer(space.lifecycle_version);
        facts["resource.lifecycle"] = space.lifecycle;
      } else if (typeof operation.resourceId === "string") {
        Object.assign(facts, await rowResourceFacts(client, spaceId, operation.resourceType, operation.resourceId) ?? {});
      }
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
      // Section 8: consent comes from `budget_space_consent` and from nowhere else. The read set is the
      // acting membership's own rows for the acting subject; no row means no consent fact, and `decide`
      // then denies `input_invalid`.
      const consents = await client.tenantSelect({ table: "budget_space_consent", budgetSpaceId: spaceId,
        columns: CONSENT_COLUMNS,
        conditions: [{ column: "membership_id", value: membershipId }, { column: "account_subject_id", value: subjectId }] });
      Object.assign(facts, consentFactsOf(currentConsentRow(consents.rows as readonly ConsentRow[])) ?? {});
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
 * The `extend` reader for `createApiFactSource`: `environmentId` is the process's configured
 * environment, used only as a statement predicate. The reader takes no runtime-shape argument any
 * more -- consent is evidence in the datastore, so there is nothing left that a local runtime could
 * be permitted to assume (CBD236-CONSENT-SEMANTICS-001 item 5).
 */
export function budgetFactReader(environmentId: string): FactReader {
  return async (source: FactSource, lookup: FactLookup, client: DataAccessClient) => {
    if (source !== "datastore") return null;
    const subjectId = lookup.identity?.["subject.accountSubjectId"];
    if (typeof subjectId !== "string" || !subjectId) return null;
    if (lookup.operation.scope === "subject") return lookup.operation.resourceType === "proposal" ? proposalFacts(client, lookup, subjectId, environmentId) : null;
    if (lookup.operation.action === "space.create") return lookup.candidates ? bootstrapFacts(client, lookup.candidates) : null;
    return spaceFacts(client, lookup, subjectId);
  };
}
