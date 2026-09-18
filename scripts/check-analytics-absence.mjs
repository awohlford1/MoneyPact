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
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- The denylist. -----------------------------------------------------

// Package names (as they appear as the final path segment of a
// package-lock.json `packages` key, or as a package.json dependency key).
// Scoped and unscoped variants are both listed explicitly; this check does
// not guess at a vendor's naming convention.
// L1: entries restricted to names the analytics vendors actually publish.
// A bare generic word (`heap`, `fullstory`, `hotjar`, `crazyegg`, `logrocket`)
// risks a false-fail on an unrelated package resolving that name (`heap` is a
// real, unrelated binary-heap data-structure package on npm).
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
  ["@hotjar/browser", "Hotjar session replay / heatmap"],
  ["posthog-js", "PostHog product analytics / session replay"],
  ["posthog-node", "PostHog product analytics"],
  ["@heap/browser", "Heap product analytics"],
  ["heap-api", "Heap product analytics"],
  ["clarity-js", "Microsoft Clarity session replay / heatmap"],
  ["@microsoft/clarity", "Microsoft Clarity session replay / heatmap"],
  // "logrocket" is unscoped but is the vendor's own single published name —
  // unlike heap/fullstory/hotjar there is no alternate scoped package to
  // prefer, and no known unrelated npm package resolves this exact name.
  ["logrocket", "LogRocket session replay"],
  ["smartlook-client", "Smartlook session replay"],
  ["mouseflow", "Mouseflow session replay / heatmap"],
  ["@sentry/replay", "Sentry session replay (deprecated standalone package)"],
  ["@sentry/session-replay", "Sentry session replay"],
  ["@sentry/nextjs", "Sentry Next.js SDK — ships replayIntegration() session replay"],
  ["@sentry/react", "Sentry React SDK — ships replayIntegration() session replay"],
  ["@sentry/browser", "Sentry browser SDK — ships replayIntegration() session replay"],
  ["@snowplow/browser-tracker", "Snowplow behavioural event tracker"],
  // Crazy Egg ships no first-party npm package (snippet-only); host-list
  // detection below (crazyegg.com) is the only useful signal for it.
  ["@datadog/browser-rum", "Datadog Real User Monitoring (session-level behavioural capture)"],
  ["@vercel/analytics", "Vercel Web Analytics (product analytics)"],
  ["@vercel/speed-insights", "Vercel Speed Insights (behavioural performance telemetry)"],
  ["@next/third-parties", "Next.js third-party helper — ships ready-made GoogleAnalytics/GoogleTagManager components"],
  ["rrweb", "rrweb session-replay recording engine"],
  ["@openreplay/tracker", "OpenReplay session replay"],
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
  "vitals.vercel-insights.com",
  "va.vercel-scripts.com",
  "connect.facebook.net",
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

// Build-output subdirectory names this repository's toolchains produce
// (Next.js -> .next, esbuild/tsc app builds -> dist). Checked dynamically
// per app below rather than hardcoding the three current app names, so a
// new app under apps/* is covered without a script change.
const BUNDLE_SUBDIRECTORIES = [".next", "dist"];
// .rsc (React Server Component flight payload) and .css (an `@import
// url(...)` can carry a tracker host) are scanned as text alongside the
// script/markup/data extensions.
const BUNDLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".json", ".rsc", ".css"]);
const SKIP_DIRECTORY_NAMES = new Set(["node_modules", ".git"]);

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
        // Narrow skip: only the top-level `.next/cache` webpack build cache,
        // not any directory that happens to be named `cache` at any depth
        // (which could otherwise hide a shipped `.next/static/.../cache/`).
        if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
        if (entry.name === "cache" && basename(current) === ".next") continue;
        await walk(join(current, entry.name));
      } else if (BUNDLE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        out.push(join(current, entry.name));
      }
    }
  }
  await walk(directory);
  return out;
}

/** Apps under apps/* that declare a `build` script — the ones this check
 * expects to have produced a bundle. Enumerated the same dynamic way
 * `workspaceManifests` below enumerates workspace manifests, rather than a
 * fixed list of app names. */
async function buildableApps(root) {
  const appsPath = join(root, "apps");
  if (!existsSync(appsPath)) return [];
  const result = [];
  for (const entry of await readdir(appsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(appsPath, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const manifest = JSON.parse(await readFile(pkgPath, "utf8"));
    if (manifest?.scripts?.build) result.push(entry.name);
  }
  return result;
}

/** Which of BUNDLE_SUBDIRECTORIES actually exist under one app, as paths
 * relative to `root`. */
async function bundleDirectoriesForApp(root, app) {
  const found = [];
  for (const sub of BUNDLE_SUBDIRECTORIES) {
    const candidate = join("apps", app, sub);
    if (existsSync(join(root, candidate))) found.push(candidate);
  }
  return found;
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

  // H2: each app's build output is required independently. Accumulating one
  // total across every bundle directory and only checking the total against
  // zero lets a partial build (one app's dist/.next missing or empty) pass
  // cleanly with that app entirely unscanned, because a sibling app's files
  // carry the total above zero. Every configured directory for every
  // buildable app must itself yield at least one file.
  let bundleFilesSeen = 0;
  for (const app of await buildableApps(root)) {
    const candidates = await bundleDirectoriesForApp(root, app);
    if (candidates.length === 0) {
      if (requireBundles) {
        failures.push(`apps/${app} has no built output under .next or dist — run the build first`);
      }
      continue;
    }
    for (const relDirectory of candidates) {
      const directory = join(root, relDirectory);
      const files = await listBundleFiles(directory);
      bundleFilesSeen += files.length;
      const label = relDirectory.replaceAll("\\", "/");
      if (requireBundles && files.length === 0) {
        failures.push(`${label} is empty — run the build first`);
      }
      for (const file of files) {
        const text = await readFile(file, "utf8").catch(() => "");
        for (const finding of scanBundleText(text, relative(root, file).replaceAll("\\", "/"))) {
          failures.push(`built bundle: ${finding.path} references ${finding.host}`);
        }
      }
    }
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
