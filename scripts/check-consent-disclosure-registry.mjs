#!/usr/bin/env node

// CBD-236 consent disclosure registry guard (CBD236-CONSENT-SEMANTICS-001
// item 3; docs/cbd-236-consent-facts-proposal.md SS5 `CF-236-005`).
//
// `disclosure_version` on a budget_space_consent row is the version of an
// approved disclosure text, and the only place a disclosure text is approved
// is config/consent-disclosure-registry.json. Two properties make that
// meaningful, and this guard is what makes each of them a failing build
// rather than a convention:
//
//  1. APPEND-ONLY. Every entry that is already on origin/main is byte-for-byte
//     (key-order-independent) the entry that is still there. An approved
//     disclosure is never edited or removed, because rows in the datastore
//     already cite it by version.
//  2. DIGEST-PINNED. Each entry's `digest` is the SHA-256 of the canonical
//     form of the content file it names in `text_ref`. Editing the text a
//     person was shown, without publishing a new version, therefore fails
//     here -- and fails again under rule 1, because the digest would have to
//     move with it.
//
// `status` is deliberately not a field. The entries are append-only and
// versions are dense from 1 per kind, so the current version of a kind is its
// highest version and cannot disagree with a stored flag.
//
// The API applies rules 2 and 3 again at startup through
// apps/api/src/budget-creation/consent-registry.ts and refuses to start on a
// registry whose digests do not reproduce, exactly as the policy release
// history guard does (CBD-236 SS6). This script is the build-time half and is
// run by apps/api/src/budget-creation/consent-registry.test.ts inside
// `npm run check`'s test stage.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const registryPath = "config/consent-disclosure-registry.json";

/** Key-sorted serialization, so a digest does not move when a formatter reorders keys. */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export const digestOf = (value) => createHash("sha256").update(canonicalize(value)).digest("hex");

const REQUIRED_FIELDS = ["kind", "version", "digest", "approved_by", "approved_at", "text_ref"];
const KIND_PATTERN = /^[a-z][a-z0-9_]*$/u;
const TEXT_REF_PATTERN = /^docs\/consent-disclosures\/[a-z0-9-]+\.v\d+\.json$/u;

/**
 * `contents` maps a `text_ref` to the parsed content file, or to `undefined`
 * when the file is missing. Pure, so the test can drive every failure without
 * writing files.
 */
export function validateConsentDisclosureRegistry({ baseEntries, candidateEntries, contents }) {
  const failures = [];
  if (!Array.isArray(candidateEntries)) return ["the consent disclosure registry must be a JSON array"];
  const base = Array.isArray(baseEntries) ? baseEntries : [];

  if (candidateEntries.length < base.length) failures.push("approved disclosure entries are append-only and may not be removed");
  base.forEach((entry, index) => {
    if (canonicalize(candidateEntries[index]) !== canonicalize(entry)) {
      failures.push(`approved disclosure entry ${index} (${entry?.kind} version ${entry?.version}) may not be changed or reordered`);
    }
  });

  const highest = new Map();
  candidateEntries.forEach((entry, index) => {
    const at = `disclosure entry ${index}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { failures.push(`${at} must be an object`); return; }
    const fields = Object.keys(entry).sort().join("|");
    if (fields !== [...REQUIRED_FIELDS].sort().join("|")) failures.push(`${at} must contain exactly the six governed fields (${REQUIRED_FIELDS.join(", ")})`);
    for (const field of REQUIRED_FIELDS) {
      if (entry[field] === "" || entry[field] === undefined || entry[field] === null) failures.push(`${at} requires ${field}`);
    }
    if (typeof entry.kind !== "string" || !KIND_PATTERN.test(entry.kind)) failures.push(`${at} has an invalid kind`);
    if (!Number.isSafeInteger(entry.version) || entry.version < 1) failures.push(`${at} version must be a positive integer`);
    if (typeof entry.digest !== "string" || !/^[0-9a-f]{64}$/u.test(entry.digest)) failures.push(`${at} digest must be a SHA-256 hex string`);
    if (typeof entry.text_ref !== "string" || !TEXT_REF_PATTERN.test(entry.text_ref)) failures.push(`${at} text_ref must name a docs/consent-disclosures/<name>.v<n>.json content file`);
    if (typeof entry.approved_at !== "string" || Number.isNaN(Date.parse(entry.approved_at))) failures.push(`${at} approved_at must be a UTC timestamp`);

    // Dense versions per kind, so the highest version is unambiguously current.
    const previous = highest.get(entry.kind);
    const expected = previous === undefined ? 1 : previous + 1;
    if (Number.isSafeInteger(entry.version) && entry.version !== expected) {
      failures.push(`${at}: ${entry.kind} versions must be dense and ascending from 1; expected ${expected} and found ${entry.version}`);
    }
    highest.set(entry.kind, entry.version);

    const content = contents[entry.text_ref];
    if (content === undefined) { failures.push(`${at}: content file ${entry.text_ref} is missing`); return; }
    if (digestOf(content) !== entry.digest) failures.push(`${at}: ${entry.text_ref} does not reproduce the pinned digest (the approved text changed without a new version)`);
    if (content.kind !== entry.kind || content.version !== entry.version) failures.push(`${at}: ${entry.text_ref} declares ${content.kind} version ${content.version}`);
    if (!Array.isArray(content.items) || content.items.length === 0) failures.push(`${at}: ${entry.text_ref} must carry at least one disclosure item`);
    if (typeof content.acknowledgement !== "string" || !content.acknowledgement.trim()) failures.push(`${at}: ${entry.text_ref} must carry the acknowledgement sentence`);
  });

  return failures;
}

async function readContents(entries) {
  const contents = {};
  for (const entry of entries) {
    const reference = entry?.text_ref;
    if (typeof reference !== "string" || Object.hasOwn(contents, reference)) continue;
    try { contents[reference] = JSON.parse(await readFile(resolve(repositoryRoot, reference), "utf8")); }
    catch { contents[reference] = undefined; }
  }
  return contents;
}

async function main() {
  const candidateEntries = JSON.parse(await readFile(resolve(repositoryRoot, registryPath), "utf8"));
  let baseEntries = [];
  try {
    baseEntries = JSON.parse(execFileSync("git", ["show", `origin/main:${registryPath}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch { /* The first candidate has no base registry. */ }
  const failures = validateConsentDisclosureRegistry({ baseEntries, candidateEntries, contents: await readContents(candidateEntries) });
  if (failures.length) {
    failures.forEach((failure) => console.error(`Consent disclosure registry check failed: ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Consent disclosure registry check passed: ${candidateEntries.length} approved disclosure entries are append-only and digest-pinned`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
