/**
 * The commands, with no knowledge of argv, the clock, or the console.
 *
 * Everything a command needs arrives in `Deps`, which is what lets the tests
 * drive apply-twice, drift, out-of-order arrival, and a refused reset against
 * a fake executor -- the same code path the real one takes, minus the server.
 *
 * There is deliberately no revert, down, rollback, or undo command, and
 * `commandNames` is asserted against the forbidden list in config so that
 * adding one fails the build rather than a review (CBD-116-AC03, TD-103-028).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { readCatalog } from "./catalog.ts";
import { checkCatalog, formatFindings, manifestOf } from "./check/index.ts";
import type { Executor } from "./executor.ts";
import { buildFileName, formatOrdinal, toSlug } from "./naming.ts";
import { parseAppliedRows, planApply, readAppliedScript } from "./plan.ts";
import type { Policy } from "./policy.ts";

export type Io = { readonly out: (line: string) => void; readonly err: (line: string) => void };

export type Deps = {
  readonly policy: Policy;
  readonly executor: Executor;
  readonly io: Io;
  readonly now: () => Date;
  /** Absolute path to the migrations directory. */
  readonly directory: string;
  /** Absolute path to the package whose manifest the AC06 rule reads. */
  readonly packageRoot: string;
};

export const OK = 0;
export const FAILED = 1;

function reportFindings(deps: Deps): number {
  const catalog = readCatalog(deps.directory, deps.policy);
  const findings = checkCatalog(catalog, deps.policy, manifestOf(deps.packageRoot));
  if (findings.length === 0) {
    deps.io.out(`migration check passed: ${catalog.files.length} migration(s), no findings`);
    return OK;
  }
  deps.io.err(`migration check failed: ${findings.length} finding(s)`);
  deps.io.err(formatFindings(findings));
  return FAILED;
}

export function check(deps: Deps): number {
  return reportFindings(deps);
}

type LedgerRead = { readonly rows: ReturnType<typeof parseAppliedRows> } | { readonly failure: string };

function readLedger(deps: Deps): LedgerRead {
  const result = deps.executor.run(readAppliedScript(deps.policy), "read applied state");
  if (result.status !== 0) return { failure: result.stderr.trim() || `psql exited ${result.status}` };
  try {
    return { rows: parseAppliedRows(result.stdout) };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * CBD-116-AC01 and AC02.
 *
 * The check runs first and a failing check refuses the apply, because a
 * migration the check has not passed is a migration nobody has read the rules
 * against, and applying it is not reversible (TD-103-028).
 */
export function apply(deps: Deps): number {
  if (reportFindings(deps) !== OK) {
    deps.io.err("refusing to apply: fix the findings above first. Nothing was sent to the database.");
    return FAILED;
  }

  const catalog = readCatalog(deps.directory, deps.policy);
  const ledger = readLedger(deps);
  if ("failure" in ledger) {
    deps.io.err(`could not read applied state: ${ledger.failure}`);
    return FAILED;
  }

  const plan = planApply(catalog.files, ledger.rows, deps.policy);
  if (plan.drift.length > 0) {
    deps.io.err(`refusing to apply: ${plan.drift.length} applied migration(s) no longer match the ledger`);
    for (const item of plan.drift) deps.io.err(`  ${item.message}`);
    return FAILED;
  }

  if (plan.pending.length === 0) {
    deps.io.out(`nothing to apply: ${plan.alreadyApplied.length} migration(s) already applied`);
    return OK;
  }

  for (const name of plan.outOfOrder) {
    deps.io.out(`note: ${name} arrives after a later ordinal was already applied; `
      + "the ledger records the order it actually ran in");
  }

  const result = deps.executor.run(plan.script, "apply");
  if (result.status !== 0) {
    deps.io.err(`apply failed; the transaction rolled back and nothing was applied:\n${result.stderr.trim()}`);
    return FAILED;
  }
  for (const file of plan.pending) deps.io.out(`applied ${file.fileName}`);
  deps.io.out(`applied ${plan.pending.length} migration(s)`);
  return OK;
}

export function status(deps: Deps): number {
  const catalog = readCatalog(deps.directory, deps.policy);
  const ledger = readLedger(deps);
  if ("failure" in ledger) {
    deps.io.err(`could not read applied state: ${ledger.failure}`);
    return FAILED;
  }
  const plan = planApply(catalog.files, ledger.rows, deps.policy);
  deps.io.out(`${deps.policy.migrationsDirectory}: ${catalog.files.length} migration(s)`);
  for (const name of plan.alreadyApplied) deps.io.out(`  applied  ${name}`);
  for (const file of plan.pending) deps.io.out(`  pending  ${file.fileName}`);
  for (const item of plan.drift) deps.io.err(`  DRIFT    ${item.message}`);
  for (const name of plan.outOfOrder) deps.io.out(`  note     ${name} is pending behind a later ordinal`);
  return plan.drift.length > 0 ? FAILED : OK;
}

/**
 * Stamp a new migration.
 *
 * If the ordinal for this second is taken -- the realistic way two authors
 * collide is two commands run in the same script -- the clock is advanced by a
 * second rather than the file overwritten. The check would have caught a
 * duplicate anyway; this stops it from ever being created.
 */
export function create(deps: Deps, description: string): number {
  const slug = toSlug(description);
  if (slug === "") {
    deps.io.err('create needs a description, for example: create "add budget space table"');
    return FAILED;
  }
  const catalog = readCatalog(deps.directory, deps.policy);
  const taken = new Set(catalog.files.map((file) => file.ordinal));
  let instant = deps.now();
  while (taken.has(formatOrdinal(instant))) instant = new Date(instant.getTime() + 1000);

  const fileName = buildFileName(instant, slug);
  const path = join(deps.directory, fileName);
  writeFileSync(path, template(deps.policy, description), { encoding: "utf8", flag: "wx" });
  deps.io.out(`created ${fileName}`);
  return OK;
}

function template(policy: Policy, description: string): string {
  const annotation = policy.schema.scopeAnnotation;
  return [
    `-- ${description}`,
    "--",
    "-- Forward-only. There is no down migration: rollback is a code and",
    "-- configuration operation (TD-103-028), and local recovery is",
    `-- ${policy.forwardOnly.recovery}.`,
    "--",
    "-- Every CREATE TABLE needs a scope annotation immediately above it:",
    `--   -- ${annotation.keyword}: ${annotation.allowedValues.join(" | ")}`,
    `-- A ${annotation.budgetSpaceValue} table must carry a budget_space_id column.`,
    "--",
    "-- If this migration removes or renames a table or column, it also needs:",
    "--   -- contract-step: yes",
    "--   -- completes-expand: <ordinal>__<slug>",
    "--   -- last-reader-removed-in: vX.Y.Z",
    "",
    "",
  ].join("\n");
}

/**
 * CBD-116-AC03's recovery path: reset and re-migrate.
 *
 * This is the one destructive command, so it is fenced twice. The operator
 * must pass the confirmation flag, and the database must name itself as a
 * local one -- asked of the server rather than inferred from a variable,
 * because the variable is exactly what is wrong when someone resets the wrong
 * database.
 */
export function reset(deps: Deps, flags: readonly string[]): number {
  if (!flags.includes(deps.policy.reset.confirmFlag)) {
    deps.io.err(`reset drops every table and re-applies every migration. ${deps.policy.reset.why}`);
    deps.io.err(`Re-run with ${deps.policy.reset.confirmFlag} if that is what you want.`);
    return FAILED;
  }

  const probe = deps.executor.run("SELECT current_database();", "identify database");
  if (probe.status !== 0) {
    deps.io.err(`could not identify the database: ${probe.stderr.trim() || `psql exited ${probe.status}`}`);
    return FAILED;
  }
  const name = probe.stdout.trim();
  if (!new RegExp(deps.policy.reset.localDatabaseNamePattern, "u").test(name)) {
    deps.io.err(`refusing to reset "${name}": it does not match `
      + `${deps.policy.reset.localDatabaseNamePattern}, so it is not recognisably a local database.`);
    return FAILED;
  }

  const dropped = deps.executor.run(
    "BEGIN;\nDROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\nCOMMIT;\n",
    "drop schema",
  );
  if (dropped.status !== 0) {
    deps.io.err(`reset failed: ${dropped.stderr.trim()}`);
    return FAILED;
  }
  deps.io.out(`reset ${name}; re-applying every migration`);
  return apply(deps);
}

/**
 * The command table.
 *
 * Exported so a test can assert what is absent. AC03 is not "we did not write
 * a down migration"; it is "no down-migration path exists", and the only way
 * to keep that true is to check it.
 */
export const commandNames = ["apply", "status", "create", "reset", "check"] as const;

export const commandSummaries: Readonly<Record<(typeof commandNames)[number], string>> = {
  apply: "apply every migration that has not been applied; a no-op when there are none",
  status: "list applied and pending migrations",
  create: "stamp a new empty migration",
  reset: "drop every table and re-apply from empty (local recovery only)",
  check: "run the migration check without touching a database",
};

export function usage(policy: Policy): string {
  return [
    "@cobudget/migrations -- forward-only PostgreSQL migrations",
    "",
    "  npm run migrate --workspace=@cobudget/migrations            apply",
    "  npm run migrate:status --workspace=@cobudget/migrations     status",
    '  npm run migrate:create --workspace=@cobudget/migrations -- "add x"',
    "  npm run migrate:check --workspace=@cobudget/migrations      check",
    `  npm run migrate:reset --workspace=@cobudget/migrations -- ${policy.reset.confirmFlag}`,
    "",
    ...commandNames.map((name) => `  ${name.padEnd(8)} ${commandSummaries[name]}`),
    "",
    `There is no revert command. ${policy.forwardOnly.why}`,
    `Local recovery is ${policy.forwardOnly.recovery}.`,
    "",
    "The connection comes from the standard libpq environment (PGHOST, PGDATABASE,",
    "PGUSER, PGPASSWORD, PGSERVICE, ~/.pgpass). This tool never reads it.",
  ].join("\n");
}
