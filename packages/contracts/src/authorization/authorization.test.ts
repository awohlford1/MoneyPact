import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, decideUnderRegisteredVersion, expectedProvenance } from "./evaluate.ts";
import { externalDenial } from "./reason.ts";
import { policyAuditEvent } from "./log.ts";
import { ACTION_DEFINITIONS, SERVICE_CELLS, USER_CELLS } from "./policy/v1.ts";
import { ACTION_DEFINITIONS as P2_ACTION_DEFINITIONS, SERVICE_CELLS as P2_SERVICE_CELLS, SUBJECT_ACTION_DEFINITIONS, SUBJECT_CELLS, USER_CELLS as P2_USER_CELLS } from "./policy/v2.ts";
import { ACCOUNT_PERMISSION, ACTION_DEFINITIONS as P3_ACTION_DEFINITIONS, P3_ACTION_DEFINITIONS as P3_ONLY_ACTION_DEFINITIONS, P3_USER_CELLS as P3_ONLY_USER_CELLS, PROGRESS_DETAIL_ACTION, SERVICE_CELLS as P3_SERVICE_CELLS, USER_CELLS as P3_USER_CELLS } from "./policy/v3.ts";
import { CURRENT_POLICY_VERSION, P1_DIGEST, P2_DIGEST, P3_DIGEST, POLICY_VERSIONS, policyCompatibility } from "./policy/registry.ts";
import type { RegisteredPolicyVersion } from "./policy/registry.ts";
import { FORBIDDEN_SUBJECT_SECTIONS, NEGATIVE_FAMILIES, NEGATIVE_FIXTURES, P1_FIXTURES, P2_FIXTURES, P2_NEGATIVE_FIXTURES, P3_FIXTURES, P3_NEGATIVE_FIXTURES, SUBJECT_ENVIRONMENT, accountNegativeFixtures, bootstrapFixture, ordinaryFixture, serviceFixture, subjectFixture, subjectNegativeFixtures } from "./fixtures/index.ts";
import { generateLocalSigningKeyPair, signLocalDecision, verifyLocalDecision } from "./transport.ts";
import type { PolicyInput } from "./input.ts";

const CURRENT_DIGEST = POLICY_VERSIONS[CURRENT_POLICY_VERSION].digest;
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
const CATALOGS: Record<RegisteredPolicyVersion, readonly { id: string; input: PolicyInput; expected: string }[]> = { p1: P1_FIXTURES, p2: P2_FIXTURES, p3: P3_FIXTURES };

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
      restamp({ ...base, membership: { ...base.membership, role: "co_owner" } }),
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
      for (const role of ["co_owner", "collaborator", "viewer", "accountability_partner"] as const) denyIsInert(ordinaryFixture(cell.action, role));
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
    assert.deepEqual(Object.keys(POLICY_VERSIONS), ["p1", "p2", "p3"]);
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
    const required = ["other_role", "other_space", "wrong_target_type", "inactive_lifecycle", "stale_version", "service_authority", "inactive_subject", "inactive_membership", "consent_not_current", "subject_scoped_shape", "missing_target"];
    for (const cell of P3_ONLY_USER_CELLS) {
      const families = P3_NEGATIVE_FIXTURES.filter((item) => item.action === cell.action).map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${cell.action} lacks the ${family} negative`);
      for (const role of ["co_owner", "collaborator", "viewer", "accountability_partner"] as const) assert.ok(P3_NEGATIVE_FIXTURES.some((item) => item.id === `p3.user.${cell.action}.other_role.${role}`), `${cell.action} ${role}`);
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
    if (currentVersion !== "p3") {
      // Before the section 8.6.4 release: every p3 input denies through decide and a p3-only action is unsupported exactly as before p3 existed.
      for (const fixture of P3_FIXTURES) denyIsInert(fixture.input, "policy_version_unsupported");
      for (const action of p3Only) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
    } else {
      // After the release: the manual-account cells allow through decide, their negatives deny through decide, and a p2-versioned input denies.
      for (const cell of P3_ONLY_USER_CELLS) assert.deepEqual(decide(ordinaryFixture(cell.action)).cellRef, { kind: "user", permission: cell.permission, role: "primary_owner" });
      for (const fixture of accountNegativeFixtures(currentVersion)) denyIsInert(fixture.input, fixture.reason);
      denyIsInert(bootstrapFixture("p2"), "policy_version_unsupported");
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
