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
      "apps/fixture-app/node_modules/hotjar": {},
    },
  }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root", workspaces: ["apps/*"] }));
  await mkdir(join(root, "apps", "fixture-app"), { recursive: true });
  await writeFile(join(root, "apps", "fixture-app", "package.json"), JSON.stringify({ name: "fixture-app", dependencies: { react: "19.0.0" } }));

  const planted = await run({ root, requireBundles: false });
  assert.ok(planted.failures.length > 0, "planted hotjar dependency must fail the check");
  assert.ok(planted.failures.some((f) => f.includes("hotjar")), `expected a hotjar finding, got: ${planted.failures.join(" | ")}`);

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
