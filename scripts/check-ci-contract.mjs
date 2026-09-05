#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const REQUIRED_CHECK_STAGES = [
  "npm run check:ci",
  "npm run check:secrets",
  "npm run check:env",
  "npm run check:docs",
  "npm run check:tokens",
  "npm run check:copy",
  "npm run lint",
  "npm run typecheck",
  "npm run test",
  "npm run build",
  "npm run check:pages",
];

const REQUIRED_ROOT_SCRIPTS = {
  "check:secrets": "node scripts/check-secrets.mjs",
  "check:env": "node --test scripts/check-environment.test.mjs && node scripts/check-environment.mjs",
  "check:copy": "node scripts/check-copy-language.mjs",
  lint: "eslint scripts && npm run lint --workspaces --if-present",
  typecheck: "npm run typecheck --workspaces --if-present",
  test: "npm run test --workspaces --if-present",
  build: "npm run build --workspaces --if-present",
};

const REQUIRED_WORKSPACE_PATTERNS = ["apps/*", "packages/*"];

const REQUIRED_EXTERNAL_ACTIONS = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
]);

const REQUIRED_WORKFLOW_COMMANDS = [
  "python3 scripts/secret_scanner.py ci '${{ github.event_name }}' '${{ github.event.pull_request.base.sha }}' '${{ github.event.pull_request.head.sha }}' '${{ github.sha }}'",
  "python3 scripts/check-doc-vocabulary.py",
  // --offline only: the freshness check's Jira half needs credentials the
  // runner does not have. The offline half compares pinned source versions
  // against the documents they name and is deterministic.
  "python3 scripts/check-jira-freshness.py --offline",
  "python3 scripts/check-an92-criteria.py --offline",
  "python3 scripts/audit-cbd-73.py",
  "python3 scripts/audit-cbd-74.py",
  "python3 scripts/audit-cbd-75.py",
  "python3 scripts/audit-cbd-76.py",
  "python3 scripts/audit-cbd-82.py",
  "python3 scripts/audit-cbd-95.py",
  "python3 scripts/audit-cbd-103.py",
  "python3 scripts/audit-cbd-104.py",
  "python3 scripts/audit-cbd-105.py",
  "python3 scripts/audit-cbd-106.py",
  "python3 scripts/audit-cbd-107.py",
  "python3 scripts/audit-cbd-130.py",
  "python3 scripts/audit-cbd-108.py",
  "python3 scripts/audit-cbd-77.py",
  "python3 scripts/audit-cbd-78.py",
  "python3 scripts/audit-cbd-79.py",
  "python3 scripts/audit-cbd-80.py",
  "npm ci",
  "npm audit --audit-level=high",
  "npm run check",
];

const REQUIRED_DEPENDABOT_CONFIG = `version: 2

updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
`;

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function requireExactlyOnce(failures, source, pattern, description) {
  const count = countMatches(source, pattern);
  if (count !== 1) failures.push(`${description} must appear exactly once; found ${count}`);
}

function countYamlKey(source, key) {
  return countMatches(source, new RegExp(`^\\s*(?:-\\s*)?${key.replaceAll("-", "\\-")}\\s*:`, "gm"));
}

function requireSingleYamlKey(failures, source, key, description) {
  const count = countYamlKey(source, key);
  if (count !== 1) failures.push(`${description} must be declared exactly once; found ${count}`);
}

function stepBlocks(workflow) {
  const lines = workflow.split("\n");
  const starts = [];
  lines.forEach((line, index) => {
    if (/^\s{6}-\s+/.test(line)) starts.push(index);
  });
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join("\n"));
}

function nestedInputKeys(step) {
  return [...step.matchAll(/^\s{10}([a-z0-9-]+)\s*:/gm)].map((match) => match[1]);
}

function sameItems(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function topLevelBlock(source, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && (!/^\S[^:]*:/.test(lines[end]) || /^\s*(?:#|$)/.test(lines[end]))) end += 1;
  return lines.slice(start + 1, end).join("\n");
}

function checkWorkflow(workflow, failures) {
  const topLevelKeys = [...workflow.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)].map((match) => match[1]);
  if (JSON.stringify(topLevelKeys) !== JSON.stringify(["name", "on", "permissions", "concurrency", "jobs"])) {
    failures.push("the workflow may contain only the reviewed top-level name, triggers, permissions, concurrency, and jobs keys in order");
  }
  requireExactlyOnce(failures, workflow, /^name:\s*CI\s*$/gm, "the workflow name");

  requireExactlyOnce(failures, workflow, /^on:\s*$/gm, "the workflow trigger map");
  requireExactlyOnce(failures, workflow, /^\s{2}pull_request:\s*$/gm, "the pull_request trigger");
  requireExactlyOnce(failures, workflow, /^\s{2}push:\s*$/gm, "the push trigger");
  requireExactlyOnce(failures, workflow, /^\s{4}branches:\s*\[main\]\s*$/gm, "the main push branch filter");
  const triggerKeys = [...topLevelBlock(workflow, "on").matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_-]*):/gm)].map((match) => match[1]);
  if (JSON.stringify(triggerKeys) !== JSON.stringify(["pull_request", "push"])) {
    failures.push("the workflow triggers must remain exactly pull_request and push");
  }

  if (/\bpull_request_target\b/.test(workflow)) {
    failures.push("pull_request_target is forbidden because pull-request code must not receive a privileged context");
  }
  if (/^\s+(?:paths|paths-ignore|branches-ignore|types)\s*:/m.test(workflow)) {
    failures.push("pull-request path, branch, or event filters are forbidden because every pull request must be checked");
  }
  if (/^\s*[a-z-]+:\s*write\s*(?:#.*)?$/m.test(workflow)) {
    failures.push("write permissions are forbidden in the untrusted pull-request check");
  }
  if (/^\s*permissions:\s*write-all\s*$/m.test(workflow)) {
    failures.push("write-all permissions are forbidden in the untrusted pull-request check");
  }
  requireSingleYamlKey(failures, workflow, "permissions", "the workflow permissions map");
  requireExactlyOnce(failures, workflow, /^permissions:\s*\r?\n\s{2}contents:\s*read\s*$/gm, "read-only workflow permissions");

  requireExactlyOnce(failures, workflow, /^concurrency:\s*$/gm, "the workflow concurrency policy");
  requireExactlyOnce(failures, workflow, /^\s{2}group:\s*ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*$/gm, "the per-PR concurrency group");
  requireExactlyOnce(failures, workflow, /^\s{2}cancel-in-progress:\s*true\s*$/gm, "superseded-run cancellation");

  const jobsBlock = topLevelBlock(workflow, "jobs");
  const jobIds = [...jobsBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_-]*):\s*$/gm)].map((match) => match[1]);
  if (JSON.stringify(jobIds) !== JSON.stringify(["checks"])) {
    failures.push("the workflow must contain exactly one job with the stable id checks");
  }
  requireExactlyOnce(failures, workflow, /^\s{4}name:\s*Documentation, lint, type-check, test, and build\s*$/gm, "the protected check name");
  requireExactlyOnce(failures, workflow, /^\s{4}runs-on:\s*ubuntu-latest\s*$/gm, "the Linux runner declaration");
  requireExactlyOnce(failures, workflow, /^\s{4}timeout-minutes:\s*15\s*$/gm, "the bounded job timeout");
  requireSingleYamlKey(failures, workflow, "env", "the workflow environment map");
  requireSingleYamlKey(failures, workflow, "CI", "the CI environment flag");
  requireExactlyOnce(failures, workflow, /^\s{6}CI:\s*["']true["']\s*$/gm, "the deterministic CI environment flag");
  requireSingleYamlKey(failures, workflow, "SCARF_ANALYTICS", "the install-analytics opt-out");
  requireExactlyOnce(failures, workflow, /^\s{6}SCARF_ANALYTICS:\s*["']false["']\s*$/gm, "the disabled install-analytics flag");
  const environmentKeys = [...workflow.matchAll(/^\s{6}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((match) => match[1]);
  if (!sameItems(environmentKeys, ["CI", "SCARF_ANALYTICS"])) {
    failures.push("the job environment may contain only CI and SCARF_ANALYTICS");
  }

  const steps = stepBlocks(workflow);
  const usesLines = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(?:\s+#.*)?$/gm)];
  if (usesLines.length === 0) failures.push("the workflow must declare its actions explicitly");
  for (const match of usesLines) {
    const action = match[1];
    if (!/^[^@\s]+@[0-9a-f]{40}$/.test(action)) {
      failures.push(`external action ${action} must be pinned to a lowercase 40-character commit SHA`);
      continue;
    }
    const identity = action.slice(0, action.lastIndexOf("@"));
    const commit = action.slice(action.lastIndexOf("@") + 1);
    const requiredCommit = REQUIRED_EXTERNAL_ACTIONS.get(identity);
    if (!requiredCommit) {
      failures.push(`external action ${identity} is not in the reviewed action allowlist`);
    } else if (commit !== requiredCommit) {
      failures.push(`external action ${identity} must remain pinned to reviewed commit ${requiredCommit}`);
    }
  }
  for (const [identity, commit] of REQUIRED_EXTERNAL_ACTIONS) {
    requireExactlyOnce(failures, workflow, new RegExp(`^\\s*(?:-\\s*)?uses:\\s*${identity.replace("/", "\\/")}@${commit}(?:\\s+#.*)?$`, "gm"), `the reviewed ${identity} action`);
  }
  requireSingleYamlKey(failures, workflow, "persist-credentials", "the checkout credential policy");
  requireExactlyOnce(failures, workflow, /^\s{10}persist-credentials:\s*false\s*$/gm, "checkout credential removal");
  const checkoutStep = steps.find((step) => /uses:\s*actions\/checkout@/.test(step));
  if (checkoutStep && !/^\s{10}persist-credentials:\s*false\s*$/m.test(checkoutStep)) {
    failures.push("persist-credentials: false must belong to the checkout step");
  }
  requireSingleYamlKey(failures, workflow, "fetch-depth", "full-history checkout");
  if (checkoutStep && !/^\s{10}fetch-depth:\s*0\s*$/m.test(checkoutStep)) {
    failures.push("checkout must fetch complete history with fetch-depth: 0");
  }
  if (checkoutStep && !sameItems(nestedInputKeys(checkoutStep), ["persist-credentials", "fetch-depth"])) {
    failures.push("the checkout step may set only credential removal and full history; repository, ref, path, and token overrides are forbidden");
  }

  requireSingleYamlKey(failures, workflow, "node-version-file", "the Node version file setting");
  requireExactlyOnce(failures, workflow, /^\s{10}node-version-file:\s*\.nvmrc\s*$/gm, "the .nvmrc Node source");
  if (/^\s+node-version\s*:/m.test(workflow)) {
    failures.push("node-version is forbidden; .nvmrc is the single CI Node version source");
  }
  requireSingleYamlKey(failures, workflow, "cache", "the Node dependency cache setting");
  requireExactlyOnce(failures, workflow, /^\s{10}cache:\s*npm\s*$/gm, "the npm dependency cache");
  requireSingleYamlKey(failures, workflow, "cache-dependency-path", "the npm cache key source setting");
  requireExactlyOnce(failures, workflow, /^\s{10}cache-dependency-path:\s*package-lock\.json\s*$/gm, "the explicit npm cache key source");
  const setupNodeStep = steps.find((step) => /uses:\s*actions\/setup-node@/.test(step));
  if (setupNodeStep && !/^\s{10}node-version-file:\s*\.nvmrc\s*$/m.test(setupNodeStep)) {
    failures.push("node-version-file: .nvmrc must belong to the setup-node step");
  }
  if (setupNodeStep && !/^\s{10}cache:\s*npm\s*$/m.test(setupNodeStep)) {
    failures.push("cache: npm must belong to the setup-node step");
  }
  if (setupNodeStep && !/^\s{10}cache-dependency-path:\s*package-lock\.json\s*$/m.test(setupNodeStep)) {
    failures.push("cache-dependency-path: package-lock.json must belong to the setup-node step");
  }
  if (setupNodeStep && !sameItems(nestedInputKeys(setupNodeStep), ["node-version-file", "cache", "cache-dependency-path"])) {
    failures.push("the setup-node step may set only the reviewed Node version and npm cache inputs");
  }

  if (/^\s*(?:-\s*)?continue-on-error\s*:/m.test(workflow)) {
    failures.push("continue-on-error is forbidden because its value can make a check fail open");
  }
  if (/^\s*(?:-\s*)?if\s*:/m.test(workflow)) {
    failures.push("conditional execution is forbidden because every pull request must run every declared check");
  }
  if (/^\s*(?:container|services|defaults|strategy|environment|working-directory|shell)\s*:/m.test(workflow)) {
    failures.push("unreviewed execution-context overrides are forbidden in the pull-request workflow");
  }
  if (/\$\{\{\s*(?:secrets\.|github\.token\b)/.test(workflow)) {
    failures.push("secret and GitHub-token expressions are forbidden in the untrusted pull-request workflow");
  }

  const runCommands = [...workflow.matchAll(/^\s*(?:-\s*)?run:\s*(.*?)\s*$/gm)].map((match) => match[1]);
  for (const command of runCommands) {
    if (!REQUIRED_WORKFLOW_COMMANDS.includes(command)) {
      failures.push(`workflow command ${JSON.stringify(command)} is not in the reviewed command allowlist`);
    }
  }
  for (const command of REQUIRED_WORKFLOW_COMMANDS) {
    const count = runCommands.filter((candidate) => candidate === command).length;
    if (count !== 1) failures.push(`workflow command ${JSON.stringify(command)} must appear exactly once; found ${count}`);
  }
  if (JSON.stringify(runCommands) !== JSON.stringify(REQUIRED_WORKFLOW_COMMANDS)) {
    failures.push("workflow commands must remain in the reviewed fail-fast order");
  }
  requireExactlyOnce(failures, workflow, /^\s*(?:-\s*)?run:\s*npm ci\s*$/gm, "the clean dependency installation");
  requireExactlyOnce(failures, workflow, /^\s*(?:-\s*)?run:\s*npm audit --audit-level=high\s*$/gm, "the high-severity dependency vulnerability gate");
  requireExactlyOnce(failures, workflow, /^\s*(?:-\s*)?run:\s*npm run check\s*$/gm, "the complete repository check");

  const installAt = workflow.search(/^\s*(?:-\s*)?run:\s*npm ci\s*$/m);
  const auditAt = workflow.search(/^\s*(?:-\s*)?run:\s*npm audit --audit-level=high\s*$/m);
  const checkAt = workflow.search(/^\s*(?:-\s*)?run:\s*npm run check\s*$/m);
  if (installAt >= 0 && auditAt >= 0 && checkAt >= 0 && !(installAt < auditAt && auditAt < checkAt)) {
    failures.push("npm ci, the vulnerability audit, and npm run check must run in fail-fast order");
  }
}

function checkActionUpdates(dependabot, failures) {
  if (dependabot.replaceAll("\r\n", "\n") !== REQUIRED_DEPENDABOT_CONFIG) {
    failures.push(".github/dependabot.yml must retain the reviewed weekly npm and GitHub Actions update policies");
  }
}

function checkToolchain(nodeVersion, rootPackage, runtimeNodeVersion, failures) {
  const version = nodeVersion.trim();
  const match = version.match(/^(\d+)(?:\.\d+\.\d+)?$/);
  if (!match) {
    failures.push(".nvmrc must contain one Node major or one exact semantic version");
    return;
  }

  const major = Number(match[1]);
  const expectedEngine = `>=${major} <${major + 1}`;
  if (rootPackage.engines?.node !== expectedEngine) {
    failures.push(`package.json engines.node must be ${JSON.stringify(expectedEngine)} to agree with .nvmrc`);
  }
  const runtimeMajor = Number(runtimeNodeVersion.split(".")[0]);
  if (runtimeMajor !== major) {
    failures.push(`the running Node major ${runtimeMajor} must match .nvmrc major ${major}`);
  }
  if (!/^npm@\d+\.\d+\.\d+$/.test(rootPackage.packageManager ?? "")) {
    failures.push("package.json packageManager must pin npm to an exact semantic version");
  }
}

function checkRootScripts(rootPackage, failures) {
  const scripts = rootPackage.scripts ?? {};
  if (JSON.stringify(rootPackage.workspaces) !== JSON.stringify(REQUIRED_WORKSPACE_PATTERNS)) {
    failures.push(`package.json workspaces must remain exactly ${JSON.stringify(REQUIRED_WORKSPACE_PATTERNS)}`);
  }
  const stages = (scripts.check ?? "").split("&&").map((stage) => stage.trim()).filter(Boolean);
  if (JSON.stringify(stages) !== JSON.stringify(REQUIRED_CHECK_STAGES)) {
    failures.push(`package.json check must run exactly: ${REQUIRED_CHECK_STAGES.join(" && ")}`);
  }

  for (const [name, expected] of Object.entries(REQUIRED_ROOT_SCRIPTS)) {
    if (scripts[name] !== expected) {
      failures.push(`package.json ${name} must remain ${JSON.stringify(expected)}`);
    }
  }
  if (scripts["check:ci"] !== "node --test scripts/check-ci-contract.test.mjs && node scripts/check-ci-contract.mjs") {
    failures.push("package.json check:ci must run the contract self-tests before checking the live repository");
  }
}

function checkWorkspaces(workspaces, failures) {
  const names = new Map();

  if (workspaces.length === 0) failures.push("at least one workspace must participate in the CI contract");

  for (const workspace of workspaces) {
    const { path, manifest } = workspace;
    const label = path.replaceAll("\\", "/");
    if (!manifest.name) failures.push(`${label}/package.json must declare a package name`);
    if (manifest.name && names.has(manifest.name)) {
      failures.push(`${label}/package.json duplicates package name ${manifest.name} from ${names.get(manifest.name)}`);
    } else if (manifest.name) {
      names.set(manifest.name, label);
    }
    if (manifest.private !== true) failures.push(`${label}/package.json must remain private`);

    const scripts = manifest.scripts ?? {};
    for (const stage of ["lint", "typecheck"]) {
      if (!scripts[stage]) failures.push(`${label}/package.json must define ${stage}; --if-present must not hide its absence`);
    }
    if (!scripts.test && label !== "apps/web") {
      failures.push(`${label}/package.json must define test; --if-present must not hide its absence`);
    }
    if (label.startsWith("apps/") && !scripts.build) {
      failures.push(`${label}/package.json must define build; --if-present must not hide its absence`);
    }
  }
}

export function validateCiContract({ workflow, dependabot, nodeVersion, rootPackage, runtimeNodeVersion, workspaces }) {
  const failures = [];
  checkWorkflow(workflow.replaceAll("\r\n", "\n"), failures);
  checkActionUpdates(dependabot, failures);
  checkToolchain(nodeVersion, rootPackage, runtimeNodeVersion, failures);
  checkRootScripts(rootPackage, failures);
  checkWorkspaces(workspaces, failures);
  return failures;
}

export function validateScannerPins(pin, rules) {
  const hash = (source) => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
  const failures = [];
  if (hash(pin) !== "bbfb84371e1fa8a33632632758e133b8d498e6d50844a98186e33a37ba7f1132") {
    failures.push("secret scanner must retain its reviewed immutable release digests");
  }
  if (hash(rules) !== "dc6f27cd2be8a8d9960c92e2a81abb659be0409e5ea66918d321a3234f49c1be") {
    failures.push("secret detection must retain its reviewed rules without broad suppression");
  }
  return failures;
}

async function loadWorkspaces(rootPackage) {
  const workspaces = [];
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`Unsupported workspace pattern ${JSON.stringify(pattern)}; use one-level directory/* patterns`);
    }
    const parent = join(repositoryRoot, pattern.slice(0, -2));
    const entries = await readdir(parent, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(parent, entry.name);
      const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
      workspaces.push({ path: relative(repositoryRoot, path), manifest });
    }
  }
  return workspaces.sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const failures = validateCiContract({
    workflow: await readFile(join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8"),
    dependabot: await readFile(join(repositoryRoot, ".github", "dependabot.yml"), "utf8"),
    nodeVersion: await readFile(join(repositoryRoot, ".nvmrc"), "utf8"),
    rootPackage,
    runtimeNodeVersion: process.versions.node,
    workspaces: await loadWorkspaces(rootPackage),
  });
  failures.push(...validateScannerPins(
    await readFile(join(repositoryRoot, "config/secret-scanner.json"), "utf8"),
    await readFile(join(repositoryRoot, "config/gitleaks.toml"), "utf8"),
  ));

  if (failures.length > 0) {
    for (const failure of failures) console.error(`CI contract check failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("CI contract check passed: least privilege, immutable actions, bounded concurrency, one Node source, fail-closed stages, and complete workspace participation");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
