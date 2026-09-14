import type { ApiBootstrapUserPolicyInput, ApiOrdinaryUserPolicyInput, ApiSubjectScopedUserPolicyInput, PolicyInput, Role, WorkerServicePolicyInput } from "../input.ts";
import { decide, decideUnderRegisteredVersion, expectedProvenance } from "../evaluate.ts";
import { CURRENT_POLICY_VERSION, POLICY_VERSIONS } from "../policy/registry.ts";
import type { RegisteredPolicyVersion } from "../policy/registry.ts";
import { SUBJECT_ACTION_DEFINITIONS, SUBJECT_CELLS } from "../policy/v2.ts";
import { P3_USER_CELLS } from "../policy/v3.ts";

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
    space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1" },
    membership: { membershipId: "membership-1", role, status: "active", authorizationVersion: 1 },
    consent: { consentId: "consent-1", disclosureVersion: 1, state: "current" },
    resource: {
      type: definition.resourceType, id: "target-1", owningSpaceId: "space-1", version: 1, lifecycle: "active",
      ...(definition.resourceType === "connection" ? { authorizerSubjectId: "subject-1" } : {}),
      ...(definition.resourceType === "comment" || definition.resourceType === "interaction" ? { authorSubjectId: "subject-1" } : {}),
    },
    request: { action, purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies ApiOrdinaryUserPolicyInput;
  return stamp(input);
}

export function bootstrapFixture(version: RegisteredPolicyVersion = CURRENT_POLICY_VERSION): ApiBootstrapUserPolicyInput {
  const input = {
    subject: { accountSubjectId: "subject-1", sessionRef: "session-ref-1", sessionVersion: 1, subjectState: "active", subjectVersion: 1 },
    assurance: { level: "session" }, profile: { profileId: "profile-1", profileState: "active", profileVersion: 1 },
    bootstrap: { candidateSpaceId: "candidate-space-1", candidatePrimaryMembershipId: "candidate-membership-1", spaceState: "absent", primaryMembershipState: "absent" },
    request: { action: "space.create", purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies ApiBootstrapUserPolicyInput;
  return stamp(input);
}

export function serviceFixture(version: RegisteredPolicyVersion = CURRENT_POLICY_VERSION): WorkerServicePolicyInput {
  const input = {
    space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1" },
    resource: { type: "period_state", id: "period-1", owningSpaceId: "space-1", version: 1, lifecycle: "active" },
    request: { action: "service.SA-92-002.generate_period_state", purpose: "SA-92-002", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "service", servicePurpose: "SA-92-002", serviceIdentity: "workload-1", workloadIdentityVersion: 1, servicePolicyVersion: 1, sourceVersion: 1 },
    serviceSource: { scheduleConfigurationVersion: 1, ruleReferenceDataVersion: 1, sourceState: "current" },
    evaluation: { adapter: "worker", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies WorkerServicePolicyInput;
  return stamp(input);
}

/** p2 subject-scoped variant (section 8.5). The acting subject owns the target row and the row is bound to the
 * configured environment; a subject-self cell (no resourceType) carries no target row at all. */
export const SUBJECT_ENVIRONMENT = "env-local-1";
export function subjectFixture(action: string, version: RegisteredPolicyVersion = "p2"): ApiSubjectScopedUserPolicyInput {
  const definition = SUBJECT_ACTION_DEFINITIONS.find((item) => item.action === action);
  if (!definition) throw new Error(`No subject-scoped fixture definition for ${action}`);
  const input = {
    subject: { accountSubjectId: "subject-1", sessionRef: "session-ref-1", sessionVersion: 1, subjectState: "active", subjectVersion: 1 },
    assurance: { level: "session" }, profile: { profileId: "profile-1", profileState: "active", profileVersion: 1 },
    environment: { environmentId: SUBJECT_ENVIRONMENT },
    ...(definition.resourceType === undefined ? {} : {
      resource: { type: definition.resourceType, id: "proposal-1", owningSpaceId: "none", version: 1, lifecycle: "previewed", owningSubjectId: "subject-1", environmentId: SUBJECT_ENVIRONMENT },
    }),
    request: { action, purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: version },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies ApiSubjectScopedUserPolicyInput;
  return stamp(input);
}

function userCatalog(version: RegisteredPolicyVersion) {
  return POLICY_VERSIONS[version].userCells.filter((cell) => cell.action !== "space.create" && cell.permission !== "subject")
    .map((cell) => ({ id: `${version}.user.${cell.action}.primary_owner.api`, input: ordinaryFixture(cell.action, "primary_owner", version), expected: cell.notation === "Deny" || cell.notation === "Not applicable" ? "deny" : "allow" }));
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
  { id: "NC-236-05", input: stamp({ ...negativeBase, membership: { ...negativeBase.membership, role: "co_owner" } }) },
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
  space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1" },
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
  return Object.freeze(SUBJECT_CELLS.flatMap((cell) => subjectNegatives(cell.action, version)));
}
export const P2_NEGATIVE_FIXTURES: readonly SubjectNegativeFixture[] = subjectNegativeFixtures("p2");

/** Section 9.5: the discriminating negative per p3 manual-account cell. The cells are ordinary space-bound Primary Owner
 * cells, so the families are the section 9.3 ones stated cell by cell: every other role, another space, a wrong target
 * type, an inactive space lifecycle, a stale captured version, service authority, an inactive subject, membership, or
 * consent, the subject-scoped shape, and a missing target. Every entry is evaluated under `version` and must deny inertly
 * with the stated reason (PC-236-018). */
export type AccountNegativeFamily = "other_role" | "other_space" | "wrong_target_type" | "inactive_lifecycle" | "stale_version" | "service_authority" | "inactive_subject" | "inactive_membership" | "consent_not_current" | "subject_scoped_shape" | "missing_target";
export interface AccountNegativeFixture { readonly id: string; readonly action: string; readonly family: AccountNegativeFamily; readonly input: unknown; readonly reason: string }
function accountNegatives(action: string, version: RegisteredPolicyVersion): AccountNegativeFixture[] {
  const positive = ordinaryFixture(action, "primary_owner", version);
  const precheck = decideUnderRegisteredVersion(version, positive);
  if (!precheck.capturedVersions) throw new Error(`positive p3 fixture ${action} did not capture versions`);
  const read = precheck.effectClass === "read";
  const entry = (family: AccountNegativeFamily, input: unknown, reason: string, suffix?: string): AccountNegativeFixture =>
    ({ id: `${version}.user.${action}.${family}${suffix === undefined ? "" : `.${suffix}`}`, action, family, input, reason });
  return [
    ...(["co_owner", "collaborator", "viewer", "accountability_partner"] as const).map((role) => entry("other_role", ordinaryFixture(action, role, version), "role_not_permitted", role)),
    entry("other_space", stamp({ ...positive, resource: { ...positive.resource, owningSpaceId: "other-space" } }), "scope_mismatch"),
    entry("wrong_target_type", stamp({ ...positive, resource: { ...positive.resource, type: "report" } }), "scope_mismatch"),
    // Archival ends every financial mutation (CBD-72 section 6.5); a read survives archival, so a purged space blocks it.
    entry("inactive_lifecycle", stamp({ ...positive, space: { ...positive.space, lifecycle: read ? "purged" : "archived" } }), "lifecycle_blocked"),
    entry("stale_version", stamp({ ...positive, versions: { policyVersion: version, capturedAtPrecheck: { ...precheck.capturedVersions, targetVersion: 99 } } }), "stale_version"),
    entry("service_authority", stamp({ ...serviceFixture(version), request: { ...serviceFixture(version).request, action } }), "authority_mode_unsupported"),
    entry("inactive_subject", stamp({ ...positive, subject: { ...positive.subject, subjectState: "deleted" } }), "subject_not_active"),
    entry("inactive_membership", stamp({ ...positive, membership: { ...positive.membership, status: "revoked" } }), "membership_not_active"),
    entry("consent_not_current", stamp({ ...positive, consent: { ...positive.consent, state: "ended" } }), "consent_not_current"),
    entry("subject_scoped_shape", stamp({ ...subjectFixture("membership.list_own", version), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_invalid"),
    entry("missing_target", { ...positive, resource: undefined }, "input_invalid"),
  ];
}
export function accountNegativeFixtures(version: RegisteredPolicyVersion): readonly AccountNegativeFixture[] {
  return Object.freeze(P3_USER_CELLS.flatMap((cell) => accountNegatives(cell.action, version)));
}
export const P3_NEGATIVE_FIXTURES: readonly AccountNegativeFixture[] = accountNegativeFixtures("p3");
