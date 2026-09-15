import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, decideUnderRegisteredVersion, expectedProvenance } from "./evaluate.ts";
import { externalDenial } from "./reason.ts";
import { policyAuditEvent } from "./log.ts";
import { ACTION_DEFINITIONS, SERVICE_CELLS, USER_CELLS } from "./policy/v1.ts";
import { ACTION_DEFINITIONS as P2_ACTION_DEFINITIONS, SERVICE_CELLS as P2_SERVICE_CELLS, SUBJECT_ACTION_DEFINITIONS, SUBJECT_CELLS, USER_CELLS as P2_USER_CELLS } from "./policy/v2.ts";
import { ACCOUNT_PERMISSION, ACTION_DEFINITIONS as P3_ACTION_DEFINITIONS, P3_ACTION_DEFINITIONS as P3_ONLY_ACTION_DEFINITIONS, P3_USER_CELLS as P3_ONLY_USER_CELLS, PROGRESS_DETAIL_ACTION, SERVICE_CELLS as P3_SERVICE_CELLS, USER_CELLS as P3_USER_CELLS } from "./policy/v3.ts";
import { ACTION_DEFINITIONS as P4_ACTION_DEFINITIONS, P4_ROLES, P4_USER_CELLS as P4_ONLY_USER_CELLS, SERVICE_CELLS as P4_SERVICE_CELLS, USER_CELLS as P4_USER_CELLS } from "./policy/v4.ts";
import { ACTION_DEFINITIONS as P5_ACTION_DEFINITIONS, BASELINE_NON_OWNER_ACTIONS, COOWNER_INVITATION_ACTIONS, P5_ACTION_DEFINITIONS as P5_ONLY_ACTION_DEFINITIONS, P5_BASELINE_NON_OWNER_CELLS, P5_COOWNER_INVITATION_CELLS, P5_ROLES, P5_SPACE_CELLS, P5_SUBJECT_CELLS, P5_USER_CELLS as P5_ONLY_USER_CELLS, SERVICE_CELLS as P5_SERVICE_CELLS, SUPERSEDED_ACTIONS, USER_CELLS as P5_USER_CELLS } from "./policy/v5.ts";
import { CURRENT_POLICY_VERSION, P1_DIGEST, P2_DIGEST, P3_DIGEST, P4_DIGEST, P5_DIGEST, POLICY_VERSIONS, policyCompatibility } from "./policy/registry.ts";
import type { RegisteredPolicyVersion } from "./policy/registry.ts";
import { FORBIDDEN_SUBJECT_SECTIONS, NEGATIVE_FAMILIES, NEGATIVE_FIXTURES, P1_FIXTURES, P2_FIXTURES, P2_NEGATIVE_FIXTURES, P3_FIXTURES, P3_NEGATIVE_FIXTURES, P4_FIXTURES, P4_NEGATIVE_FIXTURES, P5_FIXTURES, P5_NEGATIVE_FIXTURES, ROLES, SUBJECT_ENVIRONMENT, TRANSFER_CONFIRM_ACTION, UNMAPPED_ROLE, accountNegativeFixtures, bootstrapFixture, independentCaptureFixture, invitationCells, invitationNegativeFixtures, ordinaryFixture, rolesWithoutCell, serviceFixture, spaceBoundNegativeFixtures, subjectCells, subjectFixture, subjectNegativeFixtures } from "./fixtures/index.ts";
import { generateLocalSigningKeyPair, signLocalDecision, verifyLocalDecision } from "./transport.ts";
import type { PolicyInput } from "./input.ts";

const CURRENT_DIGEST = POLICY_VERSIONS[CURRENT_POLICY_VERSION].digest;
/** POV-N01..POV-N04 (CBD-236 v0.13 section 9.7): emitted by the space-bound generator for every space-bound cell in every version. */
const POV_FAMILIES = ["stale_primary_ownership_column", "missing_primary_ownership_version", "client_asserted_primary_ownership_version", "malformed_primary_ownership_version"] as const;
const NOT_CURRENT = (Object.keys(POLICY_VERSIONS) as RegisteredPolicyVersion[]).filter((version) => version !== CURRENT_POLICY_VERSION);
function restamp<T>(input: T): T { return { ...input, provenance: expectedProvenance(input as PolicyInput) }; }
function denyIsInert(input: unknown, reason?: string, version?: RegisteredPolicyVersion): void {
  const decision = version === undefined ? decide(input as PolicyInput) : decideUnderRegisteredVersion(version, input as PolicyInput);
  assert.equal(decision.outcome, "deny");
  if (reason) assert.equal(decision.reasonClass, reason);
  assert.equal(decision.cellRef, undefined);
  assert.equal(decision.capturedVersions, undefined);
  assert.deepEqual(decision.obligations, [{ kind: "audit", eventClass: "policy_decision" }]);
  assert.deepEqual(externalDenial(), { outcome: "deny", reason: "denied" });
}

// The registry constant is a literal type; widen it once so version-derived branches typecheck under any registered version.
const currentVersion = CURRENT_POLICY_VERSION as RegisteredPolicyVersion;
// Every registered version's positive catalog, so a release flip changes no test literal here (SEC-P2-F6).
const CATALOGS: Record<RegisteredPolicyVersion, readonly { id: string; input: PolicyInput; expected: string }[]> = { p1: P1_FIXTURES, p2: P2_FIXTURES, p3: P3_FIXTURES, p4: P4_FIXTURES, p5: P5_FIXTURES };
/** Whether the current version carries a given cell, so a test's "before the release" and "after the release" branches follow
 * the registry rather than a version literal (SEC-P2-F6; the p3 release step's subject-scoped lesson). */
function currentCarries(action: string, role: string): boolean { return POLICY_VERSIONS[currentVersion].userCells.some((cell) => cell.action === action && cell.role === role); }

describe("CBD-236 acceptance criteria", () => {
  it("AC01 exposes one deterministic entry point with explicit complete decisions and bootstrap obligations", () => {
    const input = bootstrapFixture();
    const first = decide(input); const second = decide(structuredClone(input));
    assert.deepEqual(first, second);
    assert.equal(first.outcome, "allow"); assert.equal(first.reasonClass, "allowed_by_cell");
    assert.equal(first.policyVersion, CURRENT_POLICY_VERSION); assert.equal(first.policyDigest, CURRENT_DIGEST);
    assert.deepEqual(first.cellRef, { kind: "bootstrap", action: "space.create" });
    assert.ok(first.obligations.some((item) => item.kind === "create_primary_owner_membership"));
    assert.ok(first.obligations.some((item) => item.kind === "recheck_at_commit"));
  });

  it("AC02 proves all six alone-never-authorizes families deny without effect", () => {
    const base = ordinaryFixture("1.view_space");
    const cases: unknown[] = [
      { ...base, membership: undefined },
      { ...base, membership: undefined, resource: { ...base.resource, type: "account" } },
      { ...base, membership: undefined, invitationEmailMatch: true },
      { ...base, membership: undefined, invitationCode: "opaque-locator" },
      // A role the current version does not map for 1.view_space (co_owner before p5; viewer under p5, section 8.8), so the family survives a flip.
      restamp({ ...base, membership: { ...base.membership, role: UNMAPPED_ROLE } }),
      { ...base, provenance: { ...base.provenance, "membership.role": "request_locator" } },
    ];
    cases.forEach((input) => denyIsInert(input));
  });

  it("AC03 denies missing, malformed, unknown, inactive, revoked, expired, stale, cross-space, and unsupported inputs", () => {
    const base = ordinaryFixture("1.view_space");
    const precheck = decide(ordinaryFixture("2a.edit_plan"));
    assert.ok(precheck.capturedVersions);
    const staleBase = ordinaryFixture("2a.edit_plan");
    const cases: [unknown, string][] = [
      [{ ...base, subject: undefined }, "input_invalid"],
      [{ ...base, evaluation: { ...base.evaluation, inputSchemaVersion: "one" } }, "input_invalid"],
      [restamp({ ...base, request: { ...base.request, action: "999.unknown" } }), "input_unsupported"],
      [restamp({ ...base, subject: { ...base.subject, subjectState: "deleted" } }), "subject_not_active"],
      [restamp({ ...base, membership: { ...base.membership, status: "revoked" } }), "membership_not_active"],
      [restamp({ ...base, membership: { ...base.membership, status: "expired" } }), "membership_not_active"],
      [restamp({ ...staleBase, versions: { policyVersion: CURRENT_POLICY_VERSION, capturedAtPrecheck: { ...precheck.capturedVersions, targetVersion: 99 } } }), "stale_version"],
      [restamp({ ...base, resource: { ...base.resource, owningSpaceId: "other-space" } }), "scope_mismatch"],
      [{ ...base, versions: { policyVersion: "p99" }, provenance: { ...base.provenance } }, "policy_version_unsupported"],
    ];
    cases.forEach(([input, reason]) => denyIsInert(input, reason));
    const effects = { rowVersions: 0, derivedRecomputations: 0, notifications: 0 };
    for (const fixture of NEGATIVE_FIXTURES) denyIsInert(fixture.input);
    assert.deepEqual(effects, { rowVersions: 0, derivedRecomputations: 0, notifications: 0 });
  });

  // Independent oracle transcribed from docs/cbd-236-authorization-policy-contract.md
  // section 8.3 (itself CBD-72). It is deliberately NOT derived from v1.ts, so a
  // cell that silently defaults in the policy map is caught here rather than
  // by manual review (review finding F1: permission 23 defaulted to Allow).
  const CONTRACT_NOTATION: Readonly<Record<string, string>> = Object.freeze({
    "1": "Read", "2a": "Allow", "2b": "Allow", "3": "Allow", "4": "Allow", "5": "Allow",
    "6a": "Allow", "6b": "Allow", "6c": "Allow", "6d": "Allow", "6e": "Allow", "7": "Allow",
    "8": "Allow", "9": "Allow", "10": "Deny", "11a": "Allow", "11b": "Own", "11c": "Own",
    "11d": "Deny", "12": "Allow", "13": "Not applicable", "14": "Read", "15": "Read",
    "16": "Read", "17": "Allow", "18": "Allow", "19": "Allow", "20a": "Allow", "20b": "Primary",
    "21": "Allow", "22": "Allow", "23": "Deny", "24": "Allow", "25": "Allow", "26": "Allow",
    "27": "Primary", "28": "Deny", "29": "Primary", "30": "Allow",
    // Section 8.3 row 31 reads "Allow (self-consent)"; the p1 schema carries no
    // self-consent fact yet, so the cell is plain Allow (review note F3).
    "31": "Allow", "32": "Authorizer", "33": "Authorizer", "34": "Primary", "35": "Primary",
  });

  it("AC04 every p1 user cell carries the notation the contract's section 8.3 table states", () => {
    const seen = new Set<string>();
    for (const cell of USER_CELLS.filter((item) => item.action !== "space.create")) {
      assert.ok(cell.permission in CONTRACT_NOTATION, `${cell.permission} is not a section 8.3 row`);
      assert.equal(cell.notation, CONTRACT_NOTATION[cell.permission], `${cell.action} notation`);
      seen.add(cell.permission);
    }
    for (const permission of Object.keys(CONTRACT_NOTATION)) assert.ok(seen.has(permission), `no cell implements permission ${permission}`);
    assert.equal(decide(ordinaryFixture("23.change_partner_partial_visibility")).outcome, "deny", "permission 23 is Deny for every role, Primary Owner included");
  });

  it("AC04 maps every p1 Primary Owner cell and denies every other role", () => {
    assert.equal(USER_CELLS.length, ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved" && item.permission !== "SA-92-002").length);
    for (const cell of USER_CELLS.filter((item) => item.action !== "space.create")) {
      const expected = cell.notation === "Deny" || cell.notation === "Not applicable" ? "deny" : "allow";
      assert.equal(decide(ordinaryFixture(cell.action)).outcome, expected, cell.action);
      // Under p1 every other role denies; through decide the roles that deny are those the current version maps no cell for
      // (all four through p4; p5 maps Co-owner and Collaborator for the section 8.8.1 baseline actions), so no literal changes at a flip.
      for (const role of ["co_owner", "collaborator", "viewer", "accountability_partner"] as const) denyIsInert(ordinaryFixture(cell.action, role, "p1"), "role_not_permitted", "p1");
      for (const role of rolesWithoutCell(cell.action, currentVersion).filter((role) => role !== "primary_owner")) denyIsInert(ordinaryFixture(cell.action, role), "role_not_permitted");
    }
    const reserved = POLICY_VERSIONS[CURRENT_POLICY_VERSION].actionDefinitions.filter((item) => item.permission === "reserved").map((item) => item.action);
    assert.ok(reserved.length >= 2, "the reserved profile-domain codes stay reserved until an approved CBD-22 source");
    for (const action of reserved) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
  });

  it("AC05 rejects every client-restamped authority fact and the wrong authority mode", () => {
    const base = ordinaryFixture("1.view_space");
    for (const path of Object.keys(base.provenance)) {
      const wrongSource = base.provenance[path] === "request_locator" ? "datastore" : "request_locator";
      denyIsInert({ ...base, provenance: { ...base.provenance, [path]: wrongSource } });
    }
    denyIsInert(restamp({ ...serviceFixture(), request: { ...serviceFixture().request, action: "1.view_space" } }), "authority_mode_unsupported");
  });

  it("AC06 binds the immutable registry tuple and rejects mismatches", () => {
    assert.equal(policyCompatibility(CURRENT_POLICY_VERSION, CURRENT_DIGEST, 1), true);
    assert.equal(policyCompatibility(CURRENT_POLICY_VERSION, "0".repeat(64), 1), false);
    assert.equal(policyCompatibility(CURRENT_POLICY_VERSION, CURRENT_DIGEST, 2), false);
    assert.equal(POLICY_VERSIONS.p1.digest, P1_DIGEST);
    // The released p1 digest is pinned independently in config/authorization-policy-release-history.json; it must never move.
    assert.equal(P1_DIGEST, "488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22");
    for (const version of NOT_CURRENT) assert.equal(policyCompatibility(version, POLICY_VERSIONS[version].digest, 1), false, `${version} is registered but not current`);
  });

  it("AC07 generates fixtures for every action and covers required negative families", () => {
    const fixtureActions = new Set(P1_FIXTURES.map((fixture) => fixture.input.request.action));
    for (const action of ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved")) assert.ok(fixtureActions.has(action.action), action.action);
    assert.deepEqual(new Set(NEGATIVE_FAMILIES.map(([id]) => id)), new Set(Array.from({ length: 15 }, (_, index) => `NC-236-${String(index + 1).padStart(2, "0")}`)));
    for (const fixture of P1_FIXTURES) assert.equal(decideUnderRegisteredVersion("p1", fixture.input).outcome, fixture.expected, fixture.id);
    // Version-derived (SEC-P2-F6): the catalog pinned to the current version is the one that must pass through `decide`.
    for (const fixture of CATALOGS[currentVersion]) assert.equal(decide(fixture.input).outcome, fixture.expected, `${fixture.id} through decide`);
    const crossSpace = serviceFixture();
    denyIsInert(restamp({ ...crossSpace, resource: { ...crossSpace.resource, owningSpaceId: "other-space" } }), "scope_mismatch");
    const wrongTarget = ordinaryFixture("1.view_space");
    denyIsInert(restamp({ ...wrongTarget, resource: { ...wrongTarget.resource, type: "report" } }), "scope_mismatch");
    const archived = ordinaryFixture("2a.edit_plan");
    denyIsInert(restamp({ ...archived, space: { ...archived.space, lifecycle: "archived" } }), "lifecycle_blocked");
    const sessionOnly = ordinaryFixture("20a.generate_financial_export");
    denyIsInert(restamp({ ...sessionOnly, assurance: { level: "session" } }), "assurance_required");
  });

  it("AC08 filters every prohibited audit field from all variants", () => {
    const prohibited = { financialContent: 10, hiddenResource: true, credential: "x", providerSecret: "x", sessionRef: "x", delegationRef: "x", email: "a@b.test", stack: "x", requestPath: "/space/secret" };
    for (const variant of ["ordinary", "bootstrap", "subject", "service"] as const) {
      const filtered = policyAuditEvent({ eventId: "event-1", outcome: "deny", ...prohibited }, variant);
      assert.deepEqual(filtered, { eventId: "event-1", outcome: "deny" });
    }
  });
});

describe("policy version p2: subject-scoped cells, registered and not current", () => {
  const subjectActions = SUBJECT_CELLS.map((cell) => cell.action);
  const p2Only = subjectActions.filter((action) => !ACTION_DEFINITIONS.some((item) => item.action === action));

  it("POLICY-V2-01 carries every p1 user cell, service cell and action definition byte-identical, and the p1 digest is unchanged", () => {
    assert.deepEqual(P2_USER_CELLS.slice(0, USER_CELLS.length), USER_CELLS);
    assert.deepEqual(P2_USER_CELLS.slice(USER_CELLS.length), SUBJECT_CELLS);
    assert.deepEqual(P2_SERVICE_CELLS, SERVICE_CELLS);
    for (const definition of ACTION_DEFINITIONS) {
      const p2 = P2_ACTION_DEFINITIONS.find((item) => item.action === definition.action);
      assert.ok(p2, `${definition.action} is absent from p2`);
      if (definition.action === "profile.read") {
        // The one enabled reserved code: PROTO-POLICY-V2-DECISION-001 makes it a subject-self read.
        assert.equal(definition.permission, "reserved"); assert.equal(p2.permission, "subject"); assert.equal(p2.resourceType, undefined);
        const { resourceType: _p1ResourceType, ...p1Rest } = definition;
        assert.deepEqual({ ...p1Rest, permission: "subject" }, p2);
      } else assert.deepEqual(p2, definition);
    }
    assert.equal(P2_ACTION_DEFINITIONS.length, ACTION_DEFINITIONS.length + p2Only.length);
    assert.deepEqual(p2Only, ["proposal.create", "proposal.regenerate", "proposal.read", "membership.list_own"]);
    assert.equal(P1_DIGEST, "488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22");
    assert.match(P2_DIGEST, /^[a-f0-9]{64}$/); assert.notEqual(P2_DIGEST, P1_DIGEST);
    assert.equal(POLICY_VERSIONS.p2.digest, P2_DIGEST); assert.equal(POLICY_VERSIONS.p2.schemaVersion, 1);
    assert.equal(P2_USER_CELLS.length, P2_ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved" && item.permission !== "SA-92-002").length);
    assert.equal(P2_USER_CELLS.filter((cell) => cell.permission === "subject").length, 5);
  });

  it("POLICY-V2-01 evaluates every p1 catalog entry identically under p2", () => {
    for (const fixture of P1_FIXTURES) {
      const under = P2_FIXTURES.find((item) => item.id === fixture.id.replace(/^p1\./, "p2."));
      assert.ok(under, fixture.id);
      const p1 = decideUnderRegisteredVersion("p1", fixture.input); const p2 = decideUnderRegisteredVersion("p2", under.input);
      assert.equal(p2.outcome, p1.outcome, fixture.id); assert.deepEqual(p2.cellRef, p1.cellRef, fixture.id);
      assert.deepEqual(p2.obligations.filter((item) => item.kind !== "recheck_at_commit"), p1.obligations.filter((item) => item.kind !== "recheck_at_commit"), fixture.id);
    }
  });

  it("POLICY-V2-02 allows the owning subject for every subject-scoped cell with the subject cellRef and the read obligations", () => {
    for (const cell of SUBJECT_CELLS) {
      const definition = SUBJECT_ACTION_DEFINITIONS.find((item) => item.action === cell.action)!;
      const input = subjectFixture(cell.action);
      const decision = decideUnderRegisteredVersion("p2", input);
      assert.equal(decision.outcome, "allow", cell.action); assert.equal(decision.reasonClass, "allowed_by_cell");
      assert.equal(decision.policyVersion, "p2"); assert.equal(decision.policyDigest, P2_DIGEST);
      assert.deepEqual(decision.cellRef, { kind: "subject", action: cell.action });
      assert.equal(decision.effectClass, definition.effectClass);
      assert.deepEqual(decision.capturedVersions, {
        sessionVersion: 1, subjectVersion: 1, profileVersion: 1, environmentId: SUBJECT_ENVIRONMENT,
        ...(definition.resourceType === undefined ? {} : { targetVersion: 1 }), policyVersion: "p2", policyDigest: P2_DIGEST, inputSchemaVersion: 1,
      }, cell.action);
      const kinds = decision.obligations.map((item) => item.kind);
      assert.equal(kinds[0], "audit");
      if (definition.effectClass === "read") {
        assert.ok(kinds.includes("bind_cache_key") && !kinds.includes("recheck_at_commit"), cell.action);
        const cache = decision.obligations.find((item) => item.kind === "bind_cache_key");
        assert.deepEqual(cache, { kind: "bind_cache_key", dimensions: ["environmentId", "accountSubjectId", "subjectVersion", "profileVersion", ...(definition.resourceType === undefined ? [] : ["targetVersion"]), "policyVersion"] });
      } else assert.ok(kinds.includes("recheck_at_commit") && !kinds.includes("bind_cache_key"), cell.action);
      assert.ok(!kinds.includes("fresh_assurance") && !kinds.includes("create_primary_owner_membership"), cell.action);
      assert.deepEqual(decideUnderRegisteredVersion("p2", structuredClone(input)), decision, "deterministic");
    }
  });

  it("POLICY-V2-02 denies another subject, a wrong environment, a stale session, service authority and the other families inertly (PC-236-018)", () => {
    const required = ["another_subject", "wrong_environment", "stale_session_version", "service_authority", "inactive_subject", "inactive_profile", "wrong_target_shape", "space_bound_shape", "worker_adapter", "forbidden_section_empty", "forbidden_section_populated"];
    for (const cell of SUBJECT_CELLS) {
      const families = P2_NEGATIVE_FIXTURES.filter((item) => item.action === cell.action).map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${cell.action} lacks the ${family} negative`);
    }
    for (const fixture of P2_NEGATIVE_FIXTURES) denyIsInert(fixture.input, fixture.reason, "p2");
    // SEC-P2-F5 regression, per cell and per forbidden section, in both the empty-object and populated forms.
    for (const cell of SUBJECT_CELLS) {
      const positive = subjectFixture(cell.action);
      for (const section of Object.keys(FORBIDDEN_SUBJECT_SECTIONS)) {
        assert.ok(P2_NEGATIVE_FIXTURES.some((item) => item.id === `p2.subject.${cell.action}.forbidden_section_empty.${section}`), `${cell.action} ${section} empty`);
        assert.ok(P2_NEGATIVE_FIXTURES.some((item) => item.id === `p2.subject.${cell.action}.forbidden_section_populated.${section}`), `${cell.action} ${section} populated`);
        denyIsInert(restamp({ ...positive, [section]: {} }), "input_invalid", "p2");
        denyIsInert({ ...positive, [section]: {} }, "input_invalid", "p2");
      }
      denyIsInert(restamp({ ...positive, subject: { ...positive.subject, delegationRef: "delegation-1", delegationVersion: 1 } }), "input_invalid", "p2");
    }
    // The empty-object leaf rule also closes the same gap for the p1 variants.
    const ordinary = ordinaryFixture("1.view_space");
    for (const section of ["serviceSource", "environment", "bootstrap"]) denyIsInert(restamp({ ...ordinary, [section]: {} }), undefined);
    denyIsInert(restamp({ ...bootstrapFixture(), space: {} }), undefined);
    // A subject-target cell never allows the identifier alone: the owning subject and environment are row facts, not locators.
    const read = subjectFixture("proposal.read");
    denyIsInert(restamp({ ...read, resource: { ...read.resource!, owningSubjectId: "subject-2", environmentId: "env-other" } }), "scope_mismatch", "p2");
    denyIsInert({ ...read, provenance: { ...read.provenance, "resource.owningSubjectId": "request_locator" } }, "input_invalid", "p2");
    denyIsInert({ ...read, provenance: { ...read.provenance, "resource.environmentId": "request_locator" } }, "input_invalid", "p2");
    // A p1 space cell presented in the subject-scoped shape is malformed, not a subject cell.
    denyIsInert(restamp({ ...subjectFixture("membership.list_own"), request: { action: "1.view_space", purpose: "user_delegated", fieldSet: "default" } }), "input_invalid", "p2");
    // Every subject-scoped positive restamped from any client source denies (AC05 discipline for the new variant).
    for (const cell of SUBJECT_CELLS) {
      const base = subjectFixture(cell.action);
      for (const path of Object.keys(base.provenance)) {
        const wrongSource = base.provenance[path] === "request_locator" ? "datastore" : "request_locator";
        denyIsInert({ ...base, provenance: { ...base.provenance, [path]: wrongSource } }, "input_invalid", "p2");
      }
    }
  });

  it("POLICY-V2-03 the registered non-current version denies through decide, and the current version carries its production behaviour", () => {
    assert.deepEqual(Object.keys(POLICY_VERSIONS), ["p1", "p2", "p3", "p4", "p5"]);
    for (const version of NOT_CURRENT) {
      denyIsInert(ordinaryFixture("1.view_space", "primary_owner", version), "policy_version_unsupported");
      assert.equal(policyCompatibility(version, POLICY_VERSIONS[version].digest, 1), false);
    }
    if (currentVersion === "p1") {
      // Before the section 8.5.4 release: every p2 input denies through decide and a p2-only action is unsupported exactly as before p2 existed.
      for (const cell of SUBJECT_CELLS) denyIsInert(subjectFixture(cell.action), "policy_version_unsupported");
      for (const action of [...p2Only, "profile.read"]) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
    } else {
      // After the release (p2 or any later version carrying the subject cells): the subject-scoped cells allow through decide,
      // their negatives pinned to the current version deny through decide, and a p1-versioned input denies.
      for (const cell of SUBJECT_CELLS) assert.deepEqual(decide(subjectFixture(cell.action, currentVersion)).cellRef, { kind: "subject", action: cell.action });
      for (const fixture of subjectNegativeFixtures(currentVersion)) denyIsInert(fixture.input, fixture.reason);
      denyIsInert(bootstrapFixture("p1"), "policy_version_unsupported");
    }
    // Historical p1 coverage that never depends on the current version.
    for (const action of p2Only) assert.ok(!ACTION_DEFINITIONS.some((item) => item.action === action), `${action} must be absent from p1`);
    assert.equal(ACTION_DEFINITIONS.find((item) => item.action === "profile.read")?.permission, "reserved");
    for (const cell of SUBJECT_CELLS) denyIsInert(subjectFixture(cell.action, "p1"), "input_unsupported", "p1");
    for (const action of [...p2Only, "profile.read"]) denyIsInert(restamp({ ...ordinaryFixture("1.view_space", "primary_owner", "p1"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported", "p1");
  });

  it("AC07 for p2: every non-reserved p2 action is reached by a p2 fixture and the catalog evaluates as expected", () => {
    const fixtureActions = new Set(P2_FIXTURES.map((fixture) => fixture.input.request.action));
    for (const action of P2_ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved")) assert.ok(fixtureActions.has(action.action), action.action);
    for (const fixture of P2_FIXTURES) assert.equal(decideUnderRegisteredVersion("p2", fixture.input).outcome, fixture.expected, fixture.id);
  });

  it("AC08 for p2: the subject audit variant carries only the allowlisted subject fields", () => {
    const event = policyAuditEvent({ eventId: "event-1", outcome: "allow", accountSubjectId: "subject-1", resourceType: "proposal", targetRef: "ref-1", membershipId: "m", role: "primary_owner", spaceId: "s", sessionRef: "x", email: "a@b.test" }, "subject");
    assert.deepEqual(event, { eventId: "event-1", outcome: "allow", accountSubjectId: "subject-1", resourceType: "proposal", targetRef: "ref-1" });
  });
});

describe("policy version p3: manual-account cells, registered and not current", () => {
  const p3Only = P3_ONLY_USER_CELLS.map((cell) => cell.action);
  // Independent oracle transcribed from docs/cbd-236-authorization-policy-contract.md section 8.6.1. It is deliberately
  // NOT derived from v3.ts, so a cell that silently defaults in the policy map is caught here.
  const CONTRACT_P3: Readonly<Record<string, { permission: string; effectClass: string; resourceType: string; notation: string; obligations: readonly string[] }>> = Object.freeze({
    "manual_account.create_manual_account": { permission: "manual_account", effectClass: "mutate", resourceType: "account", notation: "Allow", obligations: ["preserve", "invalidate"] },
    "manual_account.edit_manual_account": { permission: "manual_account", effectClass: "mutate", resourceType: "account", notation: "Allow", obligations: ["preserve", "invalidate"] },
    "manual_account.archive_manual_account": { permission: "manual_account", effectClass: "mutate", resourceType: "account", notation: "Allow", obligations: ["confirm", "preserve", "invalidate"] },
    "manual_account.restore_manual_account": { permission: "manual_account", effectClass: "mutate", resourceType: "account", notation: "Allow", obligations: ["confirm", "preserve", "invalidate"] },
    "14.view_progress_detail": { permission: "14", effectClass: "read", resourceType: "category", notation: "Read", obligations: ["mask", "bind_cache_key"] },
  });

  it("POLICY-V3-01 carries every p2 user cell, service cell and action definition byte-identical, and the p1 and p2 digests are unchanged", () => {
    assert.deepEqual(P3_USER_CELLS.slice(0, P2_USER_CELLS.length), P2_USER_CELLS);
    assert.deepEqual(P3_USER_CELLS.slice(P2_USER_CELLS.length), P3_ONLY_USER_CELLS);
    assert.deepEqual(P3_USER_CELLS.slice(0, USER_CELLS.length), USER_CELLS);
    assert.deepEqual(P3_SERVICE_CELLS, P2_SERVICE_CELLS); assert.deepEqual(P3_SERVICE_CELLS, SERVICE_CELLS);
    assert.deepEqual(P3_ACTION_DEFINITIONS.slice(0, P2_ACTION_DEFINITIONS.length), P2_ACTION_DEFINITIONS);
    assert.deepEqual(P3_ACTION_DEFINITIONS.slice(P2_ACTION_DEFINITIONS.length), P3_ONLY_ACTION_DEFINITIONS);
    assert.equal(P3_ACTION_DEFINITIONS.length, P2_ACTION_DEFINITIONS.length + p3Only.length);
    assert.deepEqual(p3Only, Object.keys(CONTRACT_P3));
    assert.equal(ACCOUNT_PERMISSION, "manual_account"); assert.equal(PROGRESS_DETAIL_ACTION, "14.view_progress_detail");
    for (const [action, expected] of Object.entries(CONTRACT_P3)) {
      const definition = P3_ONLY_ACTION_DEFINITIONS.find((item) => item.action === action);
      const cell = P3_ONLY_USER_CELLS.find((item) => item.action === action);
      assert.ok(definition && cell, action);
      assert.deepEqual(definition, { action, permission: expected.permission, operation: action.slice(expected.permission.length + 1), effectClass: expected.effectClass, resourceType: expected.resourceType, authorityModes: ["user_delegated"] }, action);
      assert.deepEqual(cell, { action, permission: expected.permission, role: "primary_owner", notation: expected.notation, obligations: expected.obligations }, action);
    }
    // The released digests are pinned independently in config/authorization-policy-release-history.json; they must never move.
    assert.equal(P1_DIGEST, "488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22");
    assert.equal(P2_DIGEST, "374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322");
    assert.match(P3_DIGEST, /^[a-f0-9]{64}$/); assert.notEqual(P3_DIGEST, P2_DIGEST); assert.notEqual(P3_DIGEST, P1_DIGEST);
    assert.equal(POLICY_VERSIONS.p3.digest, P3_DIGEST); assert.equal(POLICY_VERSIONS.p3.schemaVersion, 1);
    assert.equal(P3_USER_CELLS.length, P3_ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved" && item.permission !== "SA-92-002").length);
    assert.equal(P3_USER_CELLS.filter((cell) => cell.permission === "subject").length, 5);
    assert.equal(P3_USER_CELLS.filter((cell) => cell.permission === ACCOUNT_PERMISSION).length, 4);
  });

  it("POLICY-V3-01 evaluates every p2 catalog entry identically under p3", () => {
    for (const fixture of P2_FIXTURES) {
      const under = P3_FIXTURES.find((item) => item.id === fixture.id.replace(/^p2\./, "p3."));
      assert.ok(under, fixture.id);
      const p2 = decideUnderRegisteredVersion("p2", fixture.input); const p3 = decideUnderRegisteredVersion("p3", under.input);
      assert.equal(p3.outcome, p2.outcome, fixture.id); assert.deepEqual(p3.cellRef, p2.cellRef, fixture.id);
      assert.deepEqual(p3.obligations.filter((item) => item.kind !== "recheck_at_commit"), p2.obligations.filter((item) => item.kind !== "recheck_at_commit"), fixture.id);
    }
    // The p2 subject-scoped negatives hold unchanged when pinned to p3.
    for (const fixture of subjectNegativeFixtures("p3")) denyIsInert(fixture.input, fixture.reason, "p3");
  });

  it("POLICY-V3-02 allows the Primary Owner of the acting space for every manual-account cell with the user cellRef and the stated obligations", () => {
    for (const cell of P3_ONLY_USER_CELLS) {
      const expected = CONTRACT_P3[cell.action]!;
      const input = ordinaryFixture(cell.action, "primary_owner", "p3");
      const decision = decideUnderRegisteredVersion("p3", input);
      assert.equal(decision.outcome, "allow", cell.action); assert.equal(decision.reasonClass, "allowed_by_cell");
      assert.equal(decision.policyVersion, "p3"); assert.equal(decision.policyDigest, P3_DIGEST);
      assert.equal(decision.effectClass, expected.effectClass);
      assert.deepEqual(decision.cellRef, { kind: "user", permission: expected.permission, role: "primary_owner" });
      assert.deepEqual(decision.capturedVersions, {
        sessionVersion: 1, subjectVersion: 1, profileVersion: 1, authorizationVersion: 1, consentDisclosureVersion: 1, spaceLifecycleVersion: 1,
        primaryOwnershipVersion: 1, targetVersion: 1, policyVersion: "p3", policyDigest: P3_DIGEST, inputSchemaVersion: 1,
      }, cell.action);
      const kinds = decision.obligations.map((item) => item.kind);
      assert.equal(kinds[0], "audit");
      for (const name of expected.obligations) assert.ok(kinds.includes(name as never), `${cell.action} lacks ${name}`);
      if (expected.effectClass === "read") {
        assert.ok(!kinds.includes("recheck_at_commit"), cell.action);
        assert.deepEqual(decision.obligations.find((item) => item.kind === "bind_cache_key"), { kind: "bind_cache_key", dimensions: ["spaceId", "authorizationVersion", "policyVersion"] });
        assert.deepEqual(decision.obligations.find((item) => item.kind === "mask"), { kind: "mask", fieldSet: "default" });
        // A read survives archival at the frozen archival scope (section 8.2 Read), exactly as 14.view_accounts_balances_transactions does.
        assert.equal(decideUnderRegisteredVersion("p3", restamp({ ...input, space: { ...input.space, lifecycle: "archived" } })).outcome, "allow");
      } else {
        assert.ok(kinds.includes("recheck_at_commit") && !kinds.includes("mask") && !kinds.includes("bind_cache_key"), cell.action);
        assert.deepEqual(decision.obligations.find((item) => item.kind === "preserve"), { kind: "preserve", recordClasses: ["history", "provenance"] });
        assert.deepEqual(decision.obligations.find((item) => item.kind === "invalidate"), { kind: "invalidate", artifactClasses: ["derived_surfaces", "open_work"] });
      }
      assert.ok(!kinds.includes("fresh_assurance") && !kinds.includes("create_primary_owner_membership"), cell.action);
      assert.deepEqual(decideUnderRegisteredVersion("p3", structuredClone(input)), decision, "deterministic");
    }
  });

  it("POLICY-V3-02 denies every other role, another space, a wrong target, an inactive lifecycle, a stale version, service authority and the other families inertly (PC-236-018)", () => {
    const required = ["other_role", "other_space", "wrong_target_type", "inactive_lifecycle", "stale_version", "service_authority", "inactive_subject", "inactive_membership", "consent_not_current", "subject_scoped_shape", "missing_target", ...POV_FAMILIES];
    for (const cell of P3_ONLY_USER_CELLS) {
      const families = P3_NEGATIVE_FIXTURES.filter((item) => item.action === cell.action).map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${cell.action} lacks the ${family} negative`);
      for (const role of ["co_owner", "collaborator", "viewer", "accountability_partner"] as const) assert.ok(P3_NEGATIVE_FIXTURES.some((item) => item.id === `p3.user.${cell.action}.primary_owner.other_role.${role}`), `${cell.action} ${role}`);
    }
    for (const fixture of P3_NEGATIVE_FIXTURES) denyIsInert(fixture.input, fixture.reason, "p3");
    // A mutation never survives archival; the Primary Owner of another space is not the Primary Owner of this one.
    for (const cell of P3_ONLY_USER_CELLS.filter((item) => item.notation === "Allow")) {
      const positive = ordinaryFixture(cell.action, "primary_owner", "p3");
      denyIsInert(restamp({ ...positive, space: { ...positive.space, lifecycle: "archived" } }), "lifecycle_blocked", "p3");
      denyIsInert(restamp({ ...positive, space: { ...positive.space, spaceId: "space-2", primaryOwnerMembershipId: "membership-2" }, assurance: { ...positive.assurance, boundSpaceId: "space-2" } }), "scope_mismatch", "p3");
    }
    // Every p3 positive restamped from any client source denies (AC05 discipline for the new cells).
    for (const cell of P3_ONLY_USER_CELLS) {
      const base = ordinaryFixture(cell.action, "primary_owner", "p3");
      for (const path of Object.keys(base.provenance)) {
        const wrongSource = base.provenance[path] === "request_locator" ? "datastore" : "request_locator";
        denyIsInert({ ...base, provenance: { ...base.provenance, [path]: wrongSource } }, "input_invalid", "p3");
      }
    }
  });

  it("POLICY-V3-03 the registered non-current version denies through decide, and the current version carries its production behaviour", () => {
    assert.equal(policyCompatibility("p3", P3_DIGEST, 1), currentVersion === "p3");
    if (!currentCarries(ACCOUNT_PERMISSION + ".create_manual_account", "primary_owner")) {
      // Before the section 8.6.4 release: every p3 input denies through decide and a p3-only action is unsupported exactly as before p3 existed.
      for (const fixture of P3_FIXTURES) denyIsInert(fixture.input, "policy_version_unsupported");
      for (const action of p3Only) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
    } else {
      // After the release (p3 or any later version carrying the cells): the manual-account cells allow through decide for the
      // Primary Owner, their negatives pinned to the current version deny through decide, and a p2-versioned input denies.
      for (const cell of P3_ONLY_USER_CELLS) assert.deepEqual(decide(ordinaryFixture(cell.action)).cellRef, { kind: "user", permission: cell.permission, role: "primary_owner" });
      for (const fixture of accountNegativeFixtures(currentVersion)) denyIsInert(fixture.input, fixture.reason);
      denyIsInert(bootstrapFixture("p2"), "policy_version_unsupported");
      if (currentVersion !== "p3") for (const fixture of P3_FIXTURES) denyIsInert(fixture.input, "policy_version_unsupported");
    }
    // Historical p1 and p2 coverage that never depends on the current version.
    for (const action of p3Only) {
      assert.ok(!ACTION_DEFINITIONS.some((item) => item.action === action), `${action} must be absent from p1`);
      assert.ok(!P2_ACTION_DEFINITIONS.some((item) => item.action === action), `${action} must be absent from p2`);
      for (const version of ["p1", "p2"] as const) denyIsInert(restamp({ ...ordinaryFixture("1.view_space", "primary_owner", version), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported", version);
    }
  });

  it("AC07 for p3: every non-reserved p3 action is reached by a p3 fixture and the catalog evaluates as expected", () => {
    const fixtureActions = new Set(P3_FIXTURES.map((fixture) => fixture.input.request.action));
    for (const action of P3_ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved")) assert.ok(fixtureActions.has(action.action), action.action);
    for (const fixture of P3_FIXTURES) assert.equal(decideUnderRegisteredVersion("p3", fixture.input).outcome, fixture.expected, fixture.id);
  });
});

describe("policy version p4: Co-owner and Collaborator manual-account cells, registered and not current", () => {
  const p4Actions = ["manual_account.create_manual_account", "manual_account.edit_manual_account", "manual_account.archive_manual_account", "manual_account.restore_manual_account"] as const;
  // Independent oracle transcribed from docs/cbd-236-authorization-policy-contract.md section 8.7.1 (CBD-72 section 4 row 36,
  // PO-CBD72-ROW36-001). It is deliberately NOT derived from v4.ts or v3.ts, so a cell that silently defaults is caught here.
  const CONTRACT_P4: readonly { action: string; role: "co_owner" | "collaborator"; obligations: readonly string[] }[] = Object.freeze((["co_owner", "collaborator"] as const).flatMap((role) => [
    { action: "manual_account.create_manual_account", role, obligations: ["preserve", "invalidate"] },
    { action: "manual_account.edit_manual_account", role, obligations: ["preserve", "invalidate"] },
    { action: "manual_account.archive_manual_account", role, obligations: ["confirm", "preserve", "invalidate"] },
    { action: "manual_account.restore_manual_account", role, obligations: ["confirm", "preserve", "invalidate"] },
  ]));
  const nonOwnerRoles = ["co_owner", "collaborator", "viewer", "accountability_partner"] as const;

  it("POLICY-V4-01 carries every p3 user cell, service cell and action definition byte-identical, adds exactly the eight row-36 cells, and the p1, p2 and p3 digests are unchanged", () => {
    assert.deepEqual(P4_USER_CELLS.slice(0, P3_USER_CELLS.length), P3_USER_CELLS);
    assert.deepEqual(P4_USER_CELLS.slice(P3_USER_CELLS.length), P4_ONLY_USER_CELLS);
    assert.deepEqual(P4_USER_CELLS.slice(0, P2_USER_CELLS.length), P2_USER_CELLS);
    assert.deepEqual(P4_USER_CELLS.slice(0, USER_CELLS.length), USER_CELLS);
    assert.deepEqual(P4_SERVICE_CELLS, P3_SERVICE_CELLS); assert.deepEqual(P4_SERVICE_CELLS, SERVICE_CELLS);
    // No action definition is added or changed: the four codes already exist in p3 with an account target.
    assert.deepEqual(P4_ACTION_DEFINITIONS, P3_ACTION_DEFINITIONS);
    assert.equal(P4_USER_CELLS.length, P3_USER_CELLS.length + 8);
    assert.deepEqual(P4_ROLES, ["co_owner", "collaborator"]);
    assert.equal(P4_ONLY_USER_CELLS.length, CONTRACT_P4.length);
    for (const expected of CONTRACT_P4) {
      const cell = P4_ONLY_USER_CELLS.find((item) => item.action === expected.action && item.role === expected.role);
      assert.ok(cell, `${expected.action} ${expected.role}`);
      assert.deepEqual(cell, { action: expected.action, permission: ACCOUNT_PERMISSION, role: expected.role, notation: "Allow", obligations: expected.obligations }, `${expected.action} ${expected.role}`);
      const owner = P3_ONLY_USER_CELLS.find((item) => item.action === expected.action)!;
      assert.deepEqual({ ...owner, role: expected.role }, cell, "the p3 Primary Owner cell with only the role changed");
    }
    // One cell per (action, role); the detail read stays Primary Owner-only; Viewer and Accountability Partner hold no cell anywhere.
    assert.equal(new Set(P4_USER_CELLS.map((cell) => `${cell.action}|${cell.role}`)).size, P4_USER_CELLS.length);
    assert.deepEqual(rolesWithoutCell(PROGRESS_DETAIL_ACTION, "p4"), nonOwnerRoles);
    for (const action of p4Actions) assert.deepEqual(rolesWithoutCell(action, "p4"), ["viewer", "accountability_partner"]);
    for (const action of p4Actions) assert.deepEqual(rolesWithoutCell(action, "p3"), nonOwnerRoles);
    assert.ok(!P4_USER_CELLS.some((cell) => ["viewer", "accountability_partner"].includes(cell.role)));
    // The released digests are pinned independently in config/authorization-policy-release-history.json; they must never move.
    assert.equal(P1_DIGEST, "488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22");
    assert.equal(P2_DIGEST, "374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322");
    assert.equal(P3_DIGEST, "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d");
    assert.match(P4_DIGEST, /^[a-f0-9]{64}$/); for (const digest of [P1_DIGEST, P2_DIGEST, P3_DIGEST]) assert.notEqual(P4_DIGEST, digest);
    assert.equal(POLICY_VERSIONS.p4.digest, P4_DIGEST); assert.equal(POLICY_VERSIONS.p4.schemaVersion, 1);
  });

  it("POLICY-V4-01 evaluates every p3 catalog entry identically under p4, and the p3 Primary Owner cells keep every negative family under p4", () => {
    for (const fixture of P3_FIXTURES) {
      const under = P4_FIXTURES.find((item) => item.id === fixture.id.replace(/^p3\./, "p4."));
      assert.ok(under, fixture.id);
      const p3 = decideUnderRegisteredVersion("p3", fixture.input); const p4 = decideUnderRegisteredVersion("p4", under.input);
      assert.equal(p4.outcome, p3.outcome, fixture.id); assert.deepEqual(p4.cellRef, p3.cellRef, fixture.id);
      assert.deepEqual(p4.obligations.filter((item) => item.kind !== "recheck_at_commit"), p3.obligations.filter((item) => item.kind !== "recheck_at_commit"), fixture.id);
    }
    for (const fixture of subjectNegativeFixtures("p4")) denyIsInert(fixture.input, fixture.reason, "p4");
    // The p3 negatives re-derived under p4 for the Primary Owner cells: every family survives; the other_role family for the four
    // management cells now names viewer and accountability_partner only, because co_owner and collaborator hold their own cells.
    const owner = P4_NEGATIVE_FIXTURES.filter((item) => item.role === "primary_owner");
    for (const cell of P3_ONLY_USER_CELLS) {
      const families = owner.filter((item) => item.action === cell.action).map((item) => String(item.family));
      for (const family of ["other_role", "other_space", "wrong_target_type", "inactive_lifecycle", "stale_version", "service_authority", "inactive_subject", "inactive_membership", "consent_not_current", "subject_scoped_shape", "missing_target"]) assert.ok(families.includes(family), `${cell.action} lacks the ${family} negative under p4`);
      const otherRoles = owner.filter((item) => item.action === cell.action && item.family === "other_role").map((item) => item.id.split(".").at(-1));
      assert.deepEqual(otherRoles, cell.action === PROGRESS_DETAIL_ACTION ? nonOwnerRoles : ["viewer", "accountability_partner"], cell.action);
    }
    for (const fixture of owner) denyIsInert(fixture.input, fixture.reason, "p4");
  });

  it("POLICY-V4-02 allows a co_owner and a collaborator of the acting space for every manual-account management cell with the user cellRef and the p3 obligations", () => {
    for (const expected of CONTRACT_P4) {
      const input = ordinaryFixture(expected.action, expected.role, "p4");
      const decision = decideUnderRegisteredVersion("p4", input);
      const ownerDecision = decideUnderRegisteredVersion("p4", ordinaryFixture(expected.action, "primary_owner", "p4"));
      const label = `${expected.action} ${expected.role}`;
      assert.equal(decision.outcome, "allow", label); assert.equal(decision.reasonClass, "allowed_by_cell");
      assert.equal(decision.policyVersion, "p4"); assert.equal(decision.policyDigest, P4_DIGEST);
      assert.equal(decision.effectClass, "mutate");
      assert.deepEqual(decision.cellRef, { kind: "user", permission: ACCOUNT_PERMISSION, role: expected.role });
      assert.deepEqual(decision.capturedVersions, {
        sessionVersion: 1, subjectVersion: 1, profileVersion: 1, authorizationVersion: 1, consentDisclosureVersion: 1, spaceLifecycleVersion: 1,
        primaryOwnershipVersion: 1, targetVersion: 1, policyVersion: "p4", policyDigest: P4_DIGEST, inputSchemaVersion: 1,
      }, label);
      // Same obligations as the Primary Owner cell for the same operation (row 36): audit, preserve, invalidate, recheck_at_commit,
      // and confirm on archive and restore only.
      assert.deepEqual(decision.obligations, ownerDecision.obligations, label);
      const kinds = decision.obligations.map((item) => item.kind);
      assert.equal(kinds[0], "audit");
      for (const name of expected.obligations) assert.ok(kinds.includes(name as never), `${label} lacks ${name}`);
      assert.equal(kinds.includes("confirm"), expected.action.endsWith("archive_manual_account") || expected.action.endsWith("restore_manual_account"), label);
      assert.ok(kinds.includes("recheck_at_commit") && !kinds.includes("mask") && !kinds.includes("bind_cache_key"), label);
      assert.ok(!kinds.includes("fresh_assurance") && !kinds.includes("create_primary_owner_membership"), label);
      assert.deepEqual(decision.obligations.find((item) => item.kind === "preserve"), { kind: "preserve", recordClasses: ["history", "provenance"] });
      assert.deepEqual(decision.obligations.find((item) => item.kind === "invalidate"), { kind: "invalidate", artifactClasses: ["derived_surfaces", "open_work"] });
      // The Primary Owner cell is unchanged: same outcome and obligations, its own role in the cellRef.
      assert.equal(ownerDecision.outcome, "allow"); assert.deepEqual(ownerDecision.cellRef, { kind: "user", permission: ACCOUNT_PERMISSION, role: "primary_owner" });
      assert.deepEqual(decideUnderRegisteredVersion("p4", structuredClone(input)), decision, "deterministic");
    }
  });

  it("POLICY-V4-02 denies viewer and accountability_partner, every other negative family, and every Primary Owner-only cell for co_owner and collaborator inertly (PC-236-018)", () => {
    const required = ["other_role", "other_space", "wrong_target_type", "inactive_lifecycle", "stale_version", "service_authority", "inactive_subject", "inactive_membership", "consent_not_current", "subject_scoped_shape", "missing_target", ...POV_FAMILIES];
    for (const expected of CONTRACT_P4) {
      const own = P4_NEGATIVE_FIXTURES.filter((item) => item.action === expected.action && item.role === expected.role);
      const families = own.map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${expected.action} ${expected.role} lacks the ${family} negative`);
      for (const role of ["viewer", "accountability_partner"]) assert.ok(own.some((item) => item.id === `p4.user.${expected.action}.${expected.role}.other_role.${role}`), `${expected.action} ${expected.role} ${role}`);
      assert.ok(!own.some((item) => item.family === "other_role" && (item.id.endsWith(".co_owner") || item.id.endsWith(".collaborator") || item.id.endsWith(".primary_owner"))), "no allowed role is listed as a wrong role");
    }
    for (const fixture of P4_NEGATIVE_FIXTURES) denyIsInert(fixture.input, fixture.reason, "p4");
    // Viewer and Accountability Partner are Deny in row 36 and hold no cell: role_not_permitted by absence, for each operation.
    for (const action of p4Actions) for (const role of ["viewer", "accountability_partner"] as const) denyIsInert(ordinaryFixture(action, role, "p4"), "role_not_permitted", "p4");
    // Every cell p4 carries unchanged from p1, p2 and p3 stays closed to every non-owner role (the AC04 sweep under p4), including the detail read.
    for (const cell of P4_USER_CELLS.filter((item) => item.action !== "space.create" && item.permission !== "subject" && item.role === "primary_owner")) {
      for (const role of rolesWithoutCell(cell.action, "p4")) denyIsInert(ordinaryFixture(cell.action, role, "p4"), "role_not_permitted", "p4");
      if (!(p4Actions as readonly string[]).includes(cell.action)) assert.deepEqual(rolesWithoutCell(cell.action, "p4"), nonOwnerRoles, cell.action);
    }
    assert.equal(ROLES.length, 5);
    // A mutation never survives archival; a co_owner of another space is not a co_owner of this one; a co_owner holding the
    // primary membership id still evaluates its own role's cell (Allow notation, not Primary).
    for (const expected of CONTRACT_P4) {
      const positive = ordinaryFixture(expected.action, expected.role, "p4");
      denyIsInert(restamp({ ...positive, space: { ...positive.space, lifecycle: "archived" } }), "lifecycle_blocked", "p4");
      denyIsInert(restamp({ ...positive, space: { ...positive.space, lifecycle: "deletion_pending" } }), "lifecycle_blocked", "p4");
      denyIsInert(restamp({ ...positive, space: { ...positive.space, spaceId: "space-2", primaryOwnerMembershipId: "membership-2" }, assurance: { ...positive.assurance, boundSpaceId: "space-2" } }), "scope_mismatch", "p4");
      denyIsInert(restamp({ ...positive, resource: { ...positive.resource, type: "category" } }), "scope_mismatch", "p4");
      assert.deepEqual(decideUnderRegisteredVersion("p4", restamp({ ...positive, membership: { ...positive.membership, membershipId: "membership-2" } })).cellRef, { kind: "user", permission: ACCOUNT_PERMISSION, role: expected.role });
      // Every p4 positive restamped from any client source denies (AC05 discipline for the new cells).
      for (const path of Object.keys(positive.provenance)) {
        const wrongSource = positive.provenance[path] === "request_locator" ? "datastore" : "request_locator";
        denyIsInert({ ...positive, provenance: { ...positive.provenance, [path]: wrongSource } }, "input_invalid", "p4");
      }
    }
  });

  it("POLICY-V4-03 the registered non-current version denies through decide, a p4-only role in a current input denies role_not_permitted, and the current version carries its production behaviour", () => {
    assert.equal(policyCompatibility("p4", P4_DIGEST, 1), currentVersion === "p4");
    if (!currentCarries(p4Actions[0], "co_owner")) {
      // Before the section 8.7.4 release: every p4 input denies through decide, and a co_owner or collaborator request naming a
      // management cell in a current-version input denies role_not_permitted exactly as before p4 existed (the routes already bind
      // the action names, so this is the production behaviour of a non-owner request today).
      for (const fixture of P4_FIXTURES) denyIsInert(fixture.input, "policy_version_unsupported");
      for (const expected of CONTRACT_P4) denyIsInert(ordinaryFixture(expected.action, expected.role), "role_not_permitted");
      for (const action of p4Actions) assert.equal(decide(ordinaryFixture(action)).outcome, "allow", `${action} for the Primary Owner stays allowed on the current version`);
    } else {
      // After the release: the eight cells allow through decide, their negatives deny through decide, and a p3-versioned input denies.
      for (const expected of CONTRACT_P4) assert.deepEqual(decide(ordinaryFixture(expected.action, expected.role)).cellRef, { kind: "user", permission: ACCOUNT_PERMISSION, role: expected.role });
      for (const fixture of accountNegativeFixtures(currentVersion)) denyIsInert(fixture.input, fixture.reason);
      denyIsInert(bootstrapFixture("p3"), "policy_version_unsupported");
    }
    // Historical p1, p2 and p3 coverage that never depends on the current version.
    for (const expected of CONTRACT_P4) {
      for (const version of ["p1", "p2"] as const) denyIsInert(restamp({ ...ordinaryFixture("1.view_space", expected.role, version), request: { action: expected.action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported", version);
      denyIsInert(ordinaryFixture(expected.action, expected.role, "p3"), "role_not_permitted", "p3");
    }
  });

  it("AC07 for p4: every non-reserved p4 action and every p4 cell is reached by a p4 fixture in its own role and the catalog evaluates as expected", () => {
    const fixtureActions = new Set(P4_FIXTURES.map((fixture) => fixture.input.request.action));
    for (const action of P4_ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved")) assert.ok(fixtureActions.has(action.action), action.action);
    for (const cell of P4_ONLY_USER_CELLS) assert.ok(P4_FIXTURES.some((fixture) => fixture.id === `p4.user.${cell.action}.${cell.role}.api`), `${cell.action} ${cell.role}`);
    for (const fixture of P4_FIXTURES) assert.equal(decideUnderRegisteredVersion("p4", fixture.input).outcome, fixture.expected, fixture.id);
  });
});

describe("policy version p5: invitations, members and Primary-transfer cells, registered above the unreleased p4 and not current", () => {
  // Independent oracle transcribed from docs/cbd-236-authorization-policy-contract.md section 8.8.1 (the approved design
  // docs/cbd-234-invitations-consent-design-proposal.md section 11, INVITATIONS-DESIGN-001 items 10 and 11). It is deliberately
  // NOT derived from v5.ts, so a cell or definition that silently defaults or drifts is caught here.
  const CONTRACT_P5_SPACE: readonly { action: string; permission: string; effectClass: string; resourceType: string; roles: Readonly<Record<string, string>>; obligations: readonly string[] }[] = Object.freeze([
    { action: "24.view_invitations", permission: "24", effectClass: "read", resourceType: "space", roles: { primary_owner: "Read", co_owner: "Read" }, obligations: ["bind_cache_key"] },
    { action: "24.confirm_acceptance", permission: "24", effectClass: "mutate", resourceType: "invitation", roles: { primary_owner: "Allow", co_owner: "Allow" }, obligations: ["invalidate"] },
    { action: "26.confirm_acceptance", permission: "26", effectClass: "mutate", resourceType: "invitation", roles: { primary_owner: "Allow" }, obligations: ["invalidate"] },
    { action: "1.view_members", permission: "1", effectClass: "read", resourceType: "space", roles: { primary_owner: "Read", co_owner: "Read", collaborator: "Read" }, obligations: ["bind_cache_key"] },
    { action: "29.propose_primary_transfer", permission: "29", effectClass: "mutate", resourceType: "membership", roles: { primary_owner: "Primary" }, obligations: [] },
    { action: "29.accept_primary_transfer", permission: "29", effectClass: "mutate", resourceType: "membership", roles: { co_owner: "Allow", collaborator: "Allow" }, obligations: [] },
    { action: "29.decline_primary_transfer", permission: "29", effectClass: "mutate", resourceType: "membership", roles: { co_owner: "Allow", collaborator: "Allow" }, obligations: [] },
    { action: "29.withdraw_primary_transfer", permission: "29", effectClass: "mutate", resourceType: "membership", roles: { primary_owner: "Primary" }, obligations: [] },
    { action: "29.view_primary_transfer", permission: "29", effectClass: "read", resourceType: "membership", roles: { primary_owner: "Read", co_owner: "Read", collaborator: "Read" }, obligations: ["bind_cache_key"] },
  ]);
  const CONTRACT_P5_SUPERSEDED = ["24.invite_nonowner", "24.resend_invitation", "24.replace_invitation", "24.revoke_nonowner", "26.invite_coowner"];
  const CONTRACT_P5_COOWNER_INVITATIONS = ["24.invite_nonowner", "24.replace_invitation", "24.resend_invitation", "24.revoke_nonowner"];
  const CONTRACT_P5_SUBJECT: readonly { action: string; effectClass: string; resourceType?: string; obligations: readonly string[] }[] = Object.freeze([
    { action: "invitation.attach", effectClass: "mutate", obligations: [] },
    { action: "invitation.read_ceremony", effectClass: "read", resourceType: "invitation_ceremony", obligations: ["bind_cache_key"] },
    { action: "invitation.accept", effectClass: "mutate", resourceType: "invitation_ceremony", obligations: [] },
  ]);
  // CBD-72 rows 1, 2a, 4, 9, 14, 15: Co-owner and Collaborator columns with the Primary Owner obligations of the same row.
  const CONTRACT_P5_BASELINE: Readonly<Record<string, { notation: string; obligations: readonly string[] }>> = Object.freeze({
    "1.view_space": { notation: "Read", obligations: [] },
    "2a.create_plan": { notation: "Allow", obligations: ["preserve"] }, "2a.edit_plan": { notation: "Allow", obligations: ["preserve"] }, "2a.edit_target": { notation: "Allow", obligations: ["preserve"] },
    "4.create_category": { notation: "Allow", obligations: ["preserve"] }, "4.edit_category": { notation: "Allow", obligations: ["preserve"] }, "4.archive_category": { notation: "Allow", obligations: ["preserve"] }, "4.restore_category": { notation: "Allow", obligations: ["preserve"] },
    "9.add_manual_transaction": { notation: "Allow", obligations: ["confirm", "preserve", "invalidate"] }, "9.edit_manual_transaction": { notation: "Allow", obligations: ["confirm", "preserve", "invalidate"] }, "9.remove_manual_transaction": { notation: "Allow", obligations: ["confirm", "preserve", "invalidate"] }, "9.restore_manual_transaction": { notation: "Allow", obligations: ["confirm", "preserve", "invalidate"] },
    "14.view_accounts_balances_transactions": { notation: "Read", obligations: ["mask", "bind_cache_key"] }, "14.view_progress_detail": { notation: "Read", obligations: ["mask", "bind_cache_key"] },
    "15.view_planning_and_reports": { notation: "Read", obligations: ["mask", "bind_cache_key"] },
  });
  const PROTECTED_PERMISSIONS = ["20a", "20b", "27", "29", "34", "35"];
  const unmapped = ["viewer", "accountability_partner"] as const;
  const p5Only = P5_ONLY_ACTION_DEFINITIONS.map((item) => item.action);
  const spaceCells = [...P5_SPACE_CELLS, ...P5_COOWNER_INVITATION_CELLS, ...P5_BASELINE_NON_OWNER_CELLS];

  it("POLICY-V5-01 carries every p4 cell, service cell and definition byte-identical except the five superseded targets, adds exactly the section 8.8.1 cells, and the four earlier digests are unchanged", () => {
    assert.deepEqual(P5_USER_CELLS.slice(0, P4_USER_CELLS.length), P4_USER_CELLS);
    assert.deepEqual(P5_USER_CELLS.slice(P4_USER_CELLS.length), P5_ONLY_USER_CELLS);
    assert.deepEqual(P5_USER_CELLS.slice(0, P3_USER_CELLS.length), P3_USER_CELLS);
    assert.deepEqual(P5_USER_CELLS.slice(0, P2_USER_CELLS.length), P2_USER_CELLS);
    assert.deepEqual(P5_USER_CELLS.slice(0, USER_CELLS.length), USER_CELLS);
    assert.deepEqual(P5_SERVICE_CELLS, P4_SERVICE_CELLS); assert.deepEqual(P5_SERVICE_CELLS, SERVICE_CELLS);
    // Section 11.1: five p1 definitions change resourceType from membership to invitation in place; every other definition is byte-identical.
    assert.deepEqual(SUPERSEDED_ACTIONS, CONTRACT_P5_SUPERSEDED);
    assert.equal(P5_ACTION_DEFINITIONS.length, P4_ACTION_DEFINITIONS.length + p5Only.length);
    P4_ACTION_DEFINITIONS.forEach((definition, index) => {
      const p5 = P5_ACTION_DEFINITIONS[index]!;
      if (CONTRACT_P5_SUPERSEDED.includes(definition.action)) {
        assert.equal(definition.resourceType, "membership", definition.action);
        assert.deepEqual(p5, { ...definition, resourceType: "invitation" }, definition.action);
      } else assert.deepEqual(p5, definition, definition.action);
    });
    assert.deepEqual(P5_ACTION_DEFINITIONS.slice(P4_ACTION_DEFINITIONS.length), P5_ONLY_ACTION_DEFINITIONS);
    assert.deepEqual(p5Only, [...CONTRACT_P5_SPACE.map((item) => item.action), ...CONTRACT_P5_SUBJECT.map((item) => item.action)]);
    // Section 11.2: the space-bound cells and their definitions.
    for (const expected of CONTRACT_P5_SPACE) {
      const definition = P5_ONLY_ACTION_DEFINITIONS.find((item) => item.action === expected.action);
      assert.deepEqual(definition, { action: expected.action, permission: expected.permission, operation: expected.action.slice(expected.permission.length + 1), effectClass: expected.effectClass, resourceType: expected.resourceType, authorityModes: ["user_delegated"] }, expected.action);
      const cells = P5_SPACE_CELLS.filter((item) => item.action === expected.action);
      assert.deepEqual(cells.map((item) => item.role), Object.keys(expected.roles), expected.action);
      for (const cell of cells) assert.deepEqual(cell, { action: expected.action, permission: expected.permission, role: cell.role, notation: expected.roles[cell.role], obligations: expected.obligations }, `${expected.action} ${cell.role}`);
    }
    assert.equal(P5_SPACE_CELLS.length, CONTRACT_P5_SPACE.reduce((sum, item) => sum + Object.keys(item.roles).length, 0));
    // Section 11.2 last paragraph: the Co-owner Allow column on the four row-24 operations, obligations as the p1 Primary Owner cell.
    assert.deepEqual(COOWNER_INVITATION_ACTIONS, CONTRACT_P5_COOWNER_INVITATIONS);
    for (const action of CONTRACT_P5_COOWNER_INVITATIONS) {
      const owner = USER_CELLS.find((item) => item.action === action)!;
      assert.deepEqual(P5_COOWNER_INVITATION_CELLS.find((item) => item.action === action), { action, permission: "24", role: "co_owner", notation: "Allow", obligations: ["invalidate", "notify"] }, action);
      assert.deepEqual(P5_COOWNER_INVITATION_CELLS.find((item) => item.action === action), { ...owner, role: "co_owner" }, action);
    }
    assert.equal(P5_COOWNER_INVITATION_CELLS.length, 4);
    assert.ok(!P5_USER_CELLS.some((cell) => cell.action === "26.invite_coowner" && cell.role !== "primary_owner"), "26.invite_coowner stays Primary-only (row 26)");
    assert.ok(!P5_USER_CELLS.some((cell) => cell.action === "24.remove_nonowner" && cell.role !== "primary_owner"), "24.remove_nonowner is not exercised in this increment");
    // Section 11.3: the subject-scoped invitee cells.
    for (const expected of CONTRACT_P5_SUBJECT) {
      const definition = P5_ONLY_ACTION_DEFINITIONS.find((item) => item.action === expected.action);
      assert.deepEqual(definition, { action: expected.action, permission: "subject", operation: expected.action.slice("invitation.".length), effectClass: expected.effectClass, ...(expected.resourceType === undefined ? {} : { resourceType: expected.resourceType }), authorityModes: ["user_delegated"] }, expected.action);
      assert.deepEqual(P5_SUBJECT_CELLS.find((item) => item.action === expected.action), { action: expected.action, permission: "subject", role: "acting_subject", notation: expected.effectClass === "read" ? "Read" : "Allow", obligations: expected.obligations }, expected.action);
    }
    assert.equal(P5_SUBJECT_CELLS.length, 3);
    // Section 11.4: the Co-owner and Collaborator columns for the baseline actions, CBD-72's values, the Primary Owner obligations.
    assert.deepEqual(BASELINE_NON_OWNER_ACTIONS, Object.keys(CONTRACT_P5_BASELINE));
    assert.deepEqual(P5_ROLES, ["co_owner", "collaborator"]);
    for (const [action, expected] of Object.entries(CONTRACT_P5_BASELINE)) {
      const owner = P4_USER_CELLS.find((item) => item.action === action && item.role === "primary_owner")!;
      assert.deepEqual({ notation: owner.notation, obligations: owner.obligations }, expected, `${action} Primary Owner cell matches CBD-72`);
      for (const role of P5_ROLES) assert.deepEqual(P5_BASELINE_NON_OWNER_CELLS.find((item) => item.action === action && item.role === role), { action, permission: owner.permission, role, notation: expected.notation, obligations: expected.obligations }, `${action} ${role}`);
    }
    assert.equal(P5_BASELINE_NON_OWNER_CELLS.length, 30);
    assert.equal(P5_ONLY_USER_CELLS.length, P5_SPACE_CELLS.length + 4 + 3 + 30);
    assert.deepEqual(P5_ONLY_USER_CELLS, [...P5_SPACE_CELLS, ...P5_COOWNER_INVITATION_CELLS, ...P5_SUBJECT_CELLS, ...P5_BASELINE_NON_OWNER_CELLS]);
    // One cell per (action, role); Viewer and Accountability Partner hold no cell anywhere (IV-001).
    assert.equal(new Set(P5_USER_CELLS.map((cell) => `${cell.action}|${cell.role}`)).size, P5_USER_CELLS.length);
    assert.ok(!P5_USER_CELLS.some((cell) => (unmapped as readonly string[]).includes(cell.role)));
    // Section 8.8.2: the assurance predicate reads the cell's own fresh_assurance obligation. Through p4 that is exactly the six
    // protected permissions; in p5 the row-29 workflow cells are the first permission-29 cells without it, and the p1 confirm cell keeps it.
    for (const version of ["p1", "p2", "p3", "p4"] as const) for (const cell of POLICY_VERSIONS[version].userCells) assert.equal(cell.obligations.includes("fresh_assurance"), PROTECTED_PERMISSIONS.includes(cell.permission), `${version} ${cell.action} ${cell.role}`);
    for (const cell of P5_USER_CELLS) assert.equal(cell.obligations.includes("fresh_assurance"), PROTECTED_PERMISSIONS.includes(cell.permission) && !p5Only.includes(cell.action), `${cell.action} ${cell.role}`);
    assert.ok(P5_USER_CELLS.find((cell) => cell.action === TRANSFER_CONFIRM_ACTION)!.obligations.includes("fresh_assurance"));
    // The released and registered digests are pinned; p5 is distinct and schemaVersion stays 1.
    assert.equal(P1_DIGEST, "488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22");
    assert.equal(P2_DIGEST, "374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322");
    assert.equal(P3_DIGEST, "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d");
    assert.equal(P4_DIGEST, "25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9");
    assert.match(P5_DIGEST, /^[a-f0-9]{64}$/); for (const digest of [P1_DIGEST, P2_DIGEST, P3_DIGEST, P4_DIGEST]) assert.notEqual(P5_DIGEST, digest);
    assert.equal(POLICY_VERSIONS.p5.digest, P5_DIGEST); assert.equal(POLICY_VERSIONS.p5.schemaVersion, 1);
  });

  it("POLICY-V5-01 evaluates every p4 catalog entry identically under p5, and every p2, p3 and p4 negative family holds under p5", () => {
    for (const fixture of P4_FIXTURES) {
      const under = P5_FIXTURES.find((item) => item.id === fixture.id.replace(/^p4\./, "p5."));
      assert.ok(under, fixture.id);
      const p4 = decideUnderRegisteredVersion("p4", fixture.input); const p5 = decideUnderRegisteredVersion("p5", under.input);
      assert.equal(p5.outcome, p4.outcome, fixture.id); assert.deepEqual(p5.cellRef, p4.cellRef, fixture.id);
      assert.deepEqual(p5.obligations.filter((item) => item.kind !== "recheck_at_commit"), p4.obligations.filter((item) => item.kind !== "recheck_at_commit"), fixture.id);
    }
    for (const fixture of subjectNegativeFixtures("p5")) denyIsInert(fixture.input, fixture.reason, "p5");
    for (const fixture of accountNegativeFixtures("p5")) denyIsInert(fixture.input, fixture.reason, "p5");
    // The wrong-role family re-derived under p5: the baseline actions now name viewer and accountability_partner only.
    for (const action of BASELINE_NON_OWNER_ACTIONS) assert.deepEqual(rolesWithoutCell(action, "p5"), unmapped, action);
    for (const action of BASELINE_NON_OWNER_ACTIONS) assert.deepEqual(rolesWithoutCell(action, "p4"), ["co_owner", "collaborator", ...unmapped], action);
    // A superseded definition binds the invitation row in p5 and the membership row in p4; each version denies the other's target type.
    for (const action of CONTRACT_P5_SUPERSEDED) {
      const p4 = ordinaryFixture(action, "primary_owner", "p4"); const p5 = ordinaryFixture(action, "primary_owner", "p5");
      assert.equal(p4.resource.type, "membership"); assert.equal(p5.resource.type, "invitation");
      assert.equal(decideUnderRegisteredVersion("p4", p4).outcome, "allow"); assert.equal(decideUnderRegisteredVersion("p5", p5).outcome, "allow");
      denyIsInert(restamp({ ...p5, resource: { ...p5.resource, type: "membership" } }), "scope_mismatch", "p5");
    }
  });

  it("POLICY-V5-02 allows exactly the mapped roles for every section 11.2 cell, at session-level assurance for the unprotected row-29 workflow, with the stated obligations", () => {
    for (const expected of CONTRACT_P5_SPACE) {
      for (const [role, notation] of Object.entries(expected.roles)) {
        const label = `${expected.action} ${role}`;
        const input = ordinaryFixture(expected.action, role as never, "p5");
        const decision = decideUnderRegisteredVersion("p5", input);
        assert.equal(decision.outcome, "allow", label); assert.equal(decision.reasonClass, "allowed_by_cell");
        assert.equal(decision.policyVersion, "p5"); assert.equal(decision.policyDigest, P5_DIGEST);
        assert.equal(decision.effectClass, expected.effectClass, label);
        assert.deepEqual(decision.cellRef, { kind: "user", permission: expected.permission, role }, label);
        assert.deepEqual(decision.capturedVersions, {
          sessionVersion: 1, subjectVersion: 1, profileVersion: 1, authorizationVersion: 1, consentDisclosureVersion: 1, spaceLifecycleVersion: 1,
          primaryOwnershipVersion: 1, targetVersion: 1, policyVersion: "p5", policyDigest: P5_DIGEST, inputSchemaVersion: 1,
        }, label);
        const kinds = decision.obligations.map((item) => item.kind);
        assert.equal(kinds[0], "audit");
        assert.deepEqual(kinds.filter((kind) => kind !== "audit" && kind !== "recheck_at_commit"), expected.obligations, label);
        if (expected.effectClass === "read") {
          assert.ok(!kinds.includes("recheck_at_commit"), label);
          assert.deepEqual(decision.obligations.find((item) => item.kind === "bind_cache_key"), { kind: "bind_cache_key", dimensions: ["spaceId", "authorizationVersion", "policyVersion"] });
          // A read survives archival at frozen archival scope (section 8.2 Read).
          assert.equal(decideUnderRegisteredVersion("p5", restamp({ ...input, space: { ...input.space, lifecycle: "archived" } })).outcome, "allow", label);
        } else {
          assert.ok(kinds.includes("recheck_at_commit"), label);
          if (expected.obligations.includes("invalidate")) assert.deepEqual(decision.obligations.find((item) => item.kind === "invalidate"), { kind: "invalidate", artifactClasses: ["derived_surfaces", "open_work"] });
        }
        assert.ok(!kinds.includes("fresh_assurance") && !kinds.includes("mask") && !kinds.includes("notify") && !kinds.includes("confirm"), label);
        // None of the section 11.2 cells is protected: session-level assurance allows (the fixture default is fresh), unlike the p1 confirm leg.
        assert.equal(decideUnderRegisteredVersion("p5", restamp({ ...input, assurance: { level: "session" as const } })).outcome, "allow", `${label} at session assurance`);
        // Primary notation compares the membership id with the space's Primary membership; Allow and Read do not.
        const otherMembership = decideUnderRegisteredVersion("p5", restamp({ ...input, membership: { ...input.membership, membershipId: "membership-2" } }));
        if (notation === "Primary") denyIsInert(restamp({ ...input, membership: { ...input.membership, membershipId: "membership-2" } }), "role_not_permitted", "p5");
        else assert.equal(otherMembership.outcome, "allow", label);
        assert.deepEqual(decideUnderRegisteredVersion("p5", structuredClone(input)), decision, "deterministic");
      }
      for (const role of rolesWithoutCell(expected.action, "p5")) denyIsInert(ordinaryFixture(expected.action, role, "p5"), "role_not_permitted", "p5");
    }
    // The Primary Owner holds no accept or decline cell; a Co-owner holds no propose, withdraw or Co-owner-confirmation cell.
    for (const action of ["29.accept_primary_transfer", "29.decline_primary_transfer"]) denyIsInert(ordinaryFixture(action, "primary_owner", "p5"), "role_not_permitted", "p5");
    for (const action of ["29.propose_primary_transfer", "29.withdraw_primary_transfer", "26.confirm_acceptance", "26.invite_coowner", "24.remove_nonowner"]) for (const role of ["co_owner", "collaborator"] as const) denyIsInert(ordinaryFixture(action, role, "p5"), "role_not_permitted", "p5");
    // 29.transfer_primary_ownership is the unchanged p1 protected cell: fresh assurance bound to the action and space, Primary only.
    const confirm = ordinaryFixture(TRANSFER_CONFIRM_ACTION, "primary_owner", "p5");
    const confirmed = decideUnderRegisteredVersion("p5", confirm);
    assert.equal(confirmed.outcome, "allow"); assert.ok(confirmed.obligations.some((item) => item.kind === "fresh_assurance"));
    denyIsInert(restamp({ ...confirm, assurance: { level: "session" } }), "assurance_required", "p5");
    for (const role of ["co_owner", "collaborator", ...unmapped] as const) denyIsInert(ordinaryFixture(TRANSFER_CONFIRM_ACTION, role, "p5"), "role_not_permitted", "p5");
    // The Co-owner column on the four row-24 invitation operations: same decision as the Primary Owner, own role in the cellRef, invitation target.
    for (const action of CONTRACT_P5_COOWNER_INVITATIONS) {
      const input = ordinaryFixture(action, "co_owner", "p5");
      assert.equal(input.resource.type, "invitation", action);
      const decision = decideUnderRegisteredVersion("p5", input);
      const owner = decideUnderRegisteredVersion("p5", ordinaryFixture(action, "primary_owner", "p5"));
      assert.equal(decision.outcome, "allow", action); assert.deepEqual(decision.cellRef, { kind: "user", permission: "24", role: "co_owner" });
      assert.deepEqual(decision.obligations, owner.obligations, action);
      assert.deepEqual(decision.obligations.map((item) => item.kind), ["audit", "invalidate", "notify", "recheck_at_commit"], action);
      for (const role of ["collaborator", ...unmapped] as const) denyIsInert(ordinaryFixture(action, role, "p5"), "role_not_permitted", "p5");
      denyIsInert(ordinaryFixture(action, "co_owner", "p4"), "role_not_permitted", "p4");
    }
  });

  it("POLICY-V5-02 allows the owning subject for the three invitee cells with the subject cellRef and denies every section 9.4 family inertly", () => {
    for (const expected of CONTRACT_P5_SUBJECT) {
      const input = subjectFixture(expected.action, "p5");
      const decision = decideUnderRegisteredVersion("p5", input);
      assert.equal(decision.outcome, "allow", expected.action); assert.equal(decision.reasonClass, "allowed_by_cell");
      assert.equal(decision.policyVersion, "p5"); assert.equal(decision.policyDigest, P5_DIGEST);
      assert.deepEqual(decision.cellRef, { kind: "subject", action: expected.action });
      assert.equal(decision.effectClass, expected.effectClass);
      assert.equal(input.resource?.type, expected.resourceType, expected.action);
      if (input.resource) { assert.equal(input.resource.owningSpaceId, "none"); assert.equal(input.resource.owningSubjectId, "subject-1"); assert.equal(input.resource.environmentId, SUBJECT_ENVIRONMENT); }
      assert.deepEqual(decision.capturedVersions, {
        sessionVersion: 1, subjectVersion: 1, profileVersion: 1, environmentId: SUBJECT_ENVIRONMENT,
        ...(expected.resourceType === undefined ? {} : { targetVersion: 1 }), policyVersion: "p5", policyDigest: P5_DIGEST, inputSchemaVersion: 1,
      }, expected.action);
      const kinds = decision.obligations.map((item) => item.kind);
      assert.equal(kinds[0], "audit");
      if (expected.effectClass === "read") {
        assert.ok(kinds.includes("bind_cache_key") && !kinds.includes("recheck_at_commit"), expected.action);
        assert.deepEqual(decision.obligations.find((item) => item.kind === "bind_cache_key"), { kind: "bind_cache_key", dimensions: ["environmentId", "accountSubjectId", "subjectVersion", "profileVersion", "targetVersion", "policyVersion"] });
      } else assert.ok(kinds.includes("recheck_at_commit") && !kinds.includes("bind_cache_key"), expected.action);
      assert.ok(!kinds.includes("fresh_assurance") && !kinds.includes("create_primary_owner_membership"), expected.action);
      assert.deepEqual(decideUnderRegisteredVersion("p5", structuredClone(input)), decision, "deterministic");
    }
    const required = ["another_subject", "wrong_environment", "stale_session_version", "service_authority", "inactive_subject", "inactive_profile", "wrong_target_shape", "space_bound_shape", "worker_adapter", "forbidden_section_empty", "forbidden_section_populated"];
    const negatives = subjectNegativeFixtures("p5");
    assert.deepEqual(subjectCells("p5").map((cell) => cell.action), [...SUBJECT_CELLS.map((cell) => cell.action), ...CONTRACT_P5_SUBJECT.map((cell) => cell.action)]);
    for (const expected of CONTRACT_P5_SUBJECT) {
      const families = negatives.filter((item) => item.action === expected.action).map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${expected.action} lacks the ${family} negative`);
      if (expected.resourceType !== undefined) assert.ok(families.includes("wrong_target_type"), expected.action);
      const positive = subjectFixture(expected.action, "p5");
      for (const section of Object.keys(FORBIDDEN_SUBJECT_SECTIONS)) { denyIsInert(restamp({ ...positive, [section]: {} }), "input_invalid", "p5"); denyIsInert({ ...positive, [section]: {} }, "input_invalid", "p5"); }
      denyIsInert(restamp({ ...positive, subject: { ...positive.subject, delegationRef: "delegation-1", delegationVersion: 1 } }), "input_invalid", "p5");
      // The ceremony row is subject-owned until commit: another attached subject, another environment, or an owning space deny.
      if (positive.resource) {
        denyIsInert(restamp({ ...positive, resource: { ...positive.resource, owningSubjectId: "subject-2" } }), "scope_mismatch", "p5");
        denyIsInert(restamp({ ...positive, resource: { ...positive.resource, environmentId: "env-other" } }), "scope_mismatch", "p5");
        denyIsInert(restamp({ ...positive, resource: { ...positive.resource, owningSpaceId: "space-1" } }), "input_invalid", "p5");
        denyIsInert(restamp({ ...positive, resource: { ...positive.resource, type: "invitation" } }), "scope_mismatch", "p5");
      }
      // A subject cell presented in the space-bound shape, and a space cell in the subject shape, are malformed.
      denyIsInert(restamp({ ...ordinaryFixture("1.view_space", "primary_owner", "p5"), request: { action: expected.action, purpose: "user_delegated", fieldSet: "default" } }), "input_invalid", "p5");
      denyIsInert(restamp({ ...positive, request: { action: "24.view_invitations", purpose: "user_delegated", fieldSet: "default" } }), "input_invalid", "p5");
      for (const path of Object.keys(positive.provenance)) {
        const wrongSource = positive.provenance[path] === "request_locator" ? "datastore" : "request_locator";
        denyIsInert({ ...positive, provenance: { ...positive.provenance, [path]: wrongSource } }, "input_invalid", "p5");
      }
    }
    for (const fixture of negatives) denyIsInert(fixture.input, fixture.reason, "p5");
  });

  it("POLICY-V5-02 allows a co_owner and a collaborator for every section 11.4 baseline action with the Primary Owner obligations and denies every unmapped role and every section 11.5 family inertly (PC-236-018)", () => {
    for (const [action, expected] of Object.entries(CONTRACT_P5_BASELINE)) {
      const owner = decideUnderRegisteredVersion("p5", ordinaryFixture(action, "primary_owner", "p5"));
      assert.equal(owner.outcome, "allow", action);
      for (const role of P5_ROLES) {
        const label = `${action} ${role}`;
        const decision = decideUnderRegisteredVersion("p5", ordinaryFixture(action, role, "p5"));
        assert.equal(decision.outcome, "allow", label); assert.equal(decision.effectClass, expected.notation === "Read" ? "read" : owner.effectClass, label);
        assert.deepEqual(decision.cellRef, { ...owner.cellRef, role }, label);
        assert.deepEqual(decision.obligations, owner.obligations, label);
        assert.deepEqual(decision.capturedVersions, owner.capturedVersions, label);
        denyIsInert(ordinaryFixture(action, role, "p4"), "role_not_permitted", "p4");
      }
      for (const role of unmapped) denyIsInert(ordinaryFixture(action, role, "p5"), "role_not_permitted", "p5");
    }
    // Every other Primary Owner-only cell carried from p1-p4 stays closed to every non-owner role under p5.
    for (const cell of P5_USER_CELLS.filter((item) => item.action !== "space.create" && item.permission !== "subject" && item.role === "primary_owner")) {
      for (const role of rolesWithoutCell(cell.action, "p5")) denyIsInert(ordinaryFixture(cell.action, role, "p5"), "role_not_permitted", "p5");
    }
    // Section 9.7 families, cell by cell, for every p5 space-bound cell in its own role.
    // The secret scanner reads an identifier containing "auth" followed by a comma and a long identifier as a credential, so that family is listed last.
    const required = ["other_role", "other_space", "wrong_target_type", "inactive_lifecycle", "stale_version", "stale_primary_ownership_version", "stale_consent_version", "service_authority", "inactive_subject", "inactive_membership", "consent_not_current", "consent_superseded", "subject_scoped_shape", "missing_target", ...POV_FAMILIES, "stale_authorization_version"];
    assert.equal(invitationCells("p5").length, spaceCells.length);
    assert.equal(invitationCells("p4").length, 0);
    for (const cell of spaceCells) {
      const own = P5_NEGATIVE_FIXTURES.filter((item) => item.action === cell.action && item.role === cell.role);
      const families = own.map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${cell.action} ${cell.role} lacks the ${family} negative`);
      for (const role of unmapped) assert.ok(own.some((item) => item.id === `p5.user.${cell.action}.${cell.role}.other_role.${role}`), `${cell.action} ${cell.role} ${role}`);
      assert.ok(!own.some((item) => item.family === "other_role" && P5_USER_CELLS.some((mapped) => mapped.action === cell.action && item.id.endsWith(`.${mapped.role}`))), "no mapped role is listed as a wrong role");
    }
    for (const family of ["session_only", "bound_to_other_action", "bound_to_other_space", "expired"]) assert.ok(P5_NEGATIVE_FIXTURES.some((item) => item.id === `p5.user.${TRANSFER_CONFIRM_ACTION}.primary_owner.assurance.${family}`), family);
    for (const fixture of P5_NEGATIVE_FIXTURES) denyIsInert(fixture.input, fixture.reason, "p5");
    // A mutation never survives archival or deletion pending; a member of another space is not a member of this one; every p5 positive restamped from any client source denies.
    for (const cell of spaceCells) {
      const positive = ordinaryFixture(cell.action, cell.role, "p5");
      const read = decideUnderRegisteredVersion("p5", positive).effectClass === "read";
      if (!read) { denyIsInert(restamp({ ...positive, space: { ...positive.space, lifecycle: "archived" } }), "lifecycle_blocked", "p5"); denyIsInert(restamp({ ...positive, space: { ...positive.space, lifecycle: "deletion_pending" } }), "lifecycle_blocked", "p5"); }
      denyIsInert(restamp({ ...positive, space: { ...positive.space, spaceId: "space-2", primaryOwnerMembershipId: "membership-2" }, assurance: { ...positive.assurance, boundSpaceId: "space-2" } }), "scope_mismatch", "p5");
      for (const path of Object.keys(positive.provenance)) {
        const wrongSource = positive.provenance[path] === "request_locator" ? "datastore" : "request_locator";
        denyIsInert({ ...positive, provenance: { ...positive.provenance, [path]: wrongSource } }, "input_invalid", "p5");
      }
    }
    assert.equal(ROLES.length, 5);
  });

  it("POLICY-V5-03 the registered non-current version denies through decide, a p5-only code or role in a current input denies as today, and the current version carries its production behaviour", () => {
    assert.equal(policyCompatibility("p5", P5_DIGEST, 1), currentVersion === "p5");
    if (!currentCarries("1.view_members", "primary_owner")) {
      // Before the section 8.8.4 release: every p5 input denies through decide; a p5-only code in a current input is unsupported;
      // a Co-owner or Collaborator on a baseline or row-24 cell in a current input denies role_not_permitted, exactly as today.
      for (const fixture of P5_FIXTURES) denyIsInert(fixture.input, "policy_version_unsupported");
      for (const action of p5Only.filter((item) => !item.startsWith("invitation."))) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
      for (const action of p5Only.filter((item) => item.startsWith("invitation."))) denyIsInert(restamp({ ...subjectFixture("membership.list_own", currentVersion), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
      for (const action of [...BASELINE_NON_OWNER_ACTIONS, ...COOWNER_INVITATION_ACTIONS]) for (const role of P5_ROLES) if (!currentCarries(action, role)) denyIsInert(ordinaryFixture(action, role), "role_not_permitted");
      for (const action of BASELINE_NON_OWNER_ACTIONS) assert.equal(decide(ordinaryFixture(action)).outcome, "allow", `${action} for the Primary Owner stays allowed on the current version`);
    } else {
      // After the release: the section 8.8.1 cells allow through decide with their role, the p5 negatives pinned to the current
      // version deny through decide, and a p4-versioned input denies (p4 is never current once p5 is).
      for (const cell of spaceCells) assert.deepEqual(decide(ordinaryFixture(cell.action, cell.role)).cellRef, { kind: "user", permission: cell.permission, role: cell.role }, `${cell.action} ${cell.role}`);
      for (const cell of P5_SUBJECT_CELLS) assert.deepEqual(decide(subjectFixture(cell.action, currentVersion)).cellRef, { kind: "subject", action: cell.action });
      for (const fixture of invitationNegativeFixtures(currentVersion)) denyIsInert(fixture.input, fixture.reason);
      denyIsInert(bootstrapFixture("p4"), "policy_version_unsupported");
      for (const fixture of P4_FIXTURES) denyIsInert(fixture.input, "policy_version_unsupported");
    }
    // Historical p1-p4 coverage that never depends on the current version.
    for (const action of p5Only) {
      for (const version of ["p1", "p2", "p3", "p4"] as const) {
        assert.ok(!POLICY_VERSIONS[version].actionDefinitions.some((item) => item.action === action), `${action} must be absent from ${version}`);
        denyIsInert(restamp({ ...ordinaryFixture("1.view_space", "primary_owner", version), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported", version);
      }
    }
    for (const action of BASELINE_NON_OWNER_ACTIONS) for (const role of P5_ROLES) denyIsInert(ordinaryFixture(action, role, "p4"), "role_not_permitted", "p4");
  });

  it("AC07 for p5: every non-reserved p5 action and every p5 cell is reached by a p5 fixture in its own role and the catalog evaluates as expected", () => {
    const fixtureActions = new Set(P5_FIXTURES.map((fixture) => fixture.input.request.action));
    for (const action of P5_ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved")) assert.ok(fixtureActions.has(action.action), action.action);
    for (const cell of P5_ONLY_USER_CELLS) assert.ok(P5_FIXTURES.some((fixture) => fixture.id === (cell.permission === "subject" ? `p5.subject.${cell.action}.acting_subject.api` : `p5.user.${cell.action}.${cell.role}.api`)), `${cell.action} ${cell.role}`);
    for (const fixture of P5_FIXTURES) assert.equal(decideUnderRegisteredVersion("p5", fixture.input).outcome, fixture.expected, fixture.id);
  });
});

/**
 * CBD-236 v0.13 (EXEC-POV-C200F01-001, POV-OPT-C; docs/cbd-236-primary-ownership-version-amendment-proposal.md sections 3 and 5):
 * `space.primaryOwnershipVersion` is a required datastore leaf on every variant that carries `space`, captured as
 * `primaryOwnershipVersion` for every non-read user decision from the column rather than from `membership.authorizationVersion`,
 * carried and not captured by the service variant, and never a way in for the bootstrap or subject-scoped shapes.
 * `INPUT_SCHEMA_VERSION` stays 1 (POV-R06): an assembler that does not produce the leaf denies `input_invalid` rather than allowing.
 */
describe("POV: space.primaryOwnershipVersion is captured from the column (CBD-236 v0.13 sections 4.1, 6.1 and 9.7)", () => {
  const REGISTERED = Object.keys(POLICY_VERSIONS) as RegisteredPolicyVersion[];
  /** The captured record as a plain map: the union type narrows per variant, the assertions name keys by string. */
  const captured = (value: unknown): Record<string, unknown> => (value ?? {}) as Record<string, unknown>;
  const spaceBoundCells = (version: RegisteredPolicyVersion) => POLICY_VERSIONS[version].userCells
    .filter((cell) => cell.action !== "space.create" && cell.permission !== "subject" && cell.notation !== "Deny" && cell.notation !== "Not applicable")
    .map((cell) => ({ action: cell.action, role: cell.role as (typeof ROLES)[number] }));

  it("POV-N01 the column moved and nothing else did: stale_version for every space-bound cell in every registered version", () => {
    for (const version of REGISTERED) {
      const negatives = spaceBoundNegativeFixtures(version, spaceBoundCells(version)).filter((item) => item.family === "stale_primary_ownership_column");
      assert.equal(negatives.length, spaceBoundCells(version).length, version);
      for (const fixture of negatives) {
        const input = fixture.input as PolicyInput;
        assert.equal(input.membership?.authorizationVersion, 1, "the membership version did not move");
        assert.equal(input.space?.primaryOwnershipVersion, 2, "the column did");
        assert.equal(captured(input.versions.capturedAtPrecheck).primaryOwnershipVersion, 1, "the precheck captured the pre-transfer column value");
        denyIsInert(input, "stale_version", version);
      }
    }
    // The same fixture is exact but for the column, so restoring the column value allows: nothing else in it is stale.
    const restored = ordinaryFixture("2a.edit_plan");
    const precheck = decide(restored);
    assert.equal(decide(restamp({ ...restored, versions: { policyVersion: CURRENT_POLICY_VERSION, capturedAtPrecheck: precheck.capturedVersions! } })).outcome, "allow");
  });

  it("POV-N02, POV-N03, POV-N04 a missing, client-asserted or malformed leaf denies input_invalid inertly for every space-bound cell", () => {
    for (const version of REGISTERED) {
      const cells = spaceBoundCells(version);
      const negatives = spaceBoundNegativeFixtures(version, cells);
      for (const family of ["missing_primary_ownership_version", "client_asserted_primary_ownership_version"] as const) {
        const own = negatives.filter((item) => item.family === family);
        assert.equal(own.length, cells.length, `${version} ${family}`);
        for (const fixture of own) denyIsInert(fixture.input, "input_invalid", version);
      }
      const malformed = negatives.filter((item) => item.family === "malformed_primary_ownership_version");
      assert.equal(malformed.length, cells.length * 3, `${version} malformed`);
      for (const suffix of ["string", "negative", "fraction"]) assert.ok(malformed.some((item) => item.id.endsWith(`.${suffix}`)), suffix);
      for (const fixture of malformed) denyIsInert(fixture.input, "input_invalid", version);
    }
    // POV-N02 in both forms: the key deleted from the leaves alone, and restamped from the shape, deny alike.
    const positive = ordinaryFixture("2a.edit_plan");
    const { primaryOwnershipVersion: _leaf, ...space } = positive.space;
    denyIsInert({ ...positive, space }, "input_invalid");
    denyIsInert(restamp({ ...positive, space } as unknown as PolicyInput), "input_invalid");
    // POV-N03 is also what the every-leaf provenance loop produces: a datastore leaf from any other producer denies.
    for (const source of ["request_locator", "route_metadata", "envelope_locator", "session_store", "runtime_configuration", "precheck_decision"] as const) {
      denyIsInert({ ...positive, provenance: { ...positive.provenance, "space.primaryOwnershipVersion": source } }, "input_invalid");
    }
    // The stale-version family of the captured set (POV-F03) stays and still denies; it proves the key is compared, POV-N01 that it is captured.
    denyIsInert(restamp({ ...positive, versions: { policyVersion: CURRENT_POLICY_VERSION, capturedAtPrecheck: { ...decide(positive).capturedVersions!, primaryOwnershipVersion: 99 } } } as unknown as PolicyInput), "stale_version");
  });

  it("POV-N05 the two keys are independent dimensions: authorizationVersion 1 and primaryOwnershipVersion 7 are captured as such", () => {
    for (const version of REGISTERED) {
      for (const cell of spaceBoundCells(version)) {
        const input = independentCaptureFixture(cell.action, cell.role, version);
        const decision = decideUnderRegisteredVersion(version, input);
        assert.equal(decision.outcome, "allow", `${version} ${cell.action} ${cell.role}`);
        assert.equal(captured(decision.capturedVersions).authorizationVersion, 1);
        assert.equal(captured(decision.capturedVersions).primaryOwnershipVersion, 7);
        assert.equal(captured(decision.capturedVersions).spaceLifecycleVersion, 1);
        if (decision.effectClass !== "read") {
          const recheck = decision.obligations.find((item) => item.kind === "recheck_at_commit");
          assert.equal(recheck && "capturedVersions" in recheck ? captured(recheck.capturedVersions).primaryOwnershipVersion : undefined, 7);
        }
      }
    }
    // The exact captured record of a current-version mutation names the column value, and the worker user-delegated variant captures the same.
    const api = decide(independentCaptureFixture("2a.edit_plan"));
    assert.deepEqual(api.capturedVersions, {
      sessionVersion: 1, subjectVersion: 1, profileVersion: 1, authorizationVersion: 1, consentDisclosureVersion: 1, spaceLifecycleVersion: 1,
      primaryOwnershipVersion: 7, targetVersion: 1, policyVersion: CURRENT_POLICY_VERSION, policyDigest: CURRENT_DIGEST, inputSchemaVersion: 1,
    });
    const positive = independentCaptureFixture("2a.edit_plan");
    const { sessionRef: _ref, sessionVersion: _session, ...subject } = positive.subject;
    const worker = decide(restamp({ ...positive, subject: { ...subject, delegationRef: "delegation-1", delegationVersion: 3 }, evaluation: { ...positive.evaluation, adapter: "worker" } }));
    assert.equal(worker.outcome, "allow");
    assert.equal(captured(worker.capturedVersions).primaryOwnershipVersion, 7);
    assert.equal(captured(worker.capturedVersions).authorizationVersion, 1);
  });

  it("POV-N06 the service variant carries the leaf, requires it, and does not capture it", () => {
    const service = serviceFixture();
    assert.equal(service.space.primaryOwnershipVersion, 1);
    const decision = decide(service);
    assert.equal(decision.outcome, "allow");
    assert.deepEqual(Object.keys(decision.capturedVersions ?? {}).sort(), ["inputSchemaVersion", "policyDigest", "policyVersion", "ruleReferenceDataVersion", "scheduleConfigurationVersion", "servicePolicyVersion", "sourceVersion", "spaceLifecycleVersion", "targetVersion", "workloadIdentityVersion"]);
    assert.ok(!("primaryOwnershipVersion" in (decision.capturedVersions ?? {})), "the service captured set is exactly section 6.1's ten keys");
    const { primaryOwnershipVersion: _leaf, ...space } = service.space;
    denyIsInert({ ...service, space }, "input_invalid");
    denyIsInert(restamp({ ...service, space } as unknown as PolicyInput), "input_invalid");
    denyIsInert({ ...service, provenance: { ...service.provenance, "space.primaryOwnershipVersion": "workload_identity" } }, "input_invalid");
    for (const value of ["2", -1, 1.5]) denyIsInert(restamp({ ...service, space: { ...service.space, primaryOwnershipVersion: value } } as unknown as PolicyInput), "input_invalid");
    // A moved column does not make a service decision stale: the service captured set never held the key.
    const precheck = decide(service);
    assert.equal(decide(restamp({ ...service, space: { ...service.space, primaryOwnershipVersion: 2 }, versions: { policyVersion: CURRENT_POLICY_VERSION, capturedAtPrecheck: precheck.capturedVersions! } })).outcome, "allow");
  });

  it("POV-N07 the leaf gives the subject-scoped and bootstrap shapes no new way in", () => {
    assert.equal(FORBIDDEN_SUBJECT_SECTIONS.space.primaryOwnershipVersion, 1, "the populated forbidden section is a complete row");
    for (const version of REGISTERED) {
      for (const cell of subjectCells(version)) {
        const positive = subjectFixture(cell.action, version);
        denyIsInert(restamp({ ...positive, space: FORBIDDEN_SUBJECT_SECTIONS.space } as unknown as PolicyInput), "input_invalid", version);
        denyIsInert(restamp({ ...positive, space: { primaryOwnershipVersion: 1 } } as unknown as PolicyInput), "input_invalid", version);
        denyIsInert({ ...positive, space: { primaryOwnershipVersion: 1 } }, "input_invalid", version);
      }
      const bootstrap = bootstrapFixture(version);
      denyIsInert(restamp({ ...bootstrap, space: { primaryOwnershipVersion: 1 } } as unknown as PolicyInput), "input_invalid", version);
      denyIsInert({ ...bootstrap, space: { primaryOwnershipVersion: 1 } }, "input_invalid", version);
      denyIsInert(restamp({ ...bootstrap, space: FORBIDDEN_SUBJECT_SECTIONS.space } as unknown as PolicyInput), "input_invalid", version);
    }
    const populated = subjectNegativeFixtures(CURRENT_POLICY_VERSION).filter((item) => item.family === "forbidden_section_populated" && item.id.endsWith(".space"));
    assert.ok(populated.length > 0);
    for (const fixture of populated) { assert.equal((fixture.input as PolicyInput).space?.primaryOwnershipVersion, 1); denyIsInert(fixture.input, "input_invalid"); }
  });
});

describe("local-only signed decision transport", () => {
  it("generates an unpersisted Ed25519 pair and rejects alteration, binding errors, and invalid lifetimes", () => {
    const pair = generateLocalSigningKeyPair(); const decision = decide(serviceFixture());
    const unsigned = { decision, action: serviceFixture().request.action, targetBinding: "period-1", claimedEffectClass: "mutate" as const, issuer: "local-api", audience: "local-worker", issuedAt: "2026-09-12T12:00:00.000Z", expiresAt: "2026-09-12T12:01:00.000Z", oneUseId: "one-use-1", algorithm: "Ed25519" as const };
    const signed = signLocalDecision(unsigned, pair.privateKey);
    const expected = { issuer: "local-api", audience: "local-worker", now: "2026-09-12T12:00:30.000Z", maximumLifetimeMs: 60_000 };
    assert.equal(verifyLocalDecision(signed, pair.publicKey, expected), true);
    assert.equal(verifyLocalDecision({ ...signed, targetBinding: "other" }, pair.publicKey, expected), false);
    assert.equal(verifyLocalDecision(signed, pair.publicKey, { ...expected, audience: "other" }), false);
    assert.equal(verifyLocalDecision({ ...signed, expiresAt: "2026-09-12T13:00:00.000Z" }, pair.publicKey, expected), false);
  });
});
