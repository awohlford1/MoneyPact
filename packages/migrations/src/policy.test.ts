import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPolicy, parsePolicy } from "./policy.ts";

test("the shipped policy loads and every pattern in it compiles", () => {
  const policy = loadPolicy();
  assert.equal(policy.version, 1);
  const sources = [
    policy.fileName.pattern,
    policy.contractStep.deployedVersionPattern,
    policy.schema.monetary.currencyColumnPattern,
    policy.schema.scopeAnnotation.budgetSpaceColumnPattern,
    policy.reset.localDatabaseNamePattern,
    ...policy.schema.monetary.columnNamePatterns,
    ...policy.schema.forbiddenTypes.map((rule) => rule.pattern),
    ...policy.contractStep.destructivePatterns.map((rule) => rule.pattern),
    ...policy.statements.forbidden.map((rule) => rule.pattern),
  ];
  for (const source of sources) assert.doesNotThrow(() => new RegExp(source, "giu"), source);
});

test("every rule in the policy carries the decision it comes from", () => {
  const policy = loadPolicy();
  const explained = [
    policy.fileName.why,
    policy.forwardOnly.why,
    policy.statements.why,
    policy.contractStep.why,
    policy.schema.monetary.why,
    policy.schema.scopeAnnotation.why,
    policy.typedSqlLayer.why,
    policy.encoding.why,
    policy.reset.why,
    ...policy.schema.forbiddenTypes.map((rule) => rule.why),
    ...policy.statements.forbidden.map((rule) => rule.why),
  ];
  for (const why of explained) assert.ok(why.length > 40, `a rule with no reason: ${why}`);
});

test("a pattern that does not compile fails at load rather than silently matching nothing", () => {
  const broken = JSON.stringify({
    version: 1,
    migrationsDirectory: "x",
    ledgerTable: "t",
    advisoryLockKey: 1,
    fileName: { pattern: "^(a)(b)$", ordinalFormat: "x", why: "y" },
    forwardOnly: {
      why: "y", forbiddenFileSuffixes: [], forbiddenDirectives: [], forbiddenCommands: [], recovery: "r",
    },
    statements: { why: "y", forbidden: [{ id: "bad", pattern: "([", why: "y" }] },
    contractStep: {
      why: "y", destructivePatterns: [], requiredHeaderKeys: [], contractStepValue: "yes",
      deployedVersionPattern: "^v$",
    },
    schema: {
      monetary: { why: "y", columnNamePatterns: [], allowedTypes: [], currencyColumnPattern: "^c$" },
      forbiddenTypes: [],
      scopeAnnotation: {
        why: "y", keyword: "scope", allowedValues: ["platform"], budgetSpaceValue: "platform",
        budgetSpaceColumnPattern: "^b$",
      },
    },
    typedSqlLayer: { why: "y", migrationFileExtension: ".sql", forbiddenSchemaOwners: [] },
    encoding: {
      why: "y", requireUtf8: true, forbidMixedLineEndings: true, requireTrailingNewline: true,
      forbidByteOrderMark: true,
    },
    reset: { why: "y", confirmFlag: "--go", localDatabaseNamePattern: "^x$" },
  });
  assert.throws(() => parsePolicy(broken), /not a valid regular expression/u);
});

test("a policy whose budget-space value is not one of its own scopes is rejected", () => {
  const raw = JSON.stringify({
    version: 1,
    migrationsDirectory: "x",
    ledgerTable: "t",
    advisoryLockKey: 1,
    fileName: { pattern: "^(a)(b)$", ordinalFormat: "x", why: "y" },
    forwardOnly: {
      why: "y", forbiddenFileSuffixes: [], forbiddenDirectives: [], forbiddenCommands: [], recovery: "r",
    },
    statements: { why: "y", forbidden: [] },
    contractStep: {
      why: "y", destructivePatterns: [], requiredHeaderKeys: [], contractStepValue: "yes",
      deployedVersionPattern: "^v$",
    },
    schema: {
      monetary: { why: "y", columnNamePatterns: [], allowedTypes: [], currencyColumnPattern: "^c$" },
      forbiddenTypes: [],
      scopeAnnotation: {
        why: "y", keyword: "scope", allowedValues: ["platform"], budgetSpaceValue: "budget-space",
        budgetSpaceColumnPattern: "^b$",
      },
    },
    typedSqlLayer: { why: "y", migrationFileExtension: ".sql", forbiddenSchemaOwners: [] },
    encoding: {
      why: "y", requireUtf8: true, forbidMixedLineEndings: true, requireTrailingNewline: true,
      forbidByteOrderMark: true,
    },
    reset: { why: "y", confirmFlag: "--go", localDatabaseNamePattern: "^x$" },
  });
  assert.throws(() => parsePolicy(raw), /budgetSpaceValue/u);
});
