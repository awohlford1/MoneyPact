import { INPUT_SCHEMA_VERSION } from "../input.ts";
import type { ApiBootstrapUserPolicyInput, ApiOrdinaryUserPolicyInput, ApiSubjectScopedUserPolicyInput, PolicyInput, Role, WorkerServicePolicyInput } from "../input.ts";
import { decide, decideUnderRegisteredVersion, expectedProvenance } from "../evaluate.ts";
import { CURRENT_POLICY_VERSION, POLICY_VERSIONS } from "../policy/registry.ts";
import type { RegisteredPolicyVersion } from "../policy/registry.ts";
import { SUBJECT_CELLS } from "../policy/v2.ts";
import { ACCOUNT_PERMISSION, PROGRESS_DETAIL_ACTION } from "../policy/v3.ts";
import { P5_BASELINE_NON_OWNER_CELLS, P5_COOWNER_INVITATION_CELLS, P5_SPACE_CELLS } from "../policy/v5.ts";

const now = "2026-09-12T12:00:00.000Z";
const later = "2026-09-12T12:10:00.000Z";
function stamp<T>(input: T): T { return { ...input, provenance: expectedProvenance(input as PolicyInput) }; }

/** A fixture defaults to the deployed version so production-path tests through `decide` survive a release
 * flip; a versioned catalog (`P1_FIXTURES`, `P2_FIXTURES`) pins its version explicitly (PC-236-019). */
export function ordinaryFixture(action: string, role: Role = "primary_owner", version: RegisteredPolicyVersion = CURRENT_POLICY_VERSION): ApiOrdinaryUserPolicyInput {
  const definition = POLICY_VERSIONS[version].actionDefinitions.find((item) => item.action === action);
  if (!definition?.resourceType) throw new Error(`No ordinary fixture definition for ${action}`);
  const input = {
    subject: { accountSubjectId: "subject-1", sessionRef: "session-ref-1", sessionVersion: 1, subjectState: "active", subjectVersion: 1 },
    assurance: { level: "fresh", boundAction: action, boundSpaceId: "space-1", expiresAt: later },
    profile: { profileId: "profile-1", profileState: "active", profileVersion: 1 },
    space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1", primaryOwnershipVersion: 1 },
    membership: { membershipId: "membership-1", role, status: "active", authorizationVersion: 1 },
    consent: { consentId: "consent-1", disclosureVersion: 1, state: "current" },
    resource: {
      type: definition.resourceType, id: "target-1", owningSpaceId: "space-1", version: 1, lifecycle: "active",
      ...(definition.resourceType === "connection" ? { authorizerSubjectId: "subject-1" } : {}),
      ...(definition.resourceType === "comment" || definition.resourceType === "interaction" ? { authorSubjectId: "subject-1" } : {}),
    },
    request: { action, purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: INPUT_SCHEMA_VERSION }, provenance: {},
  } as const satisfies ApiOrdinaryUserPolicyInput;
  return stamp(input);
}

export function bootstrapFixture(version: RegisteredPolicyVersion = CURRENT_POLICY_VERSION): ApiBootstrapUserPolicyInput {
  const input = {
    subject: { accountSubjectId: "subject-1", sessionRef: "session-ref-1", sessionVersion: 1, subjectState: "active", subjectVersion: 1 },
    assurance: { level: "session" }, profile: { profileId: "profile-1", profileState: "active", profileVersion: 1 },
    bootstrap: { candidateSpaceId: "candidate-space-1", candidatePrimaryMembershipId: "candidate-membership-1", spaceState: "absent", primaryMembershipState: "absent" },
    request: { action: "space.create", purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: INPUT_SCHEMA_VERSION }, provenance: {},
  } as const satisfies ApiBootstrapUserPolicyInput;
  return stamp(input);
}

export function serviceFixture(version: RegisteredPolicyVersion = CURRENT_POLICY_VERSION): WorkerServicePolicyInput {
  const input = {
    space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1", primaryOwnershipVersion: 1 },
    resource: { type: "period_state", id: "period-1", owningSpaceId: "space-1", version: 1, lifecycle: "active" },
    request: { action: "service.SA-92-002.generate_period_state", purpose: "SA-92-002", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "service", servicePurpose: "SA-92-002", serviceIdentity: "workload-1", workloadIdentityVersion: 1, servicePolicyVersion: 1, sourceVersion: 1 },
    serviceSource: { scheduleConfigurationVersion: 1, ruleReferenceDataVersion: 1, sourceState: "current" },
    evaluation: { adapter: "worker", evaluatedAt: now, inputSchemaVersion: INPUT_SCHEMA_VERSION }, provenance: {},
  } as const satisfies WorkerServicePolicyInput;
  return stamp(input);
}

/** p2 subject-scoped variant (section 8.5). The acting subject owns the target row and the row is bound to the
 * configured environment; a subject-self cell (no resourceType) carries no target row at all. The definition is read from
 * the named version's table, so a later version's subject cells (p5: `invitation.*`, section 8.8) use the same fixture. */
export const SUBJECT_ENVIRONMENT = "env-local-1";
/** The subject-owned target row per subject-target resource type: a previewed proposal (p2) or an open invitation ceremony (p5). */
const SUBJECT_TARGETS: Readonly<Partial<Record<string, { id: string; lifecycle: string }>>> = Object.freeze({ proposal: { id: "proposal-1", lifecycle: "previewed" }, invitation_ceremony: { id: "ceremony-1", lifecycle: "open" } });
/** The subject-scoped cells (permission `subject`) that `version` carries: five through p4, eight in p5. */
export function subjectCells(version: RegisteredPolicyVersion): readonly { action: string; obligations: readonly string[] }[] {
  return POLICY_VERSIONS[version].userCells.filter((cell) => cell.permission === "subject");
}
export function subjectFixture(action: string, version: RegisteredPolicyVersion = "p2"): ApiSubjectScopedUserPolicyInput {
  // The definition comes from the pinned version; a historical fixture pinned to a version that predates the cell (a p2 cell under
  // p1, a p5 cell under p4) takes the shape from the latest version defining it, so the not-current negatives stay expressible.
  const isSubject = (item: { action: string; permission: string }) => item.action === action && item.permission === "subject";
  const definition = POLICY_VERSIONS[version].actionDefinitions.find(isSubject) ?? Object.values(POLICY_VERSIONS).flatMap((policy) => policy.actionDefinitions).reverse().find(isSubject);
  if (!definition) throw new Error(`No subject-scoped fixture definition for ${action} in any registered version`);
  const target = definition.resourceType === undefined ? undefined : { type: definition.resourceType, ...(SUBJECT_TARGETS[definition.resourceType] ?? { id: "target-1", lifecycle: "active" }) };
  const input = {
    subject: { accountSubjectId: "subject-1", sessionRef: "session-ref-1", sessionVersion: 1, subjectState: "active", subjectVersion: 1 },
    assurance: { level: "session" }, profile: { profileId: "profile-1", profileState: "active", profileVersion: 1 },
    environment: { environmentId: SUBJECT_ENVIRONMENT },
    ...(target === undefined ? {} : {
      resource: { type: target.type, id: target.id, owningSpaceId: "none", version: 1, lifecycle: target.lifecycle, owningSubjectId: "subject-1", environmentId: SUBJECT_ENVIRONMENT },
    }),
    request: { action, purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: INPUT_SCHEMA_VERSION }, provenance: {},
  } as const satisfies ApiSubjectScopedUserPolicyInput;
  return stamp(input);
}

/** One positive fixture per space-bound user cell, in the cell's own role (PC-236-019: the identifier names the actor role).
 * Through p3 every such cell is a Primary Owner cell; p4 adds Co-owner and Collaborator cells (section 8.7). */
function userCatalog(version: RegisteredPolicyVersion) {
  return POLICY_VERSIONS[version].userCells.filter((cell) => cell.action !== "space.create" && cell.permission !== "subject")
    .map((cell) => ({ id: `${version}.user.${cell.action}.${cell.role}.api`, input: ordinaryFixture(cell.action, cell.role as Role, version), expected: cell.notation === "Deny" || cell.notation === "Not applicable" ? "deny" : "allow" }));
}
export const P1_FIXTURES = Object.freeze([
  { id: "p1.user.bootstrap.primary_owner.api", input: bootstrapFixture("p1"), expected: "allow" },
  ...userCatalog("p1"),
  { id: "p1.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture("p1"), expected: "allow" },
]);
export const P2_FIXTURES = Object.freeze([
  { id: "p2.user.bootstrap.primary_owner.api", input: bootstrapFixture("p2"), expected: "allow" },
  ...userCatalog("p2"),
  ...SUBJECT_CELLS.map((cell) => ({ id: `p2.subject.${cell.action}.acting_subject.api`, input: subjectFixture(cell.action), expected: "allow" })),
  { id: "p2.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture("p2"), expected: "allow" },
]);
/** p3 = the p2 catalog re-pinned to p3 (every carried cell) plus the section 8.6.1 manual-account cells through `userCatalog`. */
export const P3_FIXTURES = Object.freeze([
  { id: "p3.user.bootstrap.primary_owner.api", input: bootstrapFixture("p3"), expected: "allow" },
  ...userCatalog("p3"),
  ...SUBJECT_CELLS.map((cell) => ({ id: `p3.subject.${cell.action}.acting_subject.api`, input: subjectFixture(cell.action, "p3"), expected: "allow" })),
  { id: "p3.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture("p3"), expected: "allow" },
]);
/** p4 = the p3 catalog re-pinned to p4 (every carried cell) plus the section 8.7.1 Co-owner and Collaborator cells through `userCatalog`. */
export const P4_FIXTURES = Object.freeze([
  { id: "p4.user.bootstrap.primary_owner.api", input: bootstrapFixture("p4"), expected: "allow" },
  ...userCatalog("p4"),
  ...SUBJECT_CELLS.map((cell) => ({ id: `p4.subject.${cell.action}.acting_subject.api`, input: subjectFixture(cell.action, "p4"), expected: "allow" })),
  { id: "p4.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture("p4"), expected: "allow" },
]);
/** p5 = the p4 catalog re-pinned to p5 (every carried cell; the five superseded row-24/26 definitions now bind an `invitation`
 * target, which `ordinaryFixture` reads from the p5 table) plus every section 8.8.1 cell in its own role, the three invitee
 * subject cells included. */
export const P5_FIXTURES = Object.freeze([
  { id: "p5.user.bootstrap.primary_owner.api", input: bootstrapFixture("p5"), expected: "allow" },
  ...userCatalog("p5"),
  ...subjectCells("p5").map((cell) => ({ id: `p5.subject.${cell.action}.acting_subject.api`, input: subjectFixture(cell.action, "p5"), expected: "allow" })),
  { id: "p5.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture("p5"), expected: "allow" },
]);
/** p6 = the p5 catalog re-pinned to p6 (every carried cell) plus the three section 8.9 subject-self cells
 * (docs/cbd-236-p6-subject-self-amendment-proposal.md `P6-E01`): `notice.read`, `notice.mark_read`,
 * `profile.set_display_name`. */
export const P6_FIXTURES = Object.freeze([
  { id: "p6.user.bootstrap.primary_owner.api", input: bootstrapFixture("p6"), expected: "allow" },
  ...userCatalog("p6"),
  ...subjectCells("p6").map((cell) => ({ id: `p6.subject.${cell.action}.acting_subject.api`, input: subjectFixture(cell.action, "p6"), expected: "allow" })),
  { id: "p6.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture("p6"), expected: "allow" },
]);

export const ROLES: readonly Role[] = Object.freeze(["primary_owner", "co_owner", "collaborator", "viewer", "accountability_partner"]);
/** The roles that hold no cell for `action` in `version`; each denies `role_not_permitted` by absence (section 8.2). */
export function rolesWithoutCell(action: string, version: RegisteredPolicyVersion): readonly Role[] {
  return ROLES.filter((role) => !POLICY_VERSIONS[version].userCells.some((cell) => cell.action === action && cell.role === role));
}
/** A role the current version maps to no `1.view_space` cell (Viewer and Accountability Partner are unmapped in every version;
 * p5 maps Co-owner and Collaborator), so the client-asserted-role negatives below survive a release flip (SEC-P2-F6). */
export const UNMAPPED_ROLE: Role = (() => { const role = rolesWithoutCell("1.view_space", CURRENT_POLICY_VERSION)[0]; if (!role) throw new Error("every role holds a 1.view_space cell"); return role; })();

export const NEGATIVE_FAMILIES = Object.freeze([
  ["NC-236-01", "authentication alone"], ["NC-236-02", "profile ownership alone"], ["NC-236-03", "channel match alone"],
  ["NC-236-04", "invitation possession alone"], ["NC-236-05", "resource identifier alone"], ["NC-236-06", "client asserted authority"],
  ["NC-236-07", "missing input"], ["NC-236-08", "malformed input"], ["NC-236-09", "unknown input"],
  ["NC-236-10", "inactive input"], ["NC-236-11", "revoked input"], ["NC-236-12", "expired input"],
  ["NC-236-13", "stale input"], ["NC-236-14", "cross-space input"], ["NC-236-15", "unsupported input"],
] as const);

const negativeBase = ordinaryFixture("1.view_space");
const editPlan = ordinaryFixture("2a.edit_plan");
const editPlanDecision = decide(editPlan);
if (!editPlanDecision.capturedVersions) throw new Error("positive edit-plan fixture did not capture versions");
export const NEGATIVE_FIXTURES = Object.freeze([
  { id: "NC-236-01", input: { ...negativeBase, membership: undefined } },
  { id: "NC-236-02", input: { ...negativeBase, membership: undefined, profileOwnsResource: true } },
  { id: "NC-236-03", input: { ...negativeBase, membership: undefined, invitationChannelMatch: true } },
  { id: "NC-236-04", input: { ...negativeBase, membership: undefined, invitationLocatorPossessed: true } },
  { id: "NC-236-05", input: stamp({ ...negativeBase, membership: { ...negativeBase.membership, role: UNMAPPED_ROLE } }) },
  { id: "NC-236-06", input: { ...negativeBase, provenance: { ...negativeBase.provenance, "membership.role": "request_locator" } } },
  { id: "NC-236-07", input: { ...negativeBase, subject: undefined } },
  { id: "NC-236-08", input: { ...negativeBase, evaluation: { ...negativeBase.evaluation, inputSchemaVersion: "one" } } },
  { id: "NC-236-09", input: stamp({ ...negativeBase, request: { ...negativeBase.request, action: "999.unknown" } }) },
  { id: "NC-236-10", input: stamp({ ...negativeBase, subject: { ...negativeBase.subject, subjectState: "deleted" } }) },
  { id: "NC-236-11", input: stamp({ ...negativeBase, membership: { ...negativeBase.membership, status: "revoked" } }) },
  { id: "NC-236-12", input: stamp({ ...negativeBase, membership: { ...negativeBase.membership, status: "expired" } }) },
  { id: "NC-236-13", input: stamp({ ...editPlan, versions: { policyVersion: CURRENT_POLICY_VERSION, capturedAtPrecheck: { ...editPlanDecision.capturedVersions, targetVersion: 99 } } }) },
  { id: "NC-236-14", input: stamp({ ...negativeBase, resource: { ...negativeBase.resource, owningSpaceId: "other-space" } }) },
  { id: "NC-236-15", input: { ...negativeBase, versions: { policyVersion: "p99" }, provenance: { ...negativeBase.provenance } } },
] as const);

/** Section 9.4: the discriminating negative per p2 subject-scoped cell. Every entry is evaluated under p2 and must deny
 * inertly with the stated reason. `another_subject` and `wrong_environment` are row predicates for a subject-target
 * cell; a subject-self cell has no target row, so the same two families reduce to the provenance rule (NC-236-06):
 * a subject or environment fact not sourced from the session store or runtime configuration is malformed. */
export type SubjectNegativeFamily = "another_subject" | "wrong_environment" | "stale_session_version" | "service_authority" | "inactive_subject" | "inactive_profile" | "wrong_target_shape" | "wrong_target_type" | "space_bound_shape" | "worker_adapter" | "forbidden_section_empty" | "forbidden_section_populated";
/** SEC-P2-F5: sections the subject-scoped variant forbids, each injected both as an empty object and as a populated row. */
export const FORBIDDEN_SUBJECT_SECTIONS = Object.freeze({
  space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1", primaryOwnershipVersion: 1 },
  membership: { membershipId: "membership-1", role: "primary_owner", status: "active", authorizationVersion: 1 },
  consent: { consentId: "consent-1", disclosureVersion: 1, state: "current" },
  bootstrap: { candidateSpaceId: "candidate-space-1", candidatePrimaryMembershipId: "candidate-membership-1", spaceState: "absent", primaryMembershipState: "absent" },
  serviceSource: { scheduleConfigurationVersion: 1, ruleReferenceDataVersion: 1, sourceState: "current" },
} as const);
export interface SubjectNegativeFixture { readonly id: string; readonly action: string; readonly family: SubjectNegativeFamily; readonly input: unknown; readonly reason: string }
/** The subject-scoped negatives are version-derived: `version` names the registered version the fixtures are pinned to and
 * evaluated under, so a later version that carries the subject cells (p3) proves the same families without a rewrite. */
function subjectNegatives(action: string, version: RegisteredPolicyVersion = "p2"): SubjectNegativeFixture[] {
  const positive = subjectFixture(action, version);
  const precheck = decideUnderRegisteredVersion(version, positive);
  if (!precheck.capturedVersions) throw new Error(`positive subject fixture ${action} did not capture versions`);
  const target = positive.resource !== undefined;
  const id = (family: SubjectNegativeFamily) => `${version}.subject.${action}.${family}`;
  const entry = (family: SubjectNegativeFamily, input: unknown, reason: string): SubjectNegativeFixture => ({ id: id(family), action, family, input, reason });
  return [
    target
      ? entry("another_subject", stamp({ ...positive, resource: { ...positive.resource!, owningSubjectId: "subject-2" } }), "scope_mismatch")
      : entry("another_subject", { ...positive, provenance: { ...positive.provenance, "subject.accountSubjectId": "request_locator" } }, "input_invalid"),
    target
      ? entry("wrong_environment", stamp({ ...positive, resource: { ...positive.resource!, environmentId: "env-other" } }), "scope_mismatch")
      : entry("wrong_environment", { ...positive, provenance: { ...positive.provenance, "environment.environmentId": "request_locator" } }, "input_invalid"),
    entry("stale_session_version", stamp({ ...positive, versions: { policyVersion: version, capturedAtPrecheck: { ...precheck.capturedVersions, sessionVersion: 99 } } }), "stale_version"),
    entry("service_authority", stamp({ ...serviceFixture(version), request: { ...serviceFixture(version).request, action } }), "authority_mode_unsupported"),
    entry("inactive_subject", stamp({ ...positive, subject: { ...positive.subject, subjectState: "deleted" } }), "subject_not_active"),
    entry("inactive_profile", stamp({ ...positive, profile: { ...positive.profile, profileState: "absent" } }), "subject_not_active"),
    target
      ? entry("wrong_target_shape", stamp({ ...positive, resource: undefined }), "input_invalid")
      : entry("wrong_target_shape", stamp({ ...positive, resource: { type: "proposal", id: "proposal-1", owningSpaceId: "none", version: 1, lifecycle: "previewed", owningSubjectId: "subject-1", environmentId: SUBJECT_ENVIRONMENT } }), "input_invalid"),
    ...(target ? [entry("wrong_target_type" as const, stamp({ ...positive, resource: { ...positive.resource!, type: "profile" } }), "scope_mismatch")] : []),
    entry("space_bound_shape", stamp({ ...ordinaryFixture("1.view_space", "primary_owner", version), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_invalid"),
    entry("worker_adapter", stamp({ ...positive, evaluation: { ...positive.evaluation, adapter: "worker" } }), "input_invalid"),
    ...Object.entries(FORBIDDEN_SUBJECT_SECTIONS).flatMap(([section, row]) => [
      { ...entry("forbidden_section_empty", stamp({ ...positive, [section]: {} }), "input_invalid"), id: `${id("forbidden_section_empty")}.${section}` },
      { ...entry("forbidden_section_populated", stamp({ ...positive, [section]: row }), "input_invalid"), id: `${id("forbidden_section_populated")}.${section}` },
    ]),
  ];
}
export function subjectNegativeFixtures(version: RegisteredPolicyVersion): readonly SubjectNegativeFixture[] {
  return Object.freeze(subjectCells(version).flatMap((cell) => subjectNegatives(cell.action, version)));
}
export const P2_NEGATIVE_FIXTURES: readonly SubjectNegativeFixture[] = subjectNegativeFixtures("p2");

/** Sections 9.5, 9.6 and 9.7: the discriminating negative per space-bound cell (p3 Primary Owner manual-account cells; p4 adds
 * the Co-owner and Collaborator cells; p5 adds the invitation, members, transfer and baseline non-owner cells). The cells are
 * ordinary space-bound cells, so the families are the section 9.3 ones stated cell by cell: every role without a cell for the
 * action in `version`, another space, a wrong target type, an inactive space lifecycle, each stale captured version (target,
 * authorization, primary ownership, consent disclosure), service authority, an inactive subject, membership, or consent
 * (superseded and ended), the subject-scoped shape, and a missing target. Every entry is evaluated under `version` and must deny
 * inertly with the stated reason (PC-236-018). `AccountNegative*` are the p3/p4 names, kept for the package consumers. */
export type SpaceBoundNegativeFamily = "other_role" | "other_space" | "wrong_target_type" | "inactive_lifecycle" | "stale_version" | "stale_authorization_version" | "stale_primary_ownership_version" | "stale_consent_version" | "service_authority" | "inactive_subject" | "inactive_membership" | "consent_not_current" | "consent_superseded" | "subject_scoped_shape" | "missing_target"
  /** POV-N01..POV-N04 (docs/cbd-236-primary-ownership-version-amendment-proposal.md section 5; CBD-236 v0.13 section 9.7): the
   * `space.primaryOwnershipVersion` leaf is captured from the column, required, datastore-only and a positive integer. */
  | "stale_primary_ownership_column" | "missing_primary_ownership_version" | "client_asserted_primary_ownership_version" | "malformed_primary_ownership_version";
export type AccountNegativeFamily = SpaceBoundNegativeFamily;
export interface SpaceBoundNegativeFixture { readonly id: string; readonly action: string; readonly role: Role; readonly family: SpaceBoundNegativeFamily; readonly input: unknown; readonly reason: string }
export type AccountNegativeFixture = SpaceBoundNegativeFixture;
function spaceBoundNegatives(action: string, role: Role, version: RegisteredPolicyVersion): SpaceBoundNegativeFixture[] {
  const positive = ordinaryFixture(action, role, version);
  const precheck = decideUnderRegisteredVersion(version, positive);
  if (!precheck.capturedVersions) throw new Error(`positive ${version} fixture ${action} for ${role} did not capture versions`);
  const read = precheck.effectClass === "read";
  const entry = (family: SpaceBoundNegativeFamily, input: unknown, reason: string, suffix?: string): SpaceBoundNegativeFixture =>
    ({ id: `${version}.user.${action}.${role}.${family}${suffix === undefined ? "" : `.${suffix}`}`, action, role, family, input, reason });
  const stale = (family: SpaceBoundNegativeFamily, key: string) =>
    entry(family, stamp({ ...positive, versions: { policyVersion: version, capturedAtPrecheck: { ...precheck.capturedVersions, [key]: 99 } } }), "stale_version");
  return [
    ...rolesWithoutCell(action, version).map((other) => entry("other_role", ordinaryFixture(action, other, version), "role_not_permitted", other)),
    entry("other_space", stamp({ ...positive, resource: { ...positive.resource, owningSpaceId: "other-space" } }), "scope_mismatch"),
    entry("wrong_target_type", stamp({ ...positive, resource: { ...positive.resource, type: positive.resource.type === "report" ? "space" : "report" } }), "scope_mismatch"),
    // Archival ends every financial mutation (CBD-72 section 6.5); a read survives archival, so a purged space blocks it.
    entry("inactive_lifecycle", stamp({ ...positive, space: { ...positive.space, lifecycle: read ? "purged" : "archived" } }), "lifecycle_blocked"),
    stale("stale_version", "targetVersion"),
    stale("stale_authorization_version", "authorizationVersion"),
    stale("stale_primary_ownership_version", "primaryOwnershipVersion"),
    stale("stale_consent_version", "consentDisclosureVersion"),
    entry("service_authority", stamp({ ...serviceFixture(version), request: { ...serviceFixture(version).request, action } }), "authority_mode_unsupported"),
    entry("inactive_subject", stamp({ ...positive, subject: { ...positive.subject, subjectState: "deleted" } }), "subject_not_active"),
    entry("inactive_membership", stamp({ ...positive, membership: { ...positive.membership, status: "revoked" } }), "membership_not_active"),
    entry("consent_not_current", stamp({ ...positive, consent: { ...positive.consent, state: "ended" } }), "consent_not_current"),
    entry("consent_superseded", stamp({ ...positive, consent: { ...positive.consent, state: "superseded" } }), "consent_not_current"),
    entry("subject_scoped_shape", stamp({ ...subjectFixture("membership.list_own", version), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_invalid"),
    entry("missing_target", { ...positive, resource: undefined }, "input_invalid"),
    // POV-N01: the column moved (budget_space.primary_ownership_version 1 -> 2) and nothing else did; the precheck capture is
    // otherwise exact. Allows against an evaluator that aliases membership.authorizationVersion under the key (PK6-F01), so
    // it is the discriminating fixture for the capture line.
    entry("stale_primary_ownership_column", stamp({ ...positive, space: { ...positive.space, primaryOwnershipVersion: 2 }, versions: { policyVersion: version, capturedAtPrecheck: precheck.capturedVersions } }), "stale_version"),
    // POV-N02: the leaf is required; provenance restamped from the remaining leaves (the key deleted from both).
    entry("missing_primary_ownership_version", withoutPrimaryOwnershipVersion(positive), "input_invalid"),
    // POV-N03: the leaf is datastore-only; a request-sourced stamp is malformed (NC-236-06 for this leaf, cell by cell).
    entry("client_asserted_primary_ownership_version", { ...positive, provenance: { ...positive.provenance, "space.primaryOwnershipVersion": "request_locator" } }, "input_invalid"),
    // POV-N04: a string, a negative, a fraction and zero are not a version; provenance intact so only the shape rule
    // denies. SEC-POV-F1 (PROTO-API-HARDENING-003): the column's own CHECK is >= 1, so 0 is malformed like -1.
    ...([["string", "2"], ["negative", -1], ["fraction", 1.5], ["zero", 0]] as const).map(([suffix, value]) =>
      entry("malformed_primary_ownership_version", stamp({ ...positive, space: { ...positive.space, primaryOwnershipVersion: value } }), "input_invalid", suffix)),
  ];
}
/** The positive with `space.primaryOwnershipVersion` removed from the leaves and from the provenance map alike. */
function withoutPrimaryOwnershipVersion(positive: ApiOrdinaryUserPolicyInput): unknown {
  const { primaryOwnershipVersion: _leaf, ...space } = positive.space;
  const { "space.primaryOwnershipVersion": _stamp, ...provenance } = positive.provenance;
  return { ...positive, space, provenance };
}
/** POV-N05 (a positive, not a negative): `membership.authorizationVersion` 1 and `space.primaryOwnershipVersion` 7 with no
 * precheck capture. The decision must allow and capture the two keys independently; false against the retired alias. */
export function independentCaptureFixture(action: string, role: Role = "primary_owner", version: RegisteredPolicyVersion = CURRENT_POLICY_VERSION): ApiOrdinaryUserPolicyInput {
  const positive = ordinaryFixture(action, role, version);
  return stamp({ ...positive, space: { ...positive.space, primaryOwnershipVersion: 7 }, membership: { ...positive.membership, authorizationVersion: 1 } });
}
export function spaceBoundNegativeFixtures(version: RegisteredPolicyVersion, cells: readonly { action: string; role: Role }[]): readonly SpaceBoundNegativeFixture[] {
  return Object.freeze(cells.flatMap((cell) => spaceBoundNegatives(cell.action, cell.role, version)));
}
/** Every manual-account cell (the four `manual_account` operations and the row-14 detail read) that `version` carries, in
 * the cell's own role: p3 yields the five Primary Owner cells; p4 yields those five plus the eight section 8.7.1 cells. */
export function accountCells(version: RegisteredPolicyVersion): readonly { action: string; role: Role }[] {
  return POLICY_VERSIONS[version].userCells
    .filter((cell) => cell.permission === ACCOUNT_PERMISSION || cell.action === PROGRESS_DETAIL_ACTION)
    .map((cell) => ({ action: cell.action, role: cell.role as Role }));
}
export function accountNegativeFixtures(version: RegisteredPolicyVersion): readonly AccountNegativeFixture[] {
  return spaceBoundNegativeFixtures(version, accountCells(version));
}
export const P3_NEGATIVE_FIXTURES: readonly AccountNegativeFixture[] = accountNegativeFixtures("p3");
export const P4_NEGATIVE_FIXTURES: readonly AccountNegativeFixture[] = accountNegativeFixtures("p4");

/** Section 9.7: the p5 space-bound cells (section 8.8.1 groups 2 and 4, and the row-24 Co-owner column) that `version` carries,
 * in the cell's own role; empty before p5, every such cell under p5 or any later version that keeps them. */
const p5SpaceKeys = new Set([...P5_SPACE_CELLS, ...P5_COOWNER_INVITATION_CELLS, ...P5_BASELINE_NON_OWNER_CELLS].map((cell) => `${cell.action}|${cell.role}`));
export function invitationCells(version: RegisteredPolicyVersion): readonly { action: string; role: Role }[] {
  return POLICY_VERSIONS[version].userCells.filter((cell) => p5SpaceKeys.has(`${cell.action}|${cell.role}`)).map((cell) => ({ action: cell.action, role: cell.role as Role }));
}
/** Section 9.3 assurance family for a protected cell: session-only assurance, and fresh assurance bound to another action, to
 * another space, or already expired. `29.transfer_primary_ownership` is the p1 protected cell the transfer workflow ends in; the
 * p5 workflow operations under row 29 are deliberately not protected and are proven to allow at session level in the tests. */
export type AssuranceNegativeFamily = "session_only" | "bound_to_other_action" | "bound_to_other_space" | "expired";
export interface AssuranceNegativeFixture { readonly id: string; readonly action: string; readonly role: Role; readonly family: AssuranceNegativeFamily; readonly input: unknown; readonly reason: string }
export function assuranceNegativeFixtures(action: string, role: Role, version: RegisteredPolicyVersion): readonly AssuranceNegativeFixture[] {
  const positive = ordinaryFixture(action, role, version);
  const fresh = (bound: Partial<{ boundAction: string; boundSpaceId: string; expiresAt: string }>): ApiOrdinaryUserPolicyInput["assurance"] =>
    ({ level: "fresh", boundAction: bound.boundAction ?? action, boundSpaceId: bound.boundSpaceId ?? "space-1", expiresAt: bound.expiresAt ?? later });
  const entry = (family: AssuranceNegativeFamily, assurance: ApiOrdinaryUserPolicyInput["assurance"], reason: string): AssuranceNegativeFixture =>
    ({ id: `${version}.user.${action}.${role}.assurance.${family}`, action, role, family, input: stamp({ ...positive, assurance }), reason });
  return Object.freeze([
    entry("session_only", { level: "session" }, "assurance_required"),
    entry("bound_to_other_action", fresh({ boundAction: "1.view_space" }), "assurance_insufficient"),
    entry("bound_to_other_space", fresh({ boundSpaceId: "space-2" }), "assurance_insufficient"),
    entry("expired", fresh({ expiresAt: now }), "assurance_insufficient"),
  ]);
}
export const TRANSFER_CONFIRM_ACTION = "29.transfer_primary_ownership" as const;
export function invitationNegativeFixtures(version: RegisteredPolicyVersion): readonly (SpaceBoundNegativeFixture | AssuranceNegativeFixture)[] {
  return Object.freeze([...spaceBoundNegativeFixtures(version, invitationCells(version)), ...assuranceNegativeFixtures(TRANSFER_CONFIRM_ACTION, "primary_owner", version)]);
}
export const P5_NEGATIVE_FIXTURES: readonly (SpaceBoundNegativeFixture | AssuranceNegativeFixture)[] = invitationNegativeFixtures("p5");

/** Section 9.8 (proposal section 4, `P6-N01`-`P6-N07`): the discriminating negative per p6 subject-self cell,
 * generated by the same version-parameterized `subjectNegativeFixtures` p2 already uses -- no new generator code.
 * `P6-N08` (a repeat mark-read on an already-read notice) is not a `decide` fixture (proposal section 4's own
 * explanation) and belongs beside the route's own tests, not here. */
export const P6_NEGATIVE_FIXTURES: readonly SubjectNegativeFixture[] = subjectNegativeFixtures("p6");
