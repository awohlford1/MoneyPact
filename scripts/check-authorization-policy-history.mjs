import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { POLICY_VERSIONS } from "../packages/contracts/src/authorization/policy/registry.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const historyPath = "config/authorization-policy-release-history.json";
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}
const digest = (value) => createHash("sha256").update(canonicalize(value)).digest("hex");

export function validateAuthorizationPolicyHistory({ baseRows, candidateRows, registry }) {
  const failures = [];
  if (!Array.isArray(baseRows) || !Array.isArray(candidateRows)) return ["release history must be a JSON array"];
  if (candidateRows.length < baseRows.length) failures.push("released rows are append-only and may not be removed");
  baseRows.forEach((row, index) => {
    if (canonicalize(candidateRows[index]) !== canonicalize(row)) failures.push(`released row ${index} may not be changed or reordered`);
  });
  const seen = new Set();
  candidateRows.forEach((row, index) => {
    const required = ["version", "digest", "schemaVersion", "releaseCommit", "productApprovalRef", "securityApprovalRef"];
    if (!row || typeof row !== "object" || Object.keys(row).sort().join("|") !== [...required].sort().join("|")) failures.push(`released row ${index} must contain exactly the six governed fields`);
    for (const field of required) if (row?.[field] === "" || row?.[field] === undefined || row?.[field] === null) failures.push(`released row ${index} requires ${field}`);
    if (seen.has(row?.version)) failures.push(`policy version ${row?.version} appears more than once`);
    seen.add(row?.version);
    const policy = registry[row?.version];
    if (!policy) failures.push(`released policy ${row?.version} is absent from the registry`);
    else {
      const serialization = { version: policy.version, schemaVersion: policy.schemaVersion, actionDefinitions: policy.actionDefinitions, userCells: policy.userCells, serviceCells: policy.serviceCells };
      if (digest(serialization) !== row.digest || policy.digest !== row.digest) failures.push(`released policy ${row.version} does not match its independently pinned digest`);
      if (policy.schemaVersion !== row.schemaVersion) failures.push(`released policy ${row.version} schema version does not match history`);
    }
  });
  return failures;
}

async function main() {
  const candidateRows = JSON.parse(await readFile(resolve(repositoryRoot, historyPath), "utf8"));
  let baseRows = [];
  try {
    baseRows = JSON.parse(execFileSync("git", ["show", `origin/main:${historyPath}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch { /* The first candidate has no base manifest. */ }
  const failures = validateAuthorizationPolicyHistory({ baseRows, candidateRows, registry: POLICY_VERSIONS });
  if (failures.length) { failures.forEach((failure) => console.error(`Authorization policy history check failed: ${failure}`)); process.exitCode = 1; return; }
  console.log("Authorization policy history check passed: released rows are append-only, approved, and digest-pinned");
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
