import type { ApiBootstrapUserPolicyInput, ApiOrdinaryUserPolicyInput, PolicyInput, Role, WorkerServicePolicyInput } from "../input.ts";
import { decide, expectedProvenance } from "../evaluate.ts";
import { ACTION_DEFINITIONS, USER_CELLS } from "../policy/v1.ts";

const now = "2026-09-12T12:00:00.000Z";
const later = "2026-09-12T12:10:00.000Z";
function stamp<T>(input: T): T { return { ...input, provenance: expectedProvenance(input as PolicyInput) }; }

export function ordinaryFixture(action: string, role: Role = "primary_owner"): ApiOrdinaryUserPolicyInput {
  const definition = ACTION_DEFINITIONS.find((item) => item.action === action);
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
    request: { action, purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: "p1" },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies ApiOrdinaryUserPolicyInput;
  return stamp(input);
}

export function bootstrapFixture(): ApiBootstrapUserPolicyInput {
  const input = {
    subject: { accountSubjectId: "subject-1", sessionRef: "session-ref-1", sessionVersion: 1, subjectState: "active", subjectVersion: 1 },
    assurance: { level: "session" }, profile: { profileId: "profile-1", profileState: "active", profileVersion: 1 },
    bootstrap: { candidateSpaceId: "candidate-space-1", candidatePrimaryMembershipId: "candidate-membership-1", spaceState: "absent", primaryMembershipState: "absent" },
    request: { action: "space.create", purpose: "user_delegated", fieldSet: "default" }, versions: { policyVersion: "p1" },
    authority: { mode: "user_delegated" }, evaluation: { adapter: "api", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies ApiBootstrapUserPolicyInput;
  return stamp(input);
}

export function serviceFixture(): WorkerServicePolicyInput {
  const input = {
    space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1" },
    resource: { type: "period_state", id: "period-1", owningSpaceId: "space-1", version: 1, lifecycle: "active" },
    request: { action: "service.SA-92-002.generate_period_state", purpose: "SA-92-002", fieldSet: "default" }, versions: { policyVersion: "p1" },
    authority: { mode: "service", servicePurpose: "SA-92-002", serviceIdentity: "workload-1", workloadIdentityVersion: 1, servicePolicyVersion: 1, sourceVersion: 1 },
    serviceSource: { scheduleConfigurationVersion: 1, ruleReferenceDataVersion: 1, sourceState: "current" },
    evaluation: { adapter: "worker", evaluatedAt: now, inputSchemaVersion: 1 }, provenance: {},
  } as const satisfies WorkerServicePolicyInput;
  return stamp(input);
}

export const P1_FIXTURES = Object.freeze([
  { id: "p1.user.bootstrap.primary_owner.api", input: bootstrapFixture(), expected: "allow" },
  ...USER_CELLS.filter((cell) => cell.action !== "space.create").map((cell) => ({ id: `p1.user.${cell.action}.primary_owner.api`, input: ordinaryFixture(cell.action), expected: cell.notation === "Deny" || cell.notation === "Not applicable" ? "deny" : "allow" })),
  { id: "p1.service.service.SA-92-002.generate_period_state.SA-92-002.worker", input: serviceFixture(), expected: "allow" },
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
  { id: "NC-236-13", input: stamp({ ...editPlan, versions: { policyVersion: "p1", capturedAtPrecheck: { ...editPlanDecision.capturedVersions, targetVersion: 99 } } }) },
  { id: "NC-236-14", input: stamp({ ...negativeBase, resource: { ...negativeBase.resource, owningSpaceId: "other-space" } }) },
  { id: "NC-236-15", input: { ...negativeBase, versions: { policyVersion: "p99" }, provenance: { ...negativeBase.provenance } } },
] as const);
