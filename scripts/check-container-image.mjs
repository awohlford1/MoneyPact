#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIGEST_REFERENCE = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const DEPLOYMENT_KEY = /^(?:container[_-]?image|image|image[_-]?ref)$/i;
const TRACKER_PACKAGE = /(?:^|\/)node_modules\/(?:@amplitude\/analytics-node|@scarf\/scarf|@segment\/analytics-node|analytics-node|dd-trace|mixpanel|newrelic|posthog-node|sentry|@sentry\/[^/]+)(?:\/|$)/i;
const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials)(?:\/|$)/i;
const SENSITIVE_DIRECTORY = /(?:^|\/)(?:\.aws|\.config\/gcloud|\.ssh)(?:\/|$)/i;
const CREDENTIAL_SIGNATURES = [
  ["private-key material", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub access token", /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/],
  ["credential-bearing PostgreSQL URL", /\bpostgres(?:ql)?:\/\/[^\s/:@]+:[^\s/@]+@/i],
];
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function cleanReference(value) {
  return value.trim().replace(/[,;]$/, "").replace(/^['"]|['"]$/g, "");
}

export function scanDeploymentSource(source, path = "input") {
  const failures = [];
  for (const [index, originalLine] of source.split(/\r?\n/).entries()) {
    const line = originalLine.replace(/\s+#.*$/, "");
    const candidates = [];
    const dockerBase = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line);
    if (dockerBase) candidates.push(dockerBase[1]);

    const assignment = /^\s*["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*[:=]\s*(.+?)\s*$/.exec(line);
    if (assignment && DEPLOYMENT_KEY.test(assignment[1])) candidates.push(assignment[2]);

    for (const match of line.matchAll(/--image(?:=|\s+)([^\s]+)/g)) candidates.push(match[1]);

    for (const candidate of candidates) {
      const reference = cleanReference(candidate);
      if (!DIGEST_REFERENCE.test(reference)) {
        failures.push(`${path}:${index + 1}: mutable or invalid image reference ${JSON.stringify(reference)}; require name@sha256:<64 lowercase hex characters>`);
      }
    }
  }
  return failures;
}

function normalizedEntryPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function scanEntry(path, content) {
  const normalized = normalizedEntryPath(path);
  const findings = [];
  if (TRACKER_PACKAGE.test(normalized)) findings.push(`${normalized}: analytics or tracker package is forbidden`);
  if (SENSITIVE_PATH.test(normalized) || SENSITIVE_DIRECTORY.test(normalized)) {
    findings.push(`${normalized}: credential-bearing path is forbidden`);
  }
  if (content.length <= 2 * 1024 * 1024 && !content.includes(0)) {
    const text = content.toString("utf8");
    for (const [description, pattern] of CREDENTIAL_SIGNATURES) {
      if (pattern.test(text)) findings.push(`${normalized}: ${description} is forbidden`);
    }
  }
  return findings;
}

export function scanImageEntries(entries) {
  return entries.flatMap((entry) => scanEntry(entry.path, Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? "")));
}

function tarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "");
}

export function entriesFromTar(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const sizeText = tarString(header, 124, 12).trim();
    const size = sizeText === "" ? 0 : Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid tar size for ${name || "unnamed entry"}`);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > buffer.length) throw new Error(`truncated tar entry ${name || "unnamed entry"}`);
    const path = prefix ? `${prefix}/${name}` : name;
    entries.push({ path, content: buffer.subarray(contentStart, contentEnd) });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function entriesFromDirectory(root) {
  const entries = [];
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.isFile()) entries.push({ path: relative(root, path), content: readFileSync(path) });
    }
  }
  walk(root);
  return entries;
}

function entriesFromFixture(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(fixture.entries)) throw new Error("fixture must contain an entries array");
  return fixture.entries.map((entry) => ({
    path: entry.path,
    content: Array.isArray(entry.content_chunks) ? entry.content_chunks.join("") : (entry.content ?? ""),
  }));
}

function deploymentFiles(root) {
  const paths = [];
  for (const name of ["Dockerfile", "Containerfile"]) {
    const path = join(root, name);
    if (existsSync(path)) paths.push(path);
  }
  for (const directoryName of [".github/workflows", "deploy", "deployment", "infra", "k8s", "terraform"]) {
    const directory = join(root, directoryName);
    if (!existsSync(directory)) continue;
    const walk = (folder) => {
      for (const item of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, item.name);
        if (item.isDirectory()) walk(path);
        else if (item.isFile() && /(?:Dockerfile|Containerfile|\.(?:json|ya?ml|tf))$/i.test(item.name)) paths.push(path);
      }
    };
    walk(directory);
  }
  return [...new Set(paths)];
}

function report(failures, success) {
  if (failures.length > 0) {
    for (const failure of failures) console.error(`Container image check failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(success);
}

function main(args) {
  const [command, ...paths] = args;
  if (command === "deployment" && paths.length > 0) {
    const failures = paths.flatMap((path) => scanDeploymentSource(readFileSync(path, "utf8"), path));
    report(failures, `Container image reference check passed: ${paths.length} file(s) use immutable sha256 digests`);
    return;
  }
  if (command === "repository" && paths.length <= 1) {
    const root = paths[0] ?? repositoryRoot;
    const files = deploymentFiles(root);
    const failures = files.flatMap((path) => scanDeploymentSource(readFileSync(path, "utf8"), relative(root, path)));
    report(failures, `Container image reference check passed: ${files.length} deployment file(s) use immutable sha256 digests`);
    return;
  }
  if (command === "image-tar" && paths.length === 1) {
    const entries = entriesFromTar(readFileSync(paths[0]));
    report(scanImageEntries(entries), `Container image content check passed: ${entries.length} filesystem entries contain no credential material or analytics/tracker packages`);
    return;
  }
  if (command === "image-root" && paths.length === 1 && statSync(paths[0]).isDirectory()) {
    const entries = entriesFromDirectory(paths[0]);
    report(scanImageEntries(entries), `Container image content check passed: ${entries.length} filesystem entries contain no credential material or analytics/tracker packages`);
    return;
  }
  if (command === "fixture" && paths.length === 1) {
    const entries = entriesFromFixture(paths[0]);
    report(scanImageEntries(entries), `Container image content fixture passed: ${entries.length} entries are clean`);
    return;
  }
  console.error(`Usage: ${basename(process.argv[1])} repository [root] | deployment <files...> | image-tar <tar> | image-root <directory> | fixture <json>`);
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
