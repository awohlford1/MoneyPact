/**
 * The migration policy, loaded from config/migrations.json.
 *
 * Every rule the checker enforces lives in that file rather than in the
 * checker, so the contract can be reviewed without reading the implementation
 * and so each rule carries the approved decision it comes from. This module is
 * the only place that knows the file's shape; it validates on load so a
 * malformed policy fails loudly here rather than as a silently skipped rule
 * somewhere downstream.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type NamedPattern = {
  readonly id: string;
  readonly pattern: string;
  readonly describes?: string;
  readonly instead?: string;
  readonly why: string;
};

export type Policy = {
  readonly version: number;
  readonly migrationsDirectory: string;
  readonly ledgerTable: string;
  readonly advisoryLockKey: number;
  readonly fileName: { readonly pattern: string; readonly ordinalFormat: string; readonly why: string };
  readonly forwardOnly: {
    readonly why: string;
    readonly forbiddenFileSuffixes: readonly string[];
    readonly forbiddenDirectives: readonly string[];
    readonly forbiddenCommands: readonly string[];
    readonly recovery: string;
  };
  readonly statements: { readonly why: string; readonly forbidden: readonly NamedPattern[] };
  readonly contractStep: {
    readonly why: string;
    readonly destructivePatterns: readonly NamedPattern[];
    readonly requiredHeaderKeys: readonly string[];
    readonly contractStepValue: string;
    readonly deployedVersionPattern: string;
  };
  readonly schema: {
    readonly monetary: {
      readonly why: string;
      readonly columnNamePatterns: readonly string[];
      readonly allowedTypes: readonly string[];
      readonly currencyColumnPattern: string;
    };
    readonly forbiddenTypes: readonly NamedPattern[];
    readonly scopeAnnotation: {
      readonly why: string;
      readonly keyword: string;
      readonly allowedValues: readonly string[];
      readonly budgetSpaceValue: string;
      readonly budgetSpaceColumnPattern: string;
    };
  };
  readonly typedSqlLayer: {
    readonly why: string;
    readonly migrationFileExtension: string;
    readonly forbiddenSchemaOwners: readonly string[];
  };
  readonly encoding: {
    readonly why: string;
    readonly requireUtf8: boolean;
    readonly forbidMixedLineEndings: boolean;
    readonly requireTrailingNewline: boolean;
    readonly forbidByteOrderMark: boolean;
  };
  readonly reset: {
    readonly why: string;
    readonly confirmFlag: string;
    readonly localDatabaseNamePattern: string;
  };
};

/** The repository root, four levels up from this file. */
export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export const policyPath = fileURLToPath(new URL("../../../config/migrations.json", import.meta.url));

function fail(message: string): never {
  throw new Error(`config/migrations.json: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringArray(value: unknown, where: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(`${where} must be an array of strings`);
  }
  return value as readonly string[];
}

/**
 * A pattern that does not compile is the most dangerous kind of policy bug: a
 * rule that looks present and matches nothing. Compiling every pattern on load
 * turns it into a startup failure.
 */
function requirePatterns(value: unknown, where: string): readonly NamedPattern[] {
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${where}[${index}] must be an object`);
    const { id, pattern, why } = entry;
    if (typeof id !== "string" || typeof pattern !== "string" || typeof why !== "string") {
      fail(`${where}[${index}] needs a string id, pattern, and why`);
    }
    try {
      new RegExp(pattern, "giu");
    } catch {
      fail(`${where}[${index}] (${id}) is not a valid regular expression`);
    }
    const describes = entry["describes"];
    const instead = entry["instead"];
    return {
      id,
      pattern,
      why,
      ...(typeof describes === "string" ? { describes } : {}),
      ...(typeof instead === "string" ? { instead } : {}),
    };
  });
}

export function parsePolicy(raw: string): Policy {
  const data: unknown = JSON.parse(raw);
  if (!isRecord(data)) fail("must be a JSON object");
  if (data["version"] !== 1) fail("unsupported version; expected 1");

  const contractStep = data["contractStep"];
  const schema = data["schema"];
  const forwardOnly = data["forwardOnly"];
  const typedSqlLayer = data["typedSqlLayer"];
  if (!isRecord(contractStep) || !isRecord(schema) || !isRecord(forwardOnly) || !isRecord(typedSqlLayer)) {
    fail("missing one of contractStep, schema, forwardOnly, typedSqlLayer");
  }
  const monetary = schema["monetary"];
  const scopeAnnotation = schema["scopeAnnotation"];
  if (!isRecord(monetary) || !isRecord(scopeAnnotation)) fail("schema needs monetary and scopeAnnotation");

  // Validated above and shape-checked field by field below; the cast is the
  // boundary between untyped JSON and the typed policy the rest of the tool
  // uses.
  const policy = data as unknown as Policy;

  requirePatterns(contractStep["destructivePatterns"], "contractStep.destructivePatterns");
  const statements = data["statements"];
  if (!isRecord(statements)) fail("missing statements");
  requirePatterns(statements["forbidden"], "statements.forbidden");
  requirePatterns(schema["forbiddenTypes"], "schema.forbiddenTypes");
  requireStringArray(contractStep["requiredHeaderKeys"], "contractStep.requiredHeaderKeys");
  requireStringArray(forwardOnly["forbiddenDirectives"], "forwardOnly.forbiddenDirectives");
  requireStringArray(forwardOnly["forbiddenCommands"], "forwardOnly.forbiddenCommands");
  requireStringArray(forwardOnly["forbiddenFileSuffixes"], "forwardOnly.forbiddenFileSuffixes");
  requireStringArray(typedSqlLayer["forbiddenSchemaOwners"], "typedSqlLayer.forbiddenSchemaOwners");
  requireStringArray(monetary["columnNamePatterns"], "schema.monetary.columnNamePatterns");
  requireStringArray(monetary["allowedTypes"], "schema.monetary.allowedTypes");
  requireStringArray(scopeAnnotation["allowedValues"], "schema.scopeAnnotation.allowedValues");

  for (const [where, pattern] of [
    ["fileName.pattern", policy.fileName?.pattern],
    ["contractStep.deployedVersionPattern", policy.contractStep.deployedVersionPattern],
    ["schema.monetary.currencyColumnPattern", policy.schema.monetary.currencyColumnPattern],
    ["schema.scopeAnnotation.budgetSpaceColumnPattern", policy.schema.scopeAnnotation.budgetSpaceColumnPattern],
    ["reset.localDatabaseNamePattern", policy.reset?.localDatabaseNamePattern],
  ] as const) {
    if (typeof pattern !== "string") fail(`${where} must be a string`);
    try {
      new RegExp(pattern, "u");
    } catch {
      fail(`${where} is not a valid regular expression`);
    }
  }
  for (const source of policy.schema.monetary.columnNamePatterns) {
    try {
      new RegExp(source, "u");
    } catch {
      fail(`schema.monetary.columnNamePatterns contains an invalid regular expression: ${source}`);
    }
  }

  if (!Number.isSafeInteger(policy.advisoryLockKey)) fail("advisoryLockKey must be an integer");
  if (typeof policy.ledgerTable !== "string" || !/^[a-z_][a-z0-9_]*$/.test(policy.ledgerTable)) {
    fail("ledgerTable must be a bare lowercase identifier");
  }
  if (!policy.schema.scopeAnnotation.allowedValues.includes(policy.schema.scopeAnnotation.budgetSpaceValue)) {
    fail("schema.scopeAnnotation.budgetSpaceValue must be one of allowedValues");
  }
  return policy;
}

let cached: Policy | undefined;

export function loadPolicy(): Policy {
  cached ??= parsePolicy(readFileSync(policyPath, "utf8"));
  return cached;
}
