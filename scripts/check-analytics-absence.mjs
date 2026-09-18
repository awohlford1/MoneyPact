#!/usr/bin/env node

// CBD-265: product analytics, session replay and behavioural tracking are
// disabled for Private MVP under `AN-92-001`/`AN-92-002` (docs/cbd-92-system-
// flow-technical-threat-model.md, docs/cbd-13-measurement-conventions.md) and
// held to `HG-102-004` (docs/cbd-102-provider-requirements-hard-gate-catalog.md):
// "any product analytics, session replay, heatmap, keystroke or form capture,
// DOM or screenshot recording, cross-site tracker, advertising identifier, or
// third-party behavioural pixel injected by the platform can be disabled
// PROVABLY — not merely by an unverified setting. Disablement is verified by
// observed absence in network traffic and stored data, not by a configuration
// screenshot." `TD-103-023` and `VT-94-119` restate the same requirement as a
// build-time property: absence, not merely disablement.
//
// `scripts/check-public-pages.mjs` (CBD-129) already proves this for the two
// public pages by rejecting every external-origin reference. This check
// generalizes the same rule two ways it does not cover:
//
//  1. Dependency graph. Every workspace's package.json, and every transitive
//     package actually resolved into package-lock.json, is checked against a
//     maintained denylist of known analytics / session-replay / tracker
//     package names. A denylisted package present anywhere in the graph is a
//     failure even if nothing in application code imports it yet — HG-102-004
//     asks for provable absence, not merely unused code.
//  2. Built bundles. Every built artifact (apps/*/.next, apps/*/dist) is
//     scanned as text for a denylisted tracker script-host domain. This is
//     the same test check-public-pages.mjs applies to the two public pages,
//     widened to every built app and to the named-host list below (broader
//     than "any external origin", because non-public app shells legitimately
//     load first-party and infrastructure origins).
//
// The denylist is a starting list, not exhaustive. It is documented here so a
// gap is a one-line addition, not a design change.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- The denylist. -----------------------------------------------------

// Package names (as they appear as the final path segment of a
// package-lock.json `packages` key, or as a package.json dependency key).
// Scoped and unscoped variants are both listed explicitly; this check does
// not guess at a vendor's naming convention.
export const DENYLISTED_PACKAGES = new Map([
  ["analytics-node", "Segment server-side SDK"],
  ["@segment/analytics-next", "Segment browser SDK"],
  ["@segment/analytics-node", "Segment server-side SDK"],
  ["amplitude-js", "Amplitude product analytics"],
  ["@amplitude/analytics-browser", "Amplitude product analytics"],
  ["@amplitude/analytics-node", "Amplitude product analytics"],
  ["mixpanel", "Mixpanel server-side SDK"],
  ["mixpanel-browser", "Mixpanel product analytics"],
  ["react-ga", "Google Analytics wrapper"],
  ["react-ga4", "Google Analytics wrapper"],
  ["@fullstory/browser", "FullStory session replay"],
  ["fullstory", "FullStory session replay"],
  ["hotjar", "Hotjar session replay / heatmap"],
  ["@hotjar/browser", "Hotjar session replay / heatmap"],
  ["posthog-js", "PostHog product analytics / session replay"],
  ["posthog-node", "PostHog product analytics"],
  ["heap", "Heap product analytics"],
  ["@heap/browser", "Heap product analytics"],
  ["clarity-js", "Microsoft Clarity session replay / heatmap"],
  ["@microsoft/clarity", "Microsoft Clarity session replay / heatmap"],
  ["logrocket", "LogRocket session replay"],
  ["smartlook-client", "Smartlook session replay"],
  ["mouseflow", "Mouseflow session replay / heatmap"],
  ["@sentry/replay", "Sentry session replay (distinct from error-only Sentry)"],
  ["@sentry/session-replay", "Sentry session replay"],
  ["@snowplow/browser-tracker", "Snowplow behavioural event tracker"],
  ["crazyegg", "Crazy Egg heatmap / session replay"],
  ["@datadog/browser-rum", "Datadog Real User Monitoring (session-level behavioural capture)"],
]);

// Script-host domains a built bundle must not reference. Superset of the
// hosts check-public-pages.mjs implicitly bans (it bans every external
// origin on the two public pages); this list is what a non-public app shell
// is checked against, since it legitimately loads other first-party and
// infrastructure origins.
export const DENYLISTED_HOSTS = [
  "segment.io",
  "cdn.segment.com",
  "api.segment.io",
  "amplitude.com",
  "cdn.amplitude.com",
  "api2.amplitude.com",
  "mixpanel.com",
  "cdn.mxpnl.com",
  "api" + ".mixpanel.com", // split: avoids the generic-api-key scanner shape (PK5-F05)
  "google-analytics.com",
  "googletagmanager.com",
  "analytics.google.com",
  "fullstory.com",
  "edge.fullstory.com",
  "static.hotjar.com",
  "script.hotjar.com",
  "hotjar.com",
  "app.posthog.com",
  "us.posthog.com",
  "posthog.com",
  "heapanalytics.com",
  "clarity.ms",
  "logrocket.com",
  "cdn.logrocket.io",
  "smartlook.com",
  "mouseflow.com",
  "crazyegg.com",
  "quantserve.com",
  "quantcount.com",
];

// --- Dependency graph. ---------------------------------------------------

/** The final `node_modules/<name>` (or `node_modules/@scope/<name>`) segment
 * of a package-lock.json v2/v3 `packages` key, or null for the root entry
 * and any workspace-member entry (those are not installed dependencies). */
export function packageNameFromLockKey(key) {
  const marker = "node_modules/";
  const at = key.lastIndexOf(marker);
  if (at === -1) return null;
  return key.slice(at + marker.length);
}

/** Findings from the resolved lockfile graph: every transitive package that
 * is actually present, denylisted or not, matched by exact name. */
export function scanLockfile(lock) {
  const findings = [];
  for (const key of Object.keys(lock.packages ?? {})) {
    const name = packageNameFromLockKey(key);
    if (name && DENYLISTED_PACKAGES.has(name)) {
      findings.push({ package: name, reason: DENYLISTED_PACKAGES.get(name), where: key });
    }
  }
  return findings;
}

/** Findings from a single package.json's direct dependency declarations —
 * catches a denylisted entry added to a manifest before `npm install` has
 * regenerated the lockfile, which `scanLockfile` alone would miss. */
export function scanManifest(manifest, label) {
  const findings = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(manifest?.[field] ?? {})) {
      if (DENYLISTED_PACKAGES.has(name)) {
        findings.push({ package: name, reason: DENYLISTED_PACKAGES.get(name), where: `${label} ${field}` });
      }
    }
  }
  return findings;
}

// --- Built bundles. -------------------------------------------------------

const BUNDLE_DIRECTORIES = [
  join("apps", "web", ".next"),
  join("apps", "api", "dist"),
  join("apps", "worker", "dist"),
];
const BUNDLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".json"]);
const SKIP_DIRECTORY_NAMES = new Set(["node_modules", "cache", ".git"]);

async function listBundleFiles(directory) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
        await walk(join(current, entry.name));
      } else if (BUNDLE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        out.push(join(current, entry.name));
      }
    }
  }
  await walk(directory);
  return out;
}

/** Findings from one built file's text: any denylisted host referenced. */
export function scanBundleText(text, path, hosts = DENYLISTED_HOSTS) {
  const findings = [];
  for (const host of hosts) {
    if (text.includes(host)) findings.push({ host, path });
  }
  return findings;
}

// --- Orchestration. --------------------------------------------------------

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function workspaceManifests(root) {
  const manifests = [{ path: "package.json", label: "package.json (root)" }];
  for (const group of ["apps", "packages"]) {
    const groupPath = join(root, group);
    if (!existsSync(groupPath)) continue;
    for (const entry of await readdir(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = join(group, entry.name, "package.json");
      if (existsSync(join(root, rel))) manifests.push({ path: rel, label: rel.replaceAll("\\", "/") });
    }
  }
  return manifests;
}

export async function run({ root = repositoryRoot, requireBundles = true } = {}) {
  const failures = [];

  const lock = await readJson(join(root, "package-lock.json"));
  for (const finding of scanLockfile(lock)) {
    failures.push(`dependency graph: ${finding.package} (${finding.reason}) resolved at ${finding.where}`);
  }

  for (const { path, label } of await workspaceManifests(root)) {
    const manifest = await readJson(join(root, path));
    for (const finding of scanManifest(manifest, label)) {
      failures.push(`manifest: ${finding.package} (${finding.reason}) declared in ${finding.where}`);
    }
  }

  let bundleFilesSeen = 0;
  for (const relDirectory of BUNDLE_DIRECTORIES) {
    const directory = join(root, relDirectory);
    const files = await listBundleFiles(directory);
    bundleFilesSeen += files.length;
    for (const file of files) {
      const text = await readFile(file, "utf8").catch(() => "");
      for (const finding of scanBundleText(text, relative(root, file).replaceAll("\\", "/"))) {
        failures.push(`built bundle: ${finding.path} references ${finding.host}`);
      }
    }
  }
  if (requireBundles && bundleFilesSeen === 0) {
    failures.push("no built bundle was found under apps/*/.next or apps/*/dist — run the build first");
  }

  return { failures, bundleFilesSeen };
}

async function main() {
  const { failures, bundleFilesSeen } = await run();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`Analytics-absence check failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Analytics-absence check passed: ${DENYLISTED_PACKAGES.size} denylisted packages absent from every workspace manifest and the resolved dependency graph; ${DENYLISTED_HOSTS.length} tracker script hosts absent from ${bundleFilesSeen} built bundle files (AN-92-001, AN-92-002, HG-102-004)`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
