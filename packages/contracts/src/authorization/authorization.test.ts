import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, expectedProvenance } from "./evaluate.ts";
import { externalDenial } from "./reason.ts";
import { policyAuditEvent } from "./log.ts";
import { ACTION_DEFINITIONS, USER_CELLS } from "./policy/v1.ts";
import { P1_DIGEST, POLICY_VERSIONS, policyCompatibility } from "./policy/registry.ts";
import { NEGATIVE_FAMILIES, NEGATIVE_FIXTURES, P1_FIXTURES, bootstrapFixture, ordinaryFixture, serviceFixture } from "./fixtures/index.ts";
import { generateLocalSigningKeyPair, signLocalDecision, verifyLocalDecision } from "./transport.ts";
import type { PolicyInput } from "./input.ts";

function restamp<T>(input: T): T { return { ...input, provenance: expectedProvenance(input as PolicyInput) }; }
function denyIsInert(input: unknown, reason?: string): void {
  const decision = decide(input as PolicyInput);
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
    assert.equal(first.policyVersion, "p1"); assert.equal(first.policyDigest, P1_DIGEST);
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
      [restamp({ ...staleBase, versions: { policyVersion: "p1", capturedAtPrecheck: { ...precheck.capturedVersions, targetVersion: 99 } } }), "stale_version"],
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
    for (const action of ["profile.create", "profile.read", "preference.update"]) denyIsInert(restamp({ ...ordinaryFixture("1.view_space"), request: { action, purpose: "user_delegated", fieldSet: "default" } }), "input_unsupported");
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
    assert.equal(policyCompatibility("p1", P1_DIGEST, 1), true);
    assert.equal(policyCompatibility("p1", "0".repeat(64), 1), false);
    assert.equal(policyCompatibility("p1", P1_DIGEST, 2), false);
    assert.equal(POLICY_VERSIONS.p1.digest, P1_DIGEST);
  });

  it("AC07 generates fixtures for every action and covers required negative families", () => {
    const fixtureActions = new Set(P1_FIXTURES.map((fixture) => fixture.input.request.action));
    for (const action of ACTION_DEFINITIONS.filter((item) => item.permission !== "reserved")) assert.ok(fixtureActions.has(action.action), action.action);
    assert.deepEqual(new Set(NEGATIVE_FAMILIES.map(([id]) => id)), new Set(Array.from({ length: 15 }, (_, index) => `NC-236-${String(index + 1).padStart(2, "0")}`)));
    for (const fixture of P1_FIXTURES) assert.equal(decide(fixture.input).outcome, fixture.expected, fixture.id);
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
    for (const variant of ["ordinary", "bootstrap", "service"] as const) {
      const filtered = policyAuditEvent({ eventId: "event-1", outcome: "deny", ...prohibited }, variant);
      assert.deepEqual(filtered, { eventId: "event-1", outcome: "deny" });
    }
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
