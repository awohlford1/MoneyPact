#!/usr/bin/env node
/**
 * Run locally exactly what CI runs, in the same order.
 *
 * The command list is imported from the CI contract rather than restated here.
 * That is the whole point: a gate that keeps its own copy of the list drifts
 * from CI the moment a check is added, and then passes locally while CI fails.
 * That happened -- `npm run check` covers only the twelve npm stages, the three
 * Python commands in CLAUDE.md cover a fraction of the rest, and neither ran the
 * secret scanner, so a change that tripped it reached CI before anyone saw it.
 *
 * Three commands cannot run verbatim outside a workflow runner. Each is adapted
 * explicitly below rather than silently skipped, and the run prints what it did
 * with each so the difference from CI is visible rather than assumed.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { REQUIRED_WORKFLOW_COMMANDS } from "./check-ci-contract.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// `python3` is the runner's name for it; Windows installs usually expose
// `python`. Resolved once so the adapted commands below are consistent.
const python = ["python3", "python"].find((name) =>
  spawnSync(`${name} --version`, { shell: true }).status === 0);

if (!python) {
  console.error("gate: no python3 or python on PATH");
  process.exit(1);
}

/**
 * How a workflow command becomes a local one.
 *
 * `skip` is for runner environment setup, which the developer's tree already
 * has. `replace` is for a command whose CI form needs GitHub event context that
 * does not exist locally -- the secret scanner's `ci` mode takes the event name
 * and three SHAs from the workflow, and its local equivalent scans the working
 * tree instead. `history` is added on top of `local` because a commit message
 * is scanned too, which `local` alone does not cover.
 */
const ADAPTATIONS = [
  {
    match: (command) => command.startsWith("python3 scripts/secret_scanner.py ci "),
    replace: [
      "python3 scripts/secret_scanner.py local",
      "python3 scripts/secret_scanner.py history",
    ],
    why: "CI mode needs the workflow event and SHAs; local + history cover the working tree and commit messages",
  },
  {
    match: (command) => command.includes("pip install"),
    skip: "runner environment setup; the local tree already has the pinned converter",
  },
  {
    match: (command) => command === "npm ci",
    skip: "runner environment setup; use npm ci yourself when lockfile changes",
  },
  {
    match: (command) => command.startsWith("npm audit"),
    skip: "needs the network and a fresh install; run npm audit --audit-level=high before a release",
    unless: () => process.argv.includes("--audit"),
  },
];

const planned = [];
for (const raw of REQUIRED_WORKFLOW_COMMANDS) {
  // The pip stage is quoted inside the contract list so the workflow can carry
  // it as one shell word. Unwrap it before matching or running.
  const command = raw.replace(/^'(.*)'$/s, "$1");
  const rule = ADAPTATIONS.find((candidate) => candidate.match(command));
  if (rule?.skip && !(rule.unless?.() ?? false)) {
    planned.push({ kind: "skip", command, why: rule.skip });
  } else if (rule?.replace) {
    for (const replacement of rule.replace) {
      planned.push({ kind: "run", command: replacement, from: command, why: rule.why });
    }
  } else {
    planned.push({ kind: "run", command });
  }
}

const runnable = planned.filter((step) => step.kind === "run");
console.log(`gate: ${runnable.length} command(s) from the CI contract, ${python} for python3\n`);

let index = 0;
for (const step of planned) {
  if (step.kind === "skip") {
    console.log(`SKIP  ${step.command}\n      ${step.why}`);
    continue;
  }
  index += 1;
  const command = step.command.replace(/^python3 /, `${python} `);
  if (step.from) console.log(`      (adapted from: ${step.from})\n      ${step.why}`);
  process.stdout.write(`[${index}/${runnable.length}] ${step.command} ... `);
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: repositoryRoot,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`ok (${seconds}s)`);
    continue;
  }
  console.log(`FAILED (${seconds}s)\n`);
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  console.error(`\ngate: failed on ${step.command}`);
  process.exit(1);
}

console.log("\ngate: every CI command passed locally");
