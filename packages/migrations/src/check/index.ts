/**
 * Running every migration rule over a directory.
 *
 * `checkCatalog` is the whole check and takes no filesystem of its own beyond
 * the catalog it is handed, which is what lets the negative fixtures drive the
 * identical code path the real migrations take. A checker with a separate
 * "test mode" proves nothing about the mode that runs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readCatalog } from "../catalog.ts";
import type { Catalog } from "../catalog.ts";
import { loadPolicy, repositoryRoot } from "../policy.ts";
import type { Policy } from "../policy.ts";
import {
  contractStepFindings,
  encodingFindings,
  forbiddenTypeFindings,
  forwardOnlyFindings,
  monetaryFindings,
  namingFindings,
  reversionFileFindings,
  scopeFindings,
  statementFindings,
  typedSqlLayerFindings,
} from "./rules.ts";
import type { Finding } from "./rules.ts";

export type { Finding } from "./rules.ts";

export function checkCatalog(
  catalog: Catalog,
  policy: Policy,
  manifest: { readonly [key: string]: unknown },
): readonly Finding[] {
  const names = catalog.files.map((file) => file.fileName);
  const findings: Finding[] = [
    ...namingFindings(catalog.files, catalog.unparsed, policy),
    ...reversionFileFindings([...names, ...catalog.unparsed], policy),
    ...typedSqlLayerFindings(manifest, [...names, ...catalog.unparsed], policy),
  ];
  for (const file of catalog.files) {
    findings.push(
      ...encodingFindings(file, policy),
      ...forwardOnlyFindings(file, policy),
      ...contractStepFindings(file, policy, names),
      ...forbiddenTypeFindings(file, policy),
      ...monetaryFindings(file, policy),
      ...scopeFindings(file, policy),
      ...statementFindings(file, policy),
    );
  }
  return findings;
}

export function manifestOf(packageRoot: string): { readonly [key: string]: unknown } {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
}

/** Check the repository's own migrations. This is what `npm run migrate:check` runs. */
export function checkRepository(policy: Policy = loadPolicy()): readonly Finding[] {
  const directory = join(repositoryRoot, policy.migrationsDirectory);
  const packageRoot = join(repositoryRoot, "packages", "migrations");
  return checkCatalog(readCatalog(directory, policy), policy, manifestOf(packageRoot));
}

export function checkFixtureDirectory(directory: string, policy: Policy = loadPolicy()): readonly Finding[] {
  return checkCatalog(readCatalog(directory, policy), policy, { name: "fixture" });
}

export function formatFindings(findings: readonly Finding[]): string {
  return findings
    .map((item) => `  ${item.criterion} ${item.rule}: ${item.file}`
      + `${item.line === undefined ? "" : `:${item.line}`} ${item.message}`)
    .join("\n");
}
