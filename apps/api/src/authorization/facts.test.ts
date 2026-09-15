import assert from "node:assert/strict";
import { test } from "node:test";
import { FactAssembler, FactFailure } from "./facts.ts";
import type { FactLookup, FactSourceAdapter, Operation } from "./facts.ts";

/**
 * SEC-POV-F1 (PROTO-CONTRACTS-POV-SEC-001-RESULT-001; PROTO-API-HARDENING-003).
 * The assembler's `validLeaf` version rule used to accept 0 for every
 * `*Version`/`.version` leaf, symmetrically with the evaluator's
 * `isPositiveInteger` (packages/contracts/src/authorization/evaluate.ts).
 * Every version column in the migrated schema carries `CHECK (... >= 1)`
 * (`packages/migrations`), so a datastore row can never actually present 0 --
 * this closes the shape rule to match that invariant directly, for every
 * version leaf, not only `space.primaryOwnershipVersion`.
 */

const SPACE = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
const SUBJECT = "11111111-1111-4111-8111-111111111111";

const OPERATION: Operation = {
  action: "9.edit_manual_transaction", resourceType: "transaction", resourceId: "44444444-4444-4444-8444-444444444444",
  actingSpaceId: SPACE, actingMembershipId: MEMBERSHIP, purpose: "user_delegated", mode: "user_delegated", fieldSet: "default",
};

/** The full minimal datastore fact set an ordinary (non-bootstrap, non-subject-scoped) `api` decision needs;
 * every path here is exactly one `expectedProvenance` names as `datastore` for this shape (evaluate.ts). */
function datastoreFacts(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    "subject.subjectState": "active", "subject.subjectVersion": 1,
    "profile.profileId": "profile-1", "profile.profileState": "active", "profile.profileVersion": 1,
    "space.spaceId": SPACE, "space.lifecycle": "live", "space.lifecycleVersion": 1,
    "space.primaryOwnerMembershipId": MEMBERSHIP, "space.primaryOwnershipVersion": 1,
    "resource.owningSpaceId": SPACE, "resource.version": 1, "resource.lifecycle": "active",
    "membership.membershipId": MEMBERSHIP, "membership.role": "primary_owner", "membership.status": "active",
    "membership.authorizationVersion": 1,
    "consent.consentId": "consent-1", "consent.disclosureVersion": 1, "consent.state": "current",
    ...overrides,
  };
}

function adapterWith(overrides: Readonly<Record<string, unknown>> = {}): FactSourceAdapter {
  return {
    read: async (source) => {
      if (source === "session_store") return { "subject.accountSubjectId": SUBJECT, "subject.sessionRef": "session-ref-1", "subject.sessionVersion": 1 };
      if (source === "datastore") return datastoreFacts(overrides);
      if (source === "idp_evidence") return { "assurance.level": "session" };
      return null;
    },
  };
}

const lookup = (): FactLookup => ({ credential: "cookie", operation: OPERATION });

void test("SEC-POV-F1: the assembler denies input_invalid before decide when a version leaf reads 0, exactly as it already denies -1", async () => {
  // The unmodified baseline assembles cleanly, so every denial below is caused by the one leaf under test.
  const baseline = await new FactAssembler("api", adapterWith()).assemble(lookup());
  assert.equal(baseline.space?.primaryOwnershipVersion, 1);

  for (const value of [0, -1]) {
    const assembler = new FactAssembler("api", adapterWith({ "space.primaryOwnershipVersion": value }));
    await assert.rejects(
      assembler.assemble(lookup()),
      (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid",
      `space.primaryOwnershipVersion ${value}`,
    );
  }

  // Symmetric across every other version leaf the datastore source carries (SEC-POV-F1 names the rule, not
  // only the one column the amendment happened to introduce): the shape rule is one function for all of them.
  for (const path of ["space.lifecycleVersion", "membership.authorizationVersion", "consent.disclosureVersion", "resource.version", "subject.subjectVersion", "profile.profileVersion"]) {
    const assembler = new FactAssembler("api", adapterWith({ [path]: 0 }));
    await assert.rejects(
      assembler.assemble(lookup()),
      (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid",
      path,
    );
  }
});
