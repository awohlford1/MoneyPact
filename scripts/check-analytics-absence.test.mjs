import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

import {
  DENYLISTED_HOSTS,
  DENYLISTED_PACKAGES,
  packageNameFromLockKey,
  run,
  scanBundleText,
  scanLockfile,
  scanManifest,
} from "./check-analytics-absence.mjs";

// Every fixture in this file lives in an OS temp directory, never inside the
// repository, so a run interrupted mid-test leaves nothing to restore.
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchDirectories = new Set();
async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "cbd265-analytics-"));
  const inside = resolve(directory).startsWith(resolve(REPOSITORY_ROOT) + sep);
  assert.ok(!inside, `scratch space must be outside the repository, got ${directory}`);
  scratchDirectories.add(directory);
  return directory;
}
process.once("exit", () => { for (const d of scratchDirectories) rmSync(d, { recursive: true, force: true }); });

it("packageNameFromLockKey reads the final node_modules segment, scoped or not", () => {
  assert.equal(packageNameFromLockKey("node_modules/mixpanel-browser"), "mixpanel-browser");
  assert.equal(packageNameFromLockKey("node_modules/@sentry/replay"), "@sentry/replay");
  assert.equal(packageNameFromLockKey("apps/web/node_modules/@fullstory/browser"), "@fullstory/browser");
  assert.equal(packageNameFromLockKey(""), null);
  assert.equal(packageNameFromLockKey("apps/web"), null);
});

it("scanLockfile finds a denylisted transitive package and ignores clean ones", () => {
  const clean = { packages: { "": {}, "node_modules/react": {}, "node_modules/next": {} } };
  assert.deepEqual(scanLockfile(clean), []);

  const dirty = { packages: { "": {}, "node_modules/react": {}, "node_modules/mixpanel-browser": {} } };
  const findings = scanLockfile(dirty);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].package, "mixpanel-browser");
});

it("scanManifest catches a denylisted package declared before install", () => {
  const findings = scanManifest({ dependencies: { next: "16.3.4" }, devDependencies: { "posthog-js": "1.0.0" } }, "apps/web/package.json");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].package, "posthog-js");
  assert.match(findings[0].where, /devDependencies/);
});

it("scanBundleText finds a denylisted tracker host and nothing in clean text", () => {
  assert.deepEqual(scanBundleText("console.log('hello')", "chunk.js"), []);
  const findings = scanBundleText("fetch('https://www.google-analytics.com/collect')", "chunk.js");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].host, "google-analytics.com");
});

it("every denylisted package name is unique and every host is a bare domain", () => {
  assert.equal(new Set(DENYLISTED_PACKAGES.keys()).size, DENYLISTED_PACKAGES.size);
  for (const host of DENYLISTED_HOSTS) assert.doesNotMatch(host, /https?:|\/|\s/, `${host} must be a bare domain`);
});

// --- CBD-265-AC02: the planted-fixture negative test. A guard is not
// finished until a deliberate violation has failed it (CLAUDE.md). This
// plants a denylisted package into a throwaway workspace, on disk, run
// through the real `run()` orchestration (not just the pure scan
// functions), proves the check reports it, then the scratch directory is
// discarded — nothing in the repository is touched, so there is nothing to
// restore.
it("CBD-265-AC02: run() fails on a planted denylisted dependency and passes a clean workspace", async () => {
  const root = await scratch();
  await writeFile(join(root, "package-lock.json"), JSON.stringify({
    packages: {
      "": { name: "fixture-root", workspaces: ["apps/*"] },
      "node_modules/react": {},
      "apps/fixture-app/node_modules/logrocket": {},
    },
  }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root", workspaces: ["apps/*"] }));
  await mkdir(join(root, "apps", "fixture-app"), { recursive: true });
  await writeFile(join(root, "apps", "fixture-app", "package.json"), JSON.stringify({ name: "fixture-app", dependencies: { react: "19.0.0" } }));

  const planted = await run({ root, requireBundles: false });
  assert.ok(planted.failures.length > 0, "planted logrocket dependency must fail the check");
  assert.ok(planted.failures.some((f) => f.includes("logrocket")), `expected a logrocket finding, got: ${planted.failures.join(" | ")}`);

  // Restore: remove the planted package from the lockfile fixture and prove
  // the same workspace now passes.
  await writeFile(join(root, "package-lock.json"), JSON.stringify({
    packages: { "": { name: "fixture-root", workspaces: ["apps/*"] }, "node_modules/react": {} },
  }));
  const restored = await run({ root, requireBundles: false });
  assert.deepEqual(restored.failures, []);

  await rm(root, { recursive: true, force: true });
  scratchDirectories.delete(root);
});

it("CBD-265-AC02b: run() fails on a planted tracker host in a built bundle", async () => {
  const root = await scratch();
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: { "": {} } }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root" }));
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "fixture-web", scripts: { build: "next build" } }));
  const bundleDir = join(root, "apps", "web", ".next", "server", "app");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "index.html"), "<script src=\"https://static.hotjar.com/c/hotjar.js\"></script>");

  const planted = await run({ root, requireBundles: false });
  assert.ok(planted.failures.some((f) => f.includes("hotjar.com")), `expected a hotjar.com finding, got: ${planted.failures.join(" | ")}`);

  await writeFile(join(bundleDir, "index.html"), "<script src=\"/static/chunk.js\"></script>");
  const restored = await run({ root, requireBundles: false });
  assert.deepEqual(restored.failures, []);

  await rm(root, { recursive: true, force: true });
  scratchDirectories.delete(root);
});

// H2 regression / L2: a partial build — one buildable app's output directory
// present but empty, another buildable app with no output directory at all —
// must fail independently for each, naming each one, not pass because some
// other app's file count carries the accumulated total above zero.
it("H2/L2: run() with requireBundles true fails independently on an empty bundle directory and a missing one", async () => {
  const root = await scratch();
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: { "": {} } }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root" }));

  // apps/web: declares a build script, has a .next directory, but it is
  // empty (e.g. a build that started and was interrupted).
  await mkdir(join(root, "apps", "web", ".next"), { recursive: true });
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "fixture-web", scripts: { build: "next build" } }));

  // apps/api: declares a build script but has produced no output directory
  // under .next or dist at all.
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await writeFile(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "fixture-api", scripts: { build: "tsc" } }));

  const result = await run({ root, requireBundles: true });
  assert.ok(result.failures.some((f) => f.includes("apps/web/.next") && f.includes("empty")), `expected an empty apps/web/.next finding, got: ${result.failures.join(" | ")}`);
  assert.ok(result.failures.some((f) => f.includes("apps/api") && f.includes("no built output")), `expected a missing apps/api output finding, got: ${result.failures.join(" | ")}`);
  assert.equal(result.bundleFilesSeen, 0);

  // Same fixture with a real file dropped into apps/web/.next passes that
  // half, while apps/api (still missing output) keeps failing independently
  // — proving the two checks are not merged back into one shared total.
  await writeFile(join(root, "apps", "web", ".next", "chunk.js"), "console.log('clean')");
  const partial = await run({ root, requireBundles: true });
  assert.ok(!partial.failures.some((f) => f.includes("apps/web")), `apps/web should now be clean, got: ${partial.failures.join(" | ")}`);
  assert.ok(partial.failures.some((f) => f.includes("apps/api")), `apps/api should still fail, got: ${partial.failures.join(" | ")}`);

  await rm(root, { recursive: true, force: true });
  scratchDirectories.delete(root);
});

// M3: only the top-level `.next/cache` webpack build cache is skipped, not
// any directory named `cache` at any depth.
it("M3: a bundle file under a non-.next `cache` directory is still scanned", async () => {
  const root = await scratch();
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: { "": {} } }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root" }));
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "fixture-web", scripts: { build: "next build" } }));

  // The real webpack cache directory: .next/cache — skipped.
  await mkdir(join(root, "apps", "web", ".next", "cache"), { recursive: true });
  await writeFile(join(root, "apps", "web", ".next", "cache", "webpack.js"), "https://static.hotjar.com/skip-me.js");
  // A different directory that happens to be named `cache`, one level
  // deeper — not the webpack cache, must still be scanned.
  await mkdir(join(root, "apps", "web", ".next", "static", "cache"), { recursive: true });
  await writeFile(join(root, "apps", "web", ".next", "static", "cache", "chunk.js"), "https://static.hotjar.com/dont-skip-me.js");

  const result = await run({ root, requireBundles: false });
  assert.ok(result.failures.some((f) => f.includes("static/cache") || f.includes("static\\cache")), `expected the non-.next cache file to be scanned, got: ${result.failures.join(" | ")}`);
  // Exactly one file is scanned (the deeper static/cache copy); the top-level
  // .next/cache webpack cache is skipped entirely. hotjar.com and
  // static.hotjar.com both legitimately match the same one file's text, so
  // assert on the file count, not the finding count.
  assert.equal(result.bundleFilesSeen, 1, "only the non-.next cache file should have been scanned");
  assert.ok(!result.failures.some((f) => f.includes(".next/cache/webpack") || f.includes(".next\\cache\\webpack")), "the top-level .next/cache webpack file must remain skipped");

  await rm(root, { recursive: true, force: true });
  scratchDirectories.delete(root);
});

// M1: .rsc and .css bundle files are scanned.
it("M1: a tracker host in an .rsc flight payload or a .css @import is caught", async () => {
  const root = await scratch();
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: { "": {} } }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root" }));
  await mkdir(join(root, "apps", "web", ".next"), { recursive: true });
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "fixture-web", scripts: { build: "next build" } }));
  await writeFile(join(root, "apps", "web", ".next", "page.rsc"), "1:\"$Sreact.fragment\"\n2:https://vitals.vercel-insights.com/v1/vitals");
  await writeFile(join(root, "apps", "web", ".next", "globals.css"), "@import url(https://connect.facebook.net/style.css);");

  const result = await run({ root, requireBundles: false });
  assert.ok(result.failures.some((f) => f.includes("vitals.vercel-insights.com")), `expected an .rsc finding, got: ${result.failures.join(" | ")}`);
  assert.ok(result.failures.some((f) => f.includes("connect.facebook.net")), `expected a .css finding, got: ${result.failures.join(" | ")}`);

  await rm(root, { recursive: true, force: true });
  scratchDirectories.delete(root);
});

// H3: the Vercel/Next.js/Sentry/rrweb/OpenReplay additions are present and
// caught, both as packages and as hosts.
it("H3: the newly-added Vercel/Sentry/session-replay entries are denylisted", () => {
  for (const name of ["@vercel/analytics", "@vercel/speed-insights", "@next/third-parties", "rrweb", "@sentry/nextjs", "@sentry/react", "@sentry/browser", "@openreplay/tracker"]) {
    assert.ok(DENYLISTED_PACKAGES.has(name), `expected ${name} to be denylisted`);
  }
  for (const host of ["vitals.vercel-insights.com", "va.vercel-scripts.com", "connect.facebook.net"]) {
    assert.ok(DENYLISTED_HOSTS.includes(host), `expected ${host} to be denylisted`);
  }
});

// L1: heap is only denylisted by its real vendor names, never the bare
// generic package name (a real, unrelated binary-heap data structure).
it("L1: bare generic collision-risk names are not denylisted", () => {
  for (const name of ["heap", "fullstory", "hotjar", "crazyegg"]) {
    assert.ok(!DENYLISTED_PACKAGES.has(name), `${name} must not be a bare denylist entry`);
  }
});
