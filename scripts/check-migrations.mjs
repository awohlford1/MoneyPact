#!/usr/bin/env node
/**
 * The migration check, as a repository-level command.
 *
 * CBD-116-AC05 requires the schema check to run inside `npm run check`, and it
 * already does: the rules are tests in @cobudget/migrations, and
 * `npm run check` runs `npm run test --workspaces`, so every negative fixture
 * is executed on every check and on every CI run. That is the wiring that
 * exists today.
 *
 * This file exists so the check can also be run on its own, without the rest
 * of the workspace test suite, and so that promoting it to a named stage is a
 * one-line change rather than a rewrite. Making it a named stage means editing
 * two shared files -- the `check` script in package.json and
 * REQUIRED_CHECK_STAGES in scripts/check-ci-contract.mjs, which asserts the
 * two agree -- and those are single-writer surfaces that CBD-116 was not
 * scoped to touch. See packages/migrations/README.md.
 *
 *   node scripts/check-migrations.mjs
 */

import { checkRepository, formatFindings } from "../packages/migrations/src/check/index.ts";
import { loadPolicy } from "../packages/migrations/src/policy.ts";

const policy = loadPolicy();
const findings = checkRepository(policy);

if (findings.length === 0) {
  console.log(`Migration check passed: no findings in ${policy.migrationsDirectory}`);
} else {
  console.error(`Migration check failed: ${findings.length} finding(s)`);
  console.error(formatFindings(findings));
  process.exitCode = 1;
}
