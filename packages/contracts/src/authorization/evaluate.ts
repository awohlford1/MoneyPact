import type { Obligation, PolicyDecision } from "./decision.ts";
import type { ApiBootstrapUserPolicyInput, ApiOrdinaryUserPolicyInput, ApiSubjectScopedUserPolicyInput, CapturedVersions, FactProvenance, FactSource, PolicyInput, PolicyVersion, WorkerServicePolicyInput, WorkerUserDelegatedPolicyInput } from "./input.ts";
import { INPUT_SCHEMA_VERSION } from "./input.ts";
import type { ReasonClass } from "./reason.ts";
import { sha256 } from "./canonical.ts";
import { CURRENT_POLICY, POLICY_VERSIONS } from "./policy/registry.ts";
import type { RegisteredPolicy, RegisteredPolicyVersion } from "./policy/registry.ts";

type UnknownRecord = Record<string, unknown>;
const audit: Obligation = { kind: "audit", eventClass: "policy_decision" };

function isRecord(value: unknown): value is UnknownRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isPositiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function isService(input: PolicyInput): input is WorkerServicePolicyInput { return input.authority.mode === "service"; }
function isBootstrap(input: PolicyInput): input is ApiBootstrapUserPolicyInput { return "bootstrap" in input && input.bootstrap !== undefined; }
function isSubjectScoped(input: PolicyInput): input is ApiSubjectScopedUserPolicyInput { return !isService(input) && !isBootstrap(input) && "environment" in input && input.environment !== undefined; }
function isWorkerUser(input: PolicyInput): input is WorkerUserDelegatedPolicyInput { return !isService(input) && !isBootstrap(input) && !isSubjectScoped(input) && input.evaluation.adapter === "worker"; }

function comparable(input: UnknownRecord): UnknownRecord {
  const copy = structuredClone(input);
  delete copy.provenance;
  const evaluation = copy.evaluation;
  if (isRecord(evaluation)) delete evaluation.evaluatedAt;
  const versions = copy.versions;
  if (isRecord(versions)) delete versions.capturedAtPrecheck;
  return copy;
}

function baseDecision(input: unknown, policy: RegisteredPolicy, reasonClass: ReasonClass, effectClass?: PolicyDecision["effectClass"]): PolicyDecision {
  const record = isRecord(input) ? input : {};
  const versions = isRecord(record.versions) ? record.versions : {};
  const evaluation = isRecord(record.evaluation) ? record.evaluation : {};
  const policyVersion = typeof versions.policyVersion === "string" && /^p\d+$/.test(versions.policyVersion) ? versions.policyVersion as PolicyVersion : policy.version;
  const inputDigest = sha256(comparable(record));
  return {
    outcome: "deny", reasonClass, policyVersion, policyDigest: policyVersion === policy.version ? policy.digest : "",
    inputDigest, obligations: [audit], decisionId: sha256({ policyVersion, inputDigest }).slice(0, 32),
    evaluatedAt: typeof evaluation.evaluatedAt === "string" ? evaluation.evaluatedAt : "1970-01-01T00:00:00.000Z",
    ...(effectClass === undefined ? {} : { effectClass }),
  };
}

function add(target: Record<string, FactSource>, source: FactSource, ...paths: string[]): void {
  for (const path of paths) target[path] = source;
}
function leafPaths(value: unknown, prefix = ""): string[] {
  // An empty object is itself a present leaf (SEC-P2-F5): a section such as `space: {}` has no producer and must not vanish from the comparison.
  if (Array.isArray(value) || !isRecord(value) || (prefix !== "" && Object.keys(value).length === 0)) return prefix === "" ? [] : [prefix];
  return Object.entries(value).flatMap(([key, item]) => key === "provenance" ? [] : leafPaths(item, prefix === "" ? key : `${prefix}.${key}`));
}
const forbiddenInSubjectVariant = ["space", "membership", "consent", "bootstrap", "serviceSource"] as const;

export function expectedProvenance(input: PolicyInput): FactProvenance {
  const result: Record<string, FactSource> = {};
  const bootstrap = isBootstrap(input);
  const subjectScoped = isSubjectScoped(input);
  const worker = input.evaluation.adapter === "worker";
  if (!isService(input)) {
    add(result, worker ? "delegation_store" : "session_store", "subject.accountSubjectId");
    add(result, "datastore", "subject.subjectState", "subject.subjectVersion", "profile.profileId", "profile.profileState", "profile.profileVersion");
    if (worker) add(result, "delegation_store", "subject.delegationRef", "subject.delegationVersion", "assurance.level");
    else add(result, "session_store", "subject.sessionRef", "subject.sessionVersion");
    if (!worker) add(result, "idp_evidence", "assurance.level");
    if (input.assurance.level === "fresh") add(result, worker ? "delegation_store" : "idp_evidence", "assurance.boundAction", "assurance.boundSpaceId", "assurance.expiresAt");
  }
  if (isBootstrap(input)) {
    add(result, "server_identifier_allocator", "bootstrap.candidateSpaceId", "bootstrap.candidatePrimaryMembershipId");
    add(result, "datastore", "bootstrap.spaceState", "bootstrap.primaryMembershipState");
  } else if (isSubjectScoped(input)) {
    // Section 4.4: the configured environment is a runtime fact; a subject-owned row carries its owner and environment from the datastore.
    add(result, "runtime_configuration", "environment.environmentId");
    if (input.resource !== undefined) {
      add(result, "route_metadata", "resource.type"); add(result, "request_locator", "resource.id");
      add(result, "datastore", "resource.owningSpaceId", "resource.version", "resource.lifecycle", "resource.owningSubjectId", "resource.environmentId");
    }
  } else {
    add(result, "datastore", "space.spaceId", "space.lifecycle", "space.lifecycleVersion", "space.primaryOwnerMembershipId", "space.primaryOwnershipVersion");
    add(result, "envelope_locator", "resource.type", "resource.id");
    if (!worker) { result["resource.type"] = "route_metadata"; result["resource.id"] = "request_locator"; }
    add(result, "datastore", "resource.owningSpaceId", "resource.version", "resource.lifecycle");
    if (input.resource.type === "connection" && input.resource.authorizerSubjectId !== undefined) add(result, "datastore", "resource.authorizerSubjectId");
    if ((input.resource.type === "comment" || input.resource.type === "interaction") && input.resource.authorSubjectId !== undefined) add(result, "datastore", "resource.authorSubjectId");
    if (!isService(input)) {
      add(result, "datastore", "membership.membershipId", "membership.role", "membership.status", "membership.authorizationVersion", "consent.consentId", "consent.disclosureVersion", "consent.state");
      if (input.membership.viewerProfile !== undefined) add(result, "datastore", "membership.viewerProfile.type", "membership.viewerProfile.groupIds", "membership.viewerProfile.version");
    }
  }
  add(result, "registry", "versions.policyVersion");
  if (input.versions.capturedAtPrecheck !== undefined) {
    for (const key of Object.keys(input.versions.capturedAtPrecheck)) result[`versions.capturedAtPrecheck.${key}`] = "precheck_decision";
  }
  if (isService(input)) {
    add(result, "workload_identity", "authority.mode");
    add(result, "workload_identity", "authority.servicePurpose");
    add(result, "workload_identity", "authority.serviceIdentity");
    add(result, "workload_identity", "authority.workloadIdentityVersion");
    add(result, "server_policy_store", "authority.servicePolicyVersion");
    add(result, "server_policy_store", "authority.sourceVersion");
    add(result, "server_policy_store", "serviceSource.scheduleConfigurationVersion");
    add(result, "server_policy_store", "serviceSource.ruleReferenceDataVersion", "serviceSource.sourceState");
    add(result, "server_policy_store", "request.purpose");
  } else if (worker) add(result, "delegation_store", "authority.mode", "request.purpose");
  else add(result, "route_metadata", "authority.mode", "request.purpose");
  add(result, worker ? "envelope_locator" : "route_metadata", "request.action");
  add(result, worker ? "envelope_locator" : bootstrap || (subjectScoped && input.resource === undefined) ? "route_metadata" : "request_locator", "request.fieldSet");
  add(result, "contracts_package", "evaluation.adapter", "evaluation.inputSchemaVersion");
  add(result, "assembler_clock", "evaluation.evaluatedAt");
  return result;
}

function provenanceValid(input: PolicyInput): boolean {
  try {
    const expected = expectedProvenance(input);
    const actual = input.provenance;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    const presentKeys = leafPaths(input).sort();
    return JSON.stringify(expectedKeys) === JSON.stringify(actualKeys)
      && JSON.stringify(expectedKeys) === JSON.stringify(presentKeys)
      && expectedKeys.every((key) => actual[key] === expected[key]);
  } catch {
    return false;
  }
}

function capturedVersions(input: PolicyInput, policy: RegisteredPolicy): CapturedVersions {
  const common = { policyVersion: policy.version, policyDigest: policy.digest, inputSchemaVersion: INPUT_SCHEMA_VERSION };
  if (isService(input)) return {
    workloadIdentityVersion: input.authority.workloadIdentityVersion, servicePolicyVersion: input.authority.servicePolicyVersion,
    sourceVersion: input.authority.sourceVersion, scheduleConfigurationVersion: input.serviceSource.scheduleConfigurationVersion,
    ruleReferenceDataVersion: input.serviceSource.ruleReferenceDataVersion, spaceLifecycleVersion: input.space.lifecycleVersion,
    targetVersion: input.resource.version, ...common,
  };
  if (isBootstrap(input)) return {
    sessionVersion: input.subject.sessionVersion, subjectVersion: input.subject.subjectVersion, profileVersion: input.profile.profileVersion, ...common,
  };
  if (isSubjectScoped(input)) return {
    sessionVersion: input.subject.sessionVersion, subjectVersion: input.subject.subjectVersion, profileVersion: input.profile.profileVersion,
    environmentId: input.environment.environmentId, ...(input.resource === undefined ? {} : { targetVersion: input.resource.version }), ...common,
  };
  const userCommon = {
    subjectVersion: input.subject.subjectVersion, profileVersion: input.profile.profileVersion,
    authorizationVersion: input.membership.authorizationVersion, consentDisclosureVersion: input.consent.disclosureVersion,
    spaceLifecycleVersion: input.space.lifecycleVersion, primaryOwnershipVersion: input.space.primaryOwnershipVersion,
    targetVersion: input.resource.version, ...common,
  };
  return isWorkerUser(input)
    ? { delegationVersion: input.subject.delegationVersion, ...userCommon }
    : { sessionVersion: (input as ApiOrdinaryUserPolicyInput).subject.sessionVersion, ...userCommon };
}

function obligation(kind: string, input: PolicyInput): Obligation {
  if (kind === "fresh_assurance") return { kind, actionClass: input.request.action, spaceId: "space" in input && input.space ? input.space.spaceId : "bootstrap" in input && input.bootstrap ? input.bootstrap.candidateSpaceId : "" };
  if (kind === "create_primary_owner_membership") return { kind };
  if (kind === "mask") return { kind, fieldSet: input.request.fieldSet };
  if (kind === "bind_cache_key") {
    if (isSubjectScoped(input)) return { kind, dimensions: ["environmentId", "accountSubjectId", "subjectVersion", "profileVersion", ...(input.resource === undefined ? [] : ["targetVersion"]), "policyVersion"] };
    return { kind, dimensions: ["spaceId", "authorizationVersion", "policyVersion"] };
  }
  if (kind === "notify") return { kind, class: "safe_authorization_change" };
  if (kind === "confirm") return { kind, targetDescriptor: "authorized_target", consequenceClass: "governed_change" };
  if (kind === "invalidate") return { kind, artifactClasses: ["derived_surfaces", "open_work"] };
  if (kind === "preserve") return { kind, recordClasses: ["history", "provenance"] };
  return { kind: "secure_package", allowlist: "authorized_fields", recipientBinding: "acting_subject", retentionClass: "policy_defined" };
}

function finishAllow(input: PolicyInput, policy: RegisteredPolicy, decision: PolicyDecision, cellRef: NonNullable<PolicyDecision["cellRef"]>, names: readonly string[]): PolicyDecision {
  const captured = capturedVersions(input, policy);
  const obligations: Obligation[] = [audit, ...names.map((name) => obligation(name, input))];
  if (decision.effectClass !== "read") obligations.push({ kind: "recheck_at_commit", capturedVersions: captured });
  return { ...decision, outcome: "allow", reasonClass: "allowed_by_cell", cellRef, capturedVersions: captured, obligations };
}

function safeInput(input: unknown): input is PolicyInput {
  if (!isRecord(input) || !isRecord(input.request) || !isRecord(input.versions) || !isRecord(input.evaluation) || !isRecord(input.authority) || !isRecord(input.provenance)) return false;
  const hasIntent = typeof input.request.action === "string" && typeof input.request.purpose === "string";
  const hasVersion = typeof input.versions.policyVersion === "string";
  const hasEvaluation = validTimestamp(input.evaluation.evaluatedAt) && input.evaluation.inputSchemaVersion === INPUT_SCHEMA_VERSION;
  const validProducer = ["api", "worker"].includes(String(input.evaluation.adapter));
  const knownMode = input.authority.mode === "user_delegated" || input.authority.mode === "service";
  return hasIntent && hasVersion && hasEvaluation && validProducer && knownMode;
}

function shapeValid(input: PolicyInput): boolean {
  if (!(input.request.fieldSet === "default" || (Array.isArray(input.request.fieldSet) && input.request.fieldSet.every((field) => typeof field === "string")))) return false;
  if (isService(input)) {
    return input.evaluation.adapter === "worker" && input.request.purpose === input.authority.servicePurpose
      && typeof input.authority.serviceIdentity === "string" && input.authority.serviceIdentity.length > 0
      && [input.authority.workloadIdentityVersion, input.authority.servicePolicyVersion, input.authority.sourceVersion,
        input.serviceSource.scheduleConfigurationVersion, input.serviceSource.ruleReferenceDataVersion,
        input.space.lifecycleVersion, input.space.primaryOwnershipVersion, input.resource.version].every(isPositiveInteger)
      && ["current", "superseded", "disabled"].includes(input.serviceSource.sourceState)
      && ["live", "archived", "deletion_pending", "purged"].includes(input.space.lifecycle);
  }
  if (!isRecord(input.subject) || !isRecord(input.profile) || !isRecord(input.assurance)) return false;
  if (!["active", "deletion_requested", "deleted"].includes(input.subject.subjectState)
    || !["absent", "active", "deleted"].includes(input.profile.profileState)
    || ![input.subject.subjectVersion, input.profile.profileVersion].every(isPositiveInteger)) return false;
  if (!(input.assurance.level === "session" || input.assurance.level === "fresh")) return false;
  if (input.assurance.level === "fresh" && (typeof input.assurance.boundAction !== "string" || typeof input.assurance.boundSpaceId !== "string" || !validTimestamp(input.assurance.expiresAt))) return false;
  if (isBootstrap(input)) return input.evaluation.adapter === "api" && input.request.action === "space.create"
    && input.bootstrap.spaceState === "absent" && input.bootstrap.primaryMembershipState === "absent"
    && [input.subject.sessionVersion].every(isPositiveInteger);
  if (isSubjectScoped(input)) {
    // Forbidden sections are rejected explicitly, empty objects included, before any subject cell can allow (SEC-P2-F5).
    if (forbiddenInSubjectVariant.some((section) => (input as unknown as UnknownRecord)[section] !== undefined)) return false;
    if (input.subject.delegationRef !== undefined || input.subject.delegationVersion !== undefined) return false;
    if (input.evaluation.adapter !== "api" || !isRecord(input.environment) || !nonEmpty(input.environment.environmentId) || !isPositiveInteger(input.subject.sessionVersion)) return false;
    if (input.resource === undefined) return true;
    return isRecord(input.resource) && nonEmpty(input.resource.type) && nonEmpty(input.resource.id) && input.resource.owningSpaceId === "none"
      && isPositiveInteger(input.resource.version) && nonEmpty(input.resource.lifecycle)
      && nonEmpty(input.resource.owningSubjectId) && nonEmpty(input.resource.environmentId);
  }
  if (!input.membership || !input.consent || !input.space || !input.resource) return false;
  return ["primary_owner", "co_owner", "collaborator", "viewer", "accountability_partner"].includes(input.membership.role)
    && ["active", "pending", "revoked", "expired", "inactive"].includes(input.membership.status)
    && ["current", "superseded", "ended"].includes(input.consent.state)
    && ["live", "archived", "deletion_pending", "purged"].includes(input.space.lifecycle)
    && [input.membership.authorizationVersion, input.consent.disclosureVersion, input.space.lifecycleVersion, input.space.primaryOwnershipVersion, input.resource.version].every(isPositiveInteger)
    && (isWorkerUser(input) ? isPositiveInteger(input.subject.delegationVersion) : isPositiveInteger((input as ApiOrdinaryUserPolicyInput).subject.sessionVersion));
}

/** PC-236-001: the one production entry point. It evaluates only CURRENT_POLICY_VERSION; an input naming any
 * other version, registered or not, denies `policy_version_unsupported` (PC-236-011, PC-236-013). */
export function decide(input: PolicyInput): PolicyDecision { return evaluate(input, CURRENT_POLICY); }

/** The same evaluator bound to an explicitly named registered version. It exists so a registered-but-unreleased
 * version's fixture catalog is executable before release (PC-236-019). Application code calls `decide`; the
 * name is deliberately grep-able so a review can reject any adapter import of it. */
export function decideUnderRegisteredVersion(version: RegisteredPolicyVersion, input: PolicyInput): PolicyDecision { return evaluate(input, POLICY_VERSIONS[version]); }

function evaluate(input: PolicyInput, policy: RegisteredPolicy): PolicyDecision {
  if (!safeInput(input)) return baseDecision(input, policy, "input_invalid");
  const actionDefinition = policy.actionDefinitions.find((candidate) => candidate.action === input.request.action);
  const initial = baseDecision(input, policy, "input_invalid", actionDefinition?.effectClass);
  if (input.versions.policyVersion !== policy.version) return { ...initial, reasonClass: "policy_version_unsupported", policyDigest: "" };
  if (input.evaluation.inputSchemaVersion !== INPUT_SCHEMA_VERSION || !shapeValid(input) || !provenanceValid(input)) return initial;
  if (!actionDefinition || actionDefinition.permission === "reserved") return { ...initial, reasonClass: "input_unsupported" };
  if (!actionDefinition.authorityModes.includes(input.authority.mode)) return { ...initial, reasonClass: "authority_mode_unsupported" };
  if (input.versions.capturedAtPrecheck !== undefined && sha256(input.versions.capturedAtPrecheck) !== sha256(capturedVersions(input, policy))) return { ...initial, reasonClass: "stale_version" };

  if (isService(input)) {
    if (input.request.purpose !== input.authority.servicePurpose) return { ...initial, reasonClass: "service_purpose_not_listed" };
    if (input.authority.servicePurpose !== "SA-92-002") return { ...initial, reasonClass: "service_purpose_not_listed" };
    const cell = policy.serviceCells.find((candidate) => candidate.action === input.request.action);
    if (!cell) return { ...initial, reasonClass: "service_purpose_not_listed" };
    if (input.serviceSource.sourceState !== "current" || input.space.lifecycle !== "live") return { ...initial, reasonClass: "lifecycle_blocked" };
    if (input.resource.owningSpaceId !== input.space.spaceId || input.resource.type !== actionDefinition.resourceType) return { ...initial, reasonClass: "scope_mismatch" };
    if (![input.authority.workloadIdentityVersion, input.authority.servicePolicyVersion, input.authority.sourceVersion, input.serviceSource.scheduleConfigurationVersion, input.serviceSource.ruleReferenceDataVersion, input.space.lifecycleVersion, input.resource.version].every(isPositiveInteger)) return initial;
    return finishAllow(input, policy, initial, { kind: "service", purpose: cell.purpose, operation: cell.operation }, cell.obligations);
  }

  if (!isRecord(input.subject) || !isRecord(input.profile) || !isRecord(input.assurance)) return initial;
  if (input.subject.subjectState !== "active" || input.profile.profileState !== "active") return { ...initial, reasonClass: "subject_not_active" };
  if (input.request.action === "space.create") {
    if (!("bootstrap" in input) || !isRecord(input.bootstrap) || input.evaluation.adapter !== "api") return initial;
    if (input.bootstrap.spaceState !== "absent" || input.bootstrap.primaryMembershipState !== "absent") return { ...initial, reasonClass: "stale_version" };
    return finishAllow(input, policy, initial, { kind: "bootstrap", action: "space.create" }, ["create_primary_owner_membership"]);
  }
  if (actionDefinition.permission === "subject") {
    // Section 8.5 subject-scoped cells: the acting subject and the configured environment are the scope.
    if (!isSubjectScoped(input) || input.evaluation.adapter !== "api") return initial;
    const cell = policy.userCells.find((candidate) => candidate.action === input.request.action);
    if (!cell || cell.permission !== "subject") return { ...initial, reasonClass: "input_unsupported" };
    if (actionDefinition.resourceType === undefined) {
      if (input.resource !== undefined) return initial;
    } else {
      if (input.resource === undefined) return initial;
      if (input.resource.type !== actionDefinition.resourceType || input.resource.owningSpaceId !== "none") return { ...initial, reasonClass: "scope_mismatch" };
      if (input.resource.owningSubjectId !== input.subject.accountSubjectId || input.resource.environmentId !== input.environment.environmentId) return { ...initial, reasonClass: "scope_mismatch" };
    }
    return finishAllow(input, policy, initial, { kind: "subject", action: cell.action }, cell.obligations);
  }
  if (isSubjectScoped(input)) return initial;
  if (!("membership" in input) || !input.membership || !input.consent || !input.space || !input.resource) return initial;
  if (input.membership.status !== "active") return { ...initial, reasonClass: "membership_not_active" };
  if (input.consent.state !== "current") return { ...initial, reasonClass: "consent_not_current" };
  // Section 8.2: a user cell is keyed on (action, role). An action with no cell at all is unsupported; an action
  // represented in USER_CELLS whose cell for the acting role is absent, Deny or Not applicable denies
  // role_not_permitted. Through p3 every space-bound cell is a Primary Owner cell, so every other role finds no
  // cell; p4 (section 8.7) is the first version that carries a cell for another role.
  const cells = policy.userCells.filter((candidate) => candidate.action === input.request.action);
  if (cells.length === 0) return { ...initial, reasonClass: "input_unsupported" };
  if (cells.some((candidate) => candidate.permission === "subject")) return initial;
  const cell = cells.find((candidate) => candidate.role === input.membership.role);
  if (!cell || cell.notation === "Deny" || cell.notation === "Not applicable") return { ...initial, reasonClass: "role_not_permitted" };
  if (input.resource.type !== actionDefinition.resourceType || input.resource.owningSpaceId !== input.space.spaceId) return { ...initial, reasonClass: "scope_mismatch" };
  if (cell.notation === "Primary" && input.membership.membershipId !== input.space.primaryOwnerMembershipId) return { ...initial, reasonClass: "role_not_permitted" };
  if (cell.notation === "Authorizer" && input.resource.authorizerSubjectId !== input.subject.accountSubjectId) return { ...initial, reasonClass: "scope_mismatch" };
  if (cell.notation === "Own" && input.resource.authorSubjectId !== input.subject.accountSubjectId) return { ...initial, reasonClass: "scope_mismatch" };
  const archivedAllowed = initial.effectClass === "read" || ["20a", "20b", "21"].includes(cell.permission);
  const deletionCancel = input.request.action === "34.cancel_space_deletion";
  if (input.space.lifecycle !== "live" && !(input.space.lifecycle === "archived" && archivedAllowed) && !(input.space.lifecycle === "deletion_pending" && deletionCancel)) return { ...initial, reasonClass: "lifecycle_blocked" };
  // Section 8.2: a cell is protected exactly when CBD-72 names `fresh_assurance` for it, so the predicate reads the cell's
  // own obligation table rather than a permission number. Through p4 the cells carrying `fresh_assurance` are precisely the
  // cells of the six protected permissions (20a, 20b, 27, 29, 34, 35), so no p1-p4 decision changes; p5 (section 8.8) adds
  // unprotected workflow operations under row 29 whose cells do not carry it.
  if (cell.obligations.includes("fresh_assurance")) {
    if (input.assurance.level !== "fresh") return { ...initial, reasonClass: "assurance_required" };
    if (input.assurance.boundAction !== input.request.action || input.assurance.boundSpaceId !== input.space.spaceId || Date.parse(input.assurance.expiresAt) <= Date.parse(input.evaluation.evaluatedAt)) return { ...initial, reasonClass: "assurance_insufficient" };
  }
  return finishAllow(input, policy, initial, { kind: "user", permission: cell.permission, role: input.membership.role }, cell.obligations);
}
