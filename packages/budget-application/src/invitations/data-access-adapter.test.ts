/**
 * The data-access adapter's two jobs, without a database: translating a
 * statement failure to the canonical error, and matching a presented bearer
 * against the bound verifier without an index to do it with.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SERIALIZATION_FAILURE_SQLSTATE, dataAccessInvitationLocator, translateStatementFailure } from "./data-access-adapter.ts";
import type { InvitationStatements, LiveCodeBinding } from "./ports.ts";
import { isInvitationError } from "./records.ts";
import { codeVerifierDigest } from "./secrets.ts";
import { testDigest } from "./support.ts";

void test("a statement failure becomes the canonical error by SQLSTATE, and anything else is rethrown untouched", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["23514", "constraint_violation"],
    ["23503", "constraint_violation"],
    ["23502", "constraint_violation"],
    [SERIALIZATION_FAILURE_SQLSTATE, "retryable_conflict"],
    ["40P01", "retryable_conflict"],
    ["23505", "conflict"],
  ];
  for (const [sqlState, code] of cases) {
    assert.throws(
      () => translateStatementFailure({ sqlState }),
      (error: unknown) => isInvitationError(error) && error.code === code,
      sqlState,
    );
  }
  const foreign = new Error("something else entirely");
  assert.throws(() => translateStatementFailure(foreign), (error: unknown) => error === foreign);
});

void test("the locator matches the bound verifier and nothing else, and answers location only", async () => {
  const digest = testDigest();
  const alpha = { budgetSpaceId: "space-a", invitationId: "inv-a", invitationVersion: 1, destinationToken: "token-a" };
  const beta = { budgetSpaceId: "space-b", invitationId: "inv-b", invitationVersion: 1, destinationToken: "token-b" };
  const bearer = "the-raw-bearer";
  const bindings: LiveCodeBinding[] = [
    { ...alpha, verifierDigest: await codeVerifierDigest(digest, alpha, bearer) },
    { ...beta, verifierDigest: await codeVerifierDigest(digest, beta, "another-bearer") },
  ];
  const statements = {
    listLiveCodes: async () => bindings,
    locateCeremony: async (ceremonyId: string) =>
      ceremonyId === "cer-1" ? { budget_space_id: "space-a", invitation_id: "inv-a" } : null,
  } as unknown as InvitationStatements;
  const locator = dataAccessInvitationLocator(statements, digest);

  assert.deepEqual(await locator.locateByPresentedCode(bearer), { budgetSpaceId: "space-a", invitationId: "inv-a" });
  assert.deepEqual(await locator.locateByPresentedCode("another-bearer"), { budgetSpaceId: "space-b", invitationId: "inv-b" });
  assert.equal(await locator.locateByPresentedCode("nothing-like-it"), null);

  // The binding is what makes a digest useless anywhere but its own record:
  // the same raw bearer under another record's binding is a different digest,
  // so a copied verifier column would never match.
  assert.notEqual(await codeVerifierDigest(digest, beta, bearer), bindings[0]?.verifierDigest);
  assert.notEqual(await codeVerifierDigest(digest, { ...alpha, invitationVersion: 2 }, bearer), bindings[0]?.verifierDigest);
  assert.equal(await locator.locateByPresentedCode(""), null);

  const located = await locator.locateByCeremony("cer-1");
  assert.deepEqual(located, { budgetSpaceId: "space-a", invitationId: "inv-a", ceremonyId: "cer-1" });
  assert.equal(await locator.locateByCeremony("cer-missing"), null);
});
