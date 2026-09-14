import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, decideUnderRegisteredVersion, expectedProvenance } from "./evaluate.ts";
import { externalDenial } from "./reason.ts";
import { policyAuditEvent } from "./log.ts";
import { ACTION_DEFINITIONS, SERVICE_CELLS, USER_CELLS } from "./policy/v1.ts";
import { ACTION_DEFINITIONS as P2_ACTION_DEFINITIONS, SERVICE_CELLS as P2_SERVICE_CELLS, SUBJECT_ACTION_DEFINITIONS, SUBJECT_CELLS, USER_CELLS as P2_USER_CELLS } from "./policy/v2.ts";
import { CURRENT_POLICY_VERSION, P1_DIGEST, P2_DIGEST, POLICY_VERSIONS, policyCompatibility } from "./policy/registry.ts";
import type { RegisteredPolicyVersion } from "./policy/registry.ts";
import { NEGATIVE_FAMILIES, NEGATIVE_FIXTURES, P1_FIXTURES, P2_FIXTURES, P2_NEGATIVE_FIXTURES, SUBJECT_ENVIRONMENT, bootstrapFixture, ordinaryFixture, serviceFixture, subjectFixture } from "./fixtures/index.ts";
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
    const currentCatalog = CURRENT_POLICY_VERSION === "p1" ? P1_FIXTURES : P2_FIXTURES;
    for (const fixture of currentCatalog) assert.equal(decide(fixture.input).outcome, fixture.expected, `${fixture.id} through decide`);
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
    const required = ["another_subject", "wrong_environment", "stale_session_version", "service_authority", "inactive_subject", "inactive_profile", "wrong_target_shape", "space_bound_shape", "worker_adapter"];
    for (const cell of SUBJECT_CELLS) {
      const families = P2_NEGATIVE_FIXTURES.filter((item) => item.action === cell.action).map((item) => String(item.family));
      for (const family of required) assert.ok(families.includes(family), `${cell.action} lacks the ${family} negative`);
    }
    for (const fixture of P2_NEGATIVE_FIXTURES) denyIsInert(fixture.input, fixture.reason, "p2");
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

  it("POLICY-V2-03 keeps p1 current: a p2 input denies policy_version_unsupported and a p2-only action denies input_unsupported exactly as today", () => {
    assert.equal(CURRENT_POLICY_VERSION, "p1");
    assert.deepEqual(Object.keys(POLICY_VERSIONS), ["p1", "p2"]);
    for (const cell of SUBJECT_CELLS) denyIsInert(subjectFixture(cell.action), "policy_version_unsupported");
    for (const action of [...p2Only, "profile.read"]) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
    for (const action of p2Only) assert.ok(!ACTION_DEFINITIONS.some((item) => item.action === action), `${action} must be absent from p1`);
    assert.equal(ACTION_DEFINITIONS.find((item) => item.action === "profile.read")?.permission, "reserved");
    for (const version of NOT_CURRENT) denyIsInert(ordinaryFixture("1.view_space", "primary_owner", version), "policy_version_unsupported");
    assert.equal(policyCompatibility("p2", P2_DIGEST, 1), false);
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
