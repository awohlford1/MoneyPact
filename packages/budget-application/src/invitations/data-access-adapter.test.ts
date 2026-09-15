/**
 * The data-access adapter's two jobs, without a database: translating a
 * statement failure to the canonical error, and matching a presented bearer
 * against the bound verifier -- by selector lookup for a `<selector>.<secret>`
 * value (`PK5-F02`), by the run-to-completion scan for a pre-selector one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SERIALIZATION_FAILURE_SQLSTATE, dataAccessInvitationLocator, translateStatementFailure } from "./data-access-adapter.ts";
import type { InvitationStatements, LiveCodeBinding } from "./ports.ts";
import { isInvitationError } from "./records.ts";
import { codeVerifierDigest, composeBearer, generateBearer, generateCodeSelector, hasSelectorShape, splitPresentedCode } from "./secrets.ts";
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

void test("PK5-F02: the locator looks a selector-shaped bearer up by selector, proves the secret against the bound verifier, and answers location only", async () => {
  const digest = testDigest();
  const alpha = { budgetSpaceId: "space-a", invitationId: "inv-a", invitationVersion: 1, destinationToken: "token-a" };
  const beta = { budgetSpaceId: "space-b", invitationId: "inv-b", invitationVersion: 1, destinationToken: "token-b" };
  const alphaSelector = generateCodeSelector();
  const betaSelector = generateCodeSelector();
  const alphaSecret = generateBearer();
  const betaSecret = generateBearer();
  const bindings: LiveCodeBinding[] = [
    { ...alpha, codeSelector: alphaSelector, verifierDigest: await codeVerifierDigest(digest, alpha, alphaSecret) },
    { ...beta, codeSelector: betaSelector, verifierDigest: await codeVerifierDigest(digest, beta, betaSecret) },
  ];
  const calls = { selector: [] as string[], legacy: 0, ceremony: [] as string[] };
  const statements = {
    locateCodeBySelector: async (selector: string) => {
      calls.selector.push(selector);
      return bindings.find((binding) => binding.codeSelector === selector) ?? null;
    },
    listLegacyCodes: async () => {
      calls.legacy += 1;
      return [];
    },
    locateCeremony: async (ceremonyId: string) => {
      calls.ceremony.push(ceremonyId);
      return ceremonyId === "cer-1" ? { budget_space_id: "space-a", invitation_id: "inv-a" } : null;
    },
  } as unknown as InvitationStatements;
  const locator = dataAccessInvitationLocator(statements, digest);

  assert.deepEqual(await locator.locateByPresentedCode(composeBearer(alphaSelector, alphaSecret)), { budgetSpaceId: "space-a", invitationId: "inv-a" });
  assert.deepEqual(await locator.locateByPresentedCode(composeBearer(betaSelector, betaSecret)), { budgetSpaceId: "space-b", invitationId: "inv-b" });
  // The selector locates; the secret proves. A known selector with the other
  // record's secret, or with a guessed secret, is nothing.
  assert.equal(await locator.locateByPresentedCode(composeBearer(alphaSelector, betaSecret)), null);
  assert.equal(await locator.locateByPresentedCode(composeBearer(alphaSelector, "guessed")), null);
  // An unknown selector, a malformed selector half and a bare separator are
  // all nothing, and none of them falls back to the scan: only a value
  // without a separator is the pre-selector shape.
  assert.equal(await locator.locateByPresentedCode(composeBearer(generateCodeSelector(), alphaSecret)), null);
  assert.equal(await locator.locateByPresentedCode(`short.${alphaSecret}`), null);
  assert.equal(await locator.locateByPresentedCode(`${alphaSelector}.`), null);
  assert.equal(await locator.locateByPresentedCode(`.${alphaSecret}`), null);
  assert.equal(await locator.locateByPresentedCode(""), null);
  assert.equal(calls.legacy, 0, "a selector-shaped value never reaches the legacy scan");
  // The selector lookup is attempted for every well-formed selector, found or not.
  assert.equal(calls.selector.length, 5);

  // The binding is what makes a digest useless anywhere but its own record:
  // the same secret under another record's binding is a different digest,
  // so a copied verifier column would never match.
  assert.notEqual(await codeVerifierDigest(digest, beta, alphaSecret), bindings[0]?.verifierDigest);
  assert.notEqual(await codeVerifierDigest(digest, { ...alpha, invitationVersion: 2 }, alphaSecret), bindings[0]?.verifierDigest);

  const located = await locator.locateByCeremony("cer-1");
  assert.deepEqual(located, { budgetSpaceId: "space-a", invitationId: "inv-a", ceremonyId: "cer-1" });
  assert.equal(await locator.locateByCeremony("cer-missing"), null);
});

void test("a pre-selector bearer is still answered by the run-to-completion scan over the rows that have no selector", async () => {
  const digest = testDigest();
  const alpha = { budgetSpaceId: "space-a", invitationId: "inv-a", invitationVersion: 1, destinationToken: "token-a" };
  const beta = { budgetSpaceId: "space-b", invitationId: "inv-b", invitationVersion: 1, destinationToken: "token-b" };
  const bearer = "the-raw-legacy-bearer";
  const bindings: LiveCodeBinding[] = [
    { ...alpha, codeSelector: null, verifierDigest: await codeVerifierDigest(digest, alpha, bearer) },
    { ...beta, codeSelector: null, verifierDigest: await codeVerifierDigest(digest, beta, "another-bearer") },
  ];
  let selectorLookups = 0;
  const statements = {
    locateCodeBySelector: async () => {
      selectorLookups += 1;
      return null;
    },
    listLegacyCodes: async () => bindings,
    locateCeremony: async () => null,
  } as unknown as InvitationStatements;
  const locator = dataAccessInvitationLocator(statements, digest);

  assert.deepEqual(await locator.locateByPresentedCode(bearer), { budgetSpaceId: "space-a", invitationId: "inv-a" });
  assert.deepEqual(await locator.locateByPresentedCode("another-bearer"), { budgetSpaceId: "space-b", invitationId: "inv-b" });
  assert.equal(await locator.locateByPresentedCode("nothing-like-it"), null);
  assert.equal(selectorLookups, 0, "a value without a separator never reaches the selector lookup");
});

void test("splitPresentedCode accepts exactly the shape composeBearer produces", () => {
  const selector = generateCodeSelector();
  const secret = generateBearer();
  assert.equal(selector.length, 43);
  assert.deepEqual(splitPresentedCode(composeBearer(selector, secret)), { selector, secret });
  assert.equal(splitPresentedCode(secret), undefined);
  assert.equal(splitPresentedCode(`${selector.slice(1)}.${secret}`), undefined);
  assert.equal(splitPresentedCode(`${selector}.${secret}.extra`), undefined);
  assert.equal(splitPresentedCode(`${selector}.`), undefined);
  assert.ok(hasSelectorShape(`${selector}.${secret}`));
  assert.ok(!hasSelectorShape(secret));
  assert.throws(() => composeBearer("short", secret));
  assert.throws(() => composeBearer(selector, ""));
});
