import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { validateCiContract, validateScannerPins } from "./check-ci-contract.mjs";

const checkoutSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNodeSha = "820762786026740c76f36085b0efc47a31fe5020";

const validWorkflow = `name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    name: Documentation, lint, type-check, test, and build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      CI: "true"
      SCARF_ANALYTICS: "false"
    steps:
      - uses: actions/checkout@${checkoutSha} # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - run: python3 scripts/secret_scanner.py ci '\${{ github.event_name }}' '\${{ github.event.pull_request.base.sha }}' '\${{ github.event.pull_request.head.sha }}' '\${{ github.sha }}'
      - uses: actions/setup-node@${setupNodeSha} # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: package-lock.json
      - run: python3 scripts/check-doc-vocabulary.py
      - run: python3 scripts/check-jira-freshness.py --offline
      - run: python3 scripts/check-an92-criteria.py --offline
      - run: python3 scripts/audit-cbd-73.py
      - run: python3 scripts/audit-cbd-74.py
      - run: python3 scripts/audit-cbd-75.py
      - run: python3 scripts/audit-cbd-76.py
      - run: python3 scripts/audit-cbd-82.py
      - run: python3 scripts/audit-cbd-95.py
      - run: python3 scripts/audit-cbd-103.py
      - run: python3 scripts/audit-cbd-104.py
      - run: python3 scripts/audit-cbd-105.py
      - run: python3 scripts/audit-cbd-106.py
      - run: python3 scripts/audit-cbd-107.py
      - run: python3 scripts/audit-cbd-130.py
      - run: python3 scripts/audit-cbd-108.py
      - run: python3 scripts/audit-cbd-77.py
      - run: python3 scripts/audit-cbd-78.py
      - run: python3 scripts/audit-cbd-79.py
      - run: python3 scripts/audit-cbd-80.py
      - run: python3 scripts/check-citations.py
      - run: 'python3 -m pip install --require-hashes --only-binary=:all: -r config/publication-requirements.txt'
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run check
`;

const validDependabot = `version: 2

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

const validRootPackage = {
  workspaces: ["apps/*", "packages/*"],
  engines: { node: ">=24 <25" },
  packageManager: "npm@11.12.1",
  scripts: {
    "check:ci": "node --test scripts/check-ci-contract.test.mjs && node scripts/check-ci-contract.mjs",
    "check:env": "node --test scripts/check-environment.test.mjs && node scripts/check-environment.mjs",
    "check:secrets": "node scripts/check-secrets.mjs",
    "check:publication": "node scripts/check-publication.mjs",
    "check:docs": "node scripts/check-mermaid.mjs",
    "check:tokens": "node scripts/check-tokens.mjs",
    "check:copy": "node scripts/check-copy-language.mjs",
    lint: "eslint scripts && npm run lint --workspaces --if-present",
    typecheck: "npm run typecheck --workspaces --if-present",
    test: "npm run test --workspaces --if-present",
    build: "npm run build --workspaces --if-present",
    "check:pages": "node scripts/check-public-pages.mjs",
    check: "npm run check:ci && npm run check:secrets && npm run check:env && npm run check:publication && npm run check:docs && npm run check:tokens && npm run check:copy && npm run lint && npm run typecheck && npm run test && npm run build && npm run check:pages",
  },
};

const validWorkspaces = [
  { path: "apps/api", manifest: { name: "@cobudget/api", private: true, scripts: { lint: "eslint .", typecheck: "tsc --noEmit", test: "tsx --test", build: "build" } } },
  { path: "apps/web", manifest: { name: "@cobudget/web", private: true, scripts: { lint: "eslint .", typecheck: "tsc --noEmit", build: "next build" } } },
  { path: "packages/domain", manifest: { name: "@cobudget/domain", private: true, scripts: { lint: "eslint .", typecheck: "tsc --noEmit", test: "node --test" } } },
];

function failures(overrides = {}) {
  return validateCiContract({
    workflow: validWorkflow,
    dependabot: validDependabot,
    nodeVersion: "24\n",
    rootPackage: validRootPackage,
    runtimeNodeVersion: "24.15.0",
    workspaces: validWorkspaces,
    ...overrides,
  });
}

function expectFailure(result, fragment) {
  assert.ok(result.some((failure) => failure.includes(fragment)), `expected a failure containing ${JSON.stringify(fragment)}; received ${JSON.stringify(result)}`);
}

describe("CI contract checker", () => {
  it("rejects shallow history, substituted scan ranges, and missing scanner steps", () => {
    expectFailure(failures({ workflow: validWorkflow.replace("fetch-depth: 0", "fetch-depth: 1") }), "complete history");
    expectFailure(failures({ workflow: validWorkflow.replace("          fetch-depth: 0\n", "") }), "full-history checkout");
    expectFailure(failures({ workflow: validWorkflow.replace("github.event.pull_request.base.sha", "github.event.before") }), "reviewed command allowlist");
    expectFailure(failures({ workflow: validWorkflow.replace(/^.*run: python3 scripts\/secret_scanner.py.*\n/m, "") }), "must appear exactly once");
  });

  it("rejects floating scanner versions, changed digests, and detection suppression", () => {
    const pin = readFileSync(new URL("../config/secret-scanner.json", import.meta.url), "utf8");
    const rules = readFileSync(new URL("../config/gitleaks.toml", import.meta.url), "utf8");
    assert.deepEqual(validateScannerPins(pin, rules), []);
    expectFailure(validateScannerPins(pin.replaceAll("8.30.1", "latest"), rules), "immutable release digests");
    expectFailure(validateScannerPins(pin.replace("d29144", "000000"), rules), "immutable release digests");
    expectFailure(validateScannerPins(pin, rules + '\n[allowlist]\npaths = [".*"]\n'), "without broad suppression");
  });

  it("accepts the complete hardened contract", () => {
    assert.deepEqual(failures(), []);
  });

  it("rejects unquoted colon-space in the publication dependency command", () => {
    const command = "python3 -m pip install --require-hashes --only-binary=:all: -r config/publication-requirements.txt";
    expectFailure(failures({ workflow: validWorkflow.replace(`'${command}'`, command) }), "is not in the reviewed command allowlist");
  });

  it("rejects floating external action references", () => {
    expectFailure(failures({ workflow: validWorkflow.replace(`actions/checkout@${checkoutSha}`, "actions/checkout@v4") }), "pinned to a lowercase 40-character commit SHA");
  });

  it("rejects a different full commit for an approved action", () => {
    expectFailure(failures({ workflow: validWorkflow.replace(checkoutSha, "1".repeat(40)) }), "must remain pinned to reviewed commit");
  });

  it("rejects unreviewed actions, commands, and secret expressions", () => {
    const workflow = validWorkflow
      .replace(
        `      - uses: actions/setup-node@${setupNodeSha} # v7.0.0`,
        `      - uses: example/unknown@${setupNodeSha}\n      - run: curl https://example.invalid\n        env:\n          TOKEN: \${{ secrets.DEPLOY_TOKEN }}`,
      );
    const result = failures({ workflow });
    expectFailure(result, "is not in the reviewed action allowlist");
    expectFailure(result, "is not in the reviewed command allowlist");
    expectFailure(result, "secret and GitHub-token expressions are forbidden");
  });

  it("rejects privileged pull-request execution", () => {
    expectFailure(failures({ workflow: validWorkflow.replace("pull_request:", "pull_request_target:") }), "pull_request_target is forbidden");
  });

  it("rejects extra triggers, jobs, and protected-check renames", () => {
    expectFailure(failures({ workflow: validWorkflow.replace("  push:\n", "  workflow_dispatch:\n  push:\n") }), "triggers must remain exactly");
    const extraJob = validWorkflow.replace("  checks:\n", "  bypass:\n    uses: example/unknown/.github/workflows/check.yml@1111111111111111111111111111111111111111\n  checks:\n");
    expectFailure(failures({ workflow: extraJob }), "exactly one job with the stable id checks");
    expectFailure(failures({ workflow: validWorkflow.replace("Documentation, lint, type-check, test, and build", "Renamed check") }), "protected check name");
  });

  it("rejects pull-request filters that can bypass CI", () => {
    const workflow = validWorkflow.replace("  pull_request:\n", "  pull_request:\n    paths-ignore: ['docs/**']\n");
    expectFailure(failures({ workflow }), "every pull request must be checked");
  });

  it("rejects write permissions and retained checkout credentials", () => {
    const workflow = validWorkflow.replace("contents: read", "contents: write").replace("persist-credentials: false", "persist-credentials: true");
    const result = failures({ workflow });
    expectFailure(result, "write permissions are forbidden");
    expectFailure(result, "checkout credential removal");
  });

  it("rejects checkout and setup-node input substitution", () => {
    const checkoutOverride = validWorkflow.replace("          persist-credentials: false", "          persist-credentials: false\n          repository: example/other");
    expectFailure(failures({ workflow: checkoutOverride }), "repository, ref, path, and token overrides are forbidden");

    const setupOverride = validWorkflow.replace("          cache-dependency-path: package-lock.json", "          cache-dependency-path: package-lock.json\n          registry-url: https://example.invalid");
    expectFailure(failures({ workflow: setupOverride }), "only the reviewed Node version and npm cache inputs");
  });

  it("requires install analytics to stay disabled", () => {
    expectFailure(failures({ workflow: validWorkflow.replace('SCARF_ANALYTICS: "false"', 'SCARF_ANALYTICS: "true"') }), "disabled install-analytics flag");
  });

  it("rejects environment and execution-context substitution", () => {
    const extraEnvironment = validWorkflow.replace('      SCARF_ANALYTICS: "false"', '      SCARF_ANALYTICS: "false"\n      NODE_OPTIONS: --import=./bypass.mjs');
    expectFailure(failures({ workflow: extraEnvironment }), "job environment may contain only");
    expectFailure(failures({ workflow: validWorkflow.replace("    steps:", "    container: example.invalid/image:latest\n    steps:") }), "execution-context overrides are forbidden");
  });

  it("requires bounded weekly dependency and Action update proposals", () => {
    const weakenedNpm = validDependabot.replace('package-ecosystem: "npm"', 'package-ecosystem: "pip"');
    expectFailure(failures({ dependabot: weakenedNpm }), "weekly npm and GitHub Actions update policies");
    const weakenedActions = validDependabot.replaceAll('interval: "weekly"', 'interval: "monthly"');
    expectFailure(failures({ dependabot: weakenedActions }), "weekly npm and GitHub Actions update policies");
  });

  it("rejects removal or weakening of the dependency vulnerability gate", () => {
    const workflow = validWorkflow.replace("npm audit --audit-level=high", "npm audit --audit-level=critical");
    expectFailure(failures({ workflow }), "high-severity dependency vulnerability gate");
  });

  it("rejects a second Node version source", () => {
    expectFailure(failures({ workflow: validWorkflow.replace("node-version-file: .nvmrc", "node-version: 24") }), "node-version is forbidden");
  });

  it("rejects fail-open stages", () => {
    const continueOnError = failures({ workflow: validWorkflow.replace("      - run: npm run check", "      - continue-on-error: false\n        run: npm run check") });
    expectFailure(continueOnError, "continue-on-error is forbidden");
    expectFailure(failures({ workflow: validWorkflow.replace("      - run: npm run check", "      - if: false\n        run: npm run check") }), "conditional execution is forbidden");
  });

  it("rejects missing cancellation and lockfile cache binding", () => {
    const workflow = validWorkflow.replace("  cancel-in-progress: true\n", "").replace("          cache-dependency-path: package-lock.json\n", "");
    const result = failures({ workflow });
    expectFailure(result, "superseded-run cancellation");
    expectFailure(result, "explicit npm cache key source");
  });

  it("rejects reordered install and verification commands", () => {
    const workflow = validWorkflow.replace("      - run: npm ci\n      - run: npm audit --audit-level=high", "      - run: npm audit --audit-level=high\n      - run: npm ci");
    expectFailure(failures({ workflow }), "must run in fail-fast order");
  });

  it("rejects drift between .nvmrc and the package engine", () => {
    expectFailure(failures({ nodeVersion: "25", rootPackage: { ...validRootPackage, engines: { node: ">=24 <25" } } }), "must be \">=25 <26\"");
  });

  it("rejects execution under a different Node major", () => {
    expectFailure(failures({ runtimeNodeVersion: "25.0.0" }), "running Node major 25 must match .nvmrc major 24");
  });

  it("rejects a missing or reordered root check stage", () => {
    const rootPackage = structuredClone(validRootPackage);
    rootPackage.scripts.check = rootPackage.scripts.check.replace("npm run typecheck && ", "");
    expectFailure(failures({ rootPackage }), "check must run exactly");
  });

  it("rejects removal of a workspace root", () => {
    expectFailure(failures({ rootPackage: { ...validRootPackage, workspaces: ["apps/*"] } }), "workspaces must remain exactly");
  });

  it("rejects workspaces that --if-present would silently omit", () => {
    const workspaces = structuredClone(validWorkspaces);
    delete workspaces[0].manifest.scripts.test;
    delete workspaces[1].manifest.scripts.build;
    delete workspaces[2].manifest.scripts.lint;
    const result = failures({ workspaces });
    expectFailure(result, "apps/api/package.json must define test");
    expectFailure(result, "apps/web/package.json must define build");
    expectFailure(result, "packages/domain/package.json must define lint");
  });
});
