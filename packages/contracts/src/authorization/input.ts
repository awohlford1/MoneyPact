export const INPUT_SCHEMA_VERSION = 1 as const;

export type OpaqueId = string;
export type PolicyVersion = `p${number}`;
export type Role = "primary_owner" | "co_owner" | "collaborator" | "viewer" | "accountability_partner";
export type EffectClass = "read" | "mutate" | "export" | "acknowledge" | "comment" | "lifecycle" | "protected";
export type AuthorityMode = "user_delegated" | "service";
export type ServicePurpose = `SA-92-00${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type ResourceType =
  | "space" | "plan" | "bill" | "goal" | "category" | "schedule" | "income" | "transaction"
  | "comment" | "alert_instance" | "account" | "report" | "export_package" | "membership"
  | "connection" | "link" | "interaction" | "profile" | "preference" | "period_state" | "proposal";

export type FactSource =
  | "session_store" | "delegation_store" | "datastore" | "idp_evidence" | "registry"
  | "request_locator" | "route_metadata" | "envelope_locator" | "workload_identity"
  | "server_policy_store" | "precheck_decision" | "assembler_clock" | "contracts_package"
  | "server_identifier_allocator" | "runtime_configuration";
export type FactProvenance = Readonly<Record<string, FactSource>>;

export interface ApiUserCapturedVersions {
  sessionVersion: number; subjectVersion: number; profileVersion: number; authorizationVersion: number;
  consentDisclosureVersion: number; spaceLifecycleVersion: number; primaryOwnershipVersion: number;
  targetVersion: number; policyVersion: PolicyVersion; policyDigest: string; inputSchemaVersion: number;
  [workflowVersion: string]: number | string;
}
export interface WorkerUserDelegatedCapturedVersions extends Omit<ApiUserCapturedVersions, "sessionVersion"> {
  delegationVersion: number;
}
export interface BootstrapCapturedVersions {
  sessionVersion: number; subjectVersion: number; profileVersion: number;
  policyVersion: PolicyVersion; policyDigest: string; inputSchemaVersion: number;
}
export interface ServiceCapturedVersions {
  workloadIdentityVersion: number; servicePolicyVersion: number; sourceVersion: number;
  scheduleConfigurationVersion: number; ruleReferenceDataVersion: number; spaceLifecycleVersion: number;
  targetVersion: number; policyVersion: PolicyVersion; policyDigest: string; inputSchemaVersion: number;
}
/** p2 subject-scoped cells: `targetVersion` is present only for a subject-target cell (one that names a resourceType). */
export interface SubjectScopedCapturedVersions {
  sessionVersion: number; subjectVersion: number; profileVersion: number; environmentId: OpaqueId; targetVersion?: number;
  policyVersion: PolicyVersion; policyDigest: string; inputSchemaVersion: number;
}
export type CapturedVersions = ApiUserCapturedVersions | WorkerUserDelegatedCapturedVersions | BootstrapCapturedVersions | ServiceCapturedVersions | SubjectScopedCapturedVersions;

interface CommonEvaluation { evaluatedAt: string; inputSchemaVersion: number }
interface CommonVersions { policyVersion: PolicyVersion; capturedAtPrecheck?: CapturedVersions }
interface UserSubject {
  accountSubjectId: OpaqueId; subjectState: "active" | "deletion_requested" | "deleted"; subjectVersion: number;
}
interface Profile { profileId: OpaqueId; profileState: "absent" | "active" | "deleted"; profileVersion: number }
interface AssuranceSession { level: "session"; boundAction?: never; boundSpaceId?: never; expiresAt?: never }
interface AssuranceFresh { level: "fresh"; boundAction: string; boundSpaceId: OpaqueId; expiresAt: string }
export type Assurance = AssuranceSession | AssuranceFresh;
interface Space { spaceId: OpaqueId; lifecycle: "live" | "archived" | "deletion_pending" | "purged"; lifecycleVersion: number; primaryOwnerMembershipId: OpaqueId }
interface Membership {
  membershipId: OpaqueId; role: Role; status: "active" | "pending" | "revoked" | "expired" | "inactive";
  authorizationVersion: number; viewerProfile?: { type: "full_budget" | "category_groups" | "bill_groups"; groupIds: readonly OpaqueId[]; version: number };
}
interface Consent { consentId: OpaqueId; disclosureVersion: number; state: "current" | "superseded" | "ended" }
interface Resource {
  type: ResourceType; id: OpaqueId; owningSpaceId: OpaqueId | "none"; version: number; lifecycle: string;
  authorizerSubjectId?: OpaqueId; authorSubjectId?: OpaqueId;
  /** Subject-scoped rows only (p2): the row's owning subject and bound environment, both from the datastore. */
  owningSubjectId?: OpaqueId; environmentId?: OpaqueId;
}
/** A subject-owned, space-less row such as a budget-creation proposal. */
export type SubjectScopedResource = Resource & { owningSpaceId: "none"; owningSubjectId: OpaqueId; environmentId: OpaqueId; authorizerSubjectId?: never; authorSubjectId?: never };
interface Environment { environmentId: OpaqueId }
interface UserRequest { action: string; purpose: "user_delegated"; fieldSet: "default" | readonly string[] }

export interface ApiOrdinaryUserPolicyInput {
  subject: UserSubject & { sessionRef: OpaqueId; sessionVersion: number; delegationRef?: never; delegationVersion?: never };
  assurance: Assurance; profile: Profile; bootstrap?: never; environment?: never; space: Space; membership: Membership; consent: Consent;
  resource: Resource; request: UserRequest; versions: CommonVersions; authority: { mode: "user_delegated" };
  serviceSource?: never; evaluation: CommonEvaluation & { adapter: "api" }; provenance: FactProvenance;
}
/** p2 subject-scoped variant (API only): the acting subject and the configured environment are the scope; there is no
 * space, membership, or consent. `resource` is present exactly when the action definition names a resourceType. */
export interface ApiSubjectScopedUserPolicyInput {
  subject: UserSubject & { sessionRef: OpaqueId; sessionVersion: number; delegationRef?: never; delegationVersion?: never };
  assurance: Assurance; profile: Profile; environment: Environment;
  bootstrap?: never; space?: never; membership?: never; consent?: never; resource?: SubjectScopedResource;
  request: UserRequest; versions: CommonVersions; authority: { mode: "user_delegated" };
  serviceSource?: never; evaluation: CommonEvaluation & { adapter: "api" }; provenance: FactProvenance;
}
export interface ApiBootstrapUserPolicyInput {
  subject: UserSubject & { sessionRef: OpaqueId; sessionVersion: number; delegationRef?: never; delegationVersion?: never };
  assurance: Assurance; profile: Profile;
  bootstrap: { candidateSpaceId: OpaqueId; candidatePrimaryMembershipId: OpaqueId; spaceState: "absent"; primaryMembershipState: "absent" };
  space?: never; membership?: never; consent?: never; resource?: never; environment?: never;
  request: { action: "space.create"; purpose: "user_delegated"; fieldSet: "default" };
  versions: CommonVersions; authority: { mode: "user_delegated" }; serviceSource?: never;
  evaluation: CommonEvaluation & { adapter: "api" }; provenance: FactProvenance;
}
export interface WorkerUserDelegatedPolicyInput {
  subject: UserSubject & { delegationRef: OpaqueId; delegationVersion: number; sessionRef?: never; sessionVersion?: never };
  assurance: Assurance; profile: Profile; bootstrap?: never; environment?: never; space: Space; membership: Membership; consent: Consent;
  resource: Resource; request: UserRequest; versions: CommonVersions; authority: { mode: "user_delegated" };
  serviceSource?: never; evaluation: CommonEvaluation & { adapter: "worker" }; provenance: FactProvenance;
}
export interface WorkerServicePolicyInput {
  subject?: never; assurance?: never; profile?: never; bootstrap?: never; environment?: never; membership?: never; consent?: never;
  space: Space; resource: Resource;
  request: { action: string; purpose: ServicePurpose; fieldSet: "default" | readonly string[] };
  versions: CommonVersions;
  authority: { mode: "service"; servicePurpose: ServicePurpose; serviceIdentity: OpaqueId; workloadIdentityVersion: number; servicePolicyVersion: number; sourceVersion: number };
  serviceSource: { scheduleConfigurationVersion: number; ruleReferenceDataVersion: number; sourceState: "current" | "superseded" | "disabled" };
  evaluation: CommonEvaluation & { adapter: "worker" }; provenance: FactProvenance;
}
export type PolicyInput = ApiOrdinaryUserPolicyInput | ApiBootstrapUserPolicyInput | ApiSubjectScopedUserPolicyInput | WorkerUserDelegatedPolicyInput | WorkerServicePolicyInput;
