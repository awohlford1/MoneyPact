import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { scanDeploymentSource, scanImageEntries } from "./check-container-image.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const repository = join(scripts, "..");
const fixture = (...parts) => join(scripts, "fixtures", "container-image", ...parts);

function run(...args) {
  return spawnSync(process.execPath, [join(scripts, "check-container-image.mjs"), ...args], {
    encoding: "utf8",
  });
}

describe("container image deployment references", () => {
  it("accepts a digest-addressed deployment fixture", () => {
    const path = fixture("digest-reference.yml");
    assert.deepEqual(scanDeploymentSource(readFileSync(path, "utf8"), path), []);
    const result = run("deployment", path);
    assert.equal(result.status, 0, result.stderr);
  });

  it("rejects the mutable-tag fixture", () => {
    const path = fixture("mutable-tag.yml");
    const result = run("deployment", path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /mutable or invalid image reference/);
  });

  it("checks the live repository deployment surfaces", () => {
    const result = run("repository", repository);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /deployment file\(s\) use immutable sha256 digests/);
  });

  it("rejects digest variables and malformed digest lengths", () => {
    for (const source of [
      "image: registry.example.invalid/cobudget@sha256:${DIGEST}",
      "image = registry.example.invalid/cobudget@sha256:1234",
      "deploy --image registry.example.invalid/cobudget:stable",
    ]) {
      assert.equal(scanDeploymentSource(source).length, 1, source);
    }
  });
});

describe("container image workflow", () => {
  const workflow = readFileSync(join(repository, ".github", "workflows", "container-image.yml"), "utf8");

  it("runs on pull requests and protected main with minimal permissions", () => {
    assert.match(workflow, /^\s{2}pull_request:\s*$/m);
    assert.match(workflow, /^\s{2}push:\s*\r?\n\s{4}branches: \[main\]\s*$/m);
    assert.match(workflow, /^permissions:\s*\r?\n\s{2}contents: read\s*$/m);
    assert.doesNotMatch(workflow, /^\s+[a-z-]+: write\s*$/m);
    assert.doesNotMatch(workflow, /\$\{\{\s*(?:secrets\.|github\.token\b)/);
  });

  it("pins every external action to a commit SHA", () => {
    const actions = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
    assert.ok(actions.length > 0);
    for (const action of actions) assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/);
  });

  it("builds, records a sha256 digest, and scans the exported image", () => {
    assert.match(workflow, /docker buildx build --load .*--metadata-file container-metadata\.json/);
    assert.match(workflow, /\^sha256:\[0-9a-f\]\{64\}\$/);
    assert.match(workflow, /docker export --output container-filesystem\.tar/);
    assert.match(workflow, /node scripts\/check-container-image\.mjs image-tar container-filesystem\.tar/);
  });
});

describe("container image content", () => {
  it("accepts ordinary application files", () => {
    assert.deepEqual(scanImageEntries([
      { path: "app/apps/api/dist/main.js", content: "console.log('ready')" },
      { path: "app/node_modules/fastify/package.json", content: "{}" },
    ]), []);
  });

  it("rejects the planted credential and tracker fixture", () => {
    const result = run("fixture", fixture("planted-content.json"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private-key material is forbidden/);
    assert.match(result.stderr, /analytics or tracker package is forbidden/);
  });

  it("rejects sensitive paths and strong credential signatures", () => {
    const findings = scanImageEntries([
      { path: "root/.aws/credentials", content: "not-a-real-credential" },
      { path: "app/config.txt", content: ["postgresql://user", ":password@db.invalid/app"].join("") },
    ]);
    assert.equal(findings.length, 2);
  });
});
