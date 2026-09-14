import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { policyCompatibility } from "@cobudget/contracts/authorization";

export interface PolicyTuple { version: string; expectedDigest: string; schemaVersion: number }

// Independent application pin. Never derive this value from the loaded registry.
export const SUPPORTED_POLICY_TUPLES: readonly PolicyTuple[] = Object.freeze([
  Object.freeze({ version: "p2", expectedDigest: "374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322", schemaVersion: 1 }),
]);

export function readReleaseHistory(): unknown {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, "config/authorization-policy-release-history.json"))) {
    if (existsSync(join(directory, ".git")) || dirname(directory) === directory) throw new Error("policy_version_unsupported");
    directory = dirname(directory);
  }
  return JSON.parse(readFileSync(join(directory, "config/authorization-policy-release-history.json"), "utf8"));
}

export function assertPolicyCompatibility(
  history: unknown = readReleaseHistory(),
  supported: readonly PolicyTuple[] = SUPPORTED_POLICY_TUPLES,
): void {
  const tuple = supported.find((item) => item.version === "p2");
  const keys = ["digest", "productApprovalRef", "releaseCommit", "schemaVersion", "securityApprovalRef", "version"];
  if (!tuple || supported.length !== 1 || !Array.isArray(history)
    || !policyCompatibility(tuple.version, tuple.expectedDigest, tuple.schemaVersion)) {
    throw new Error("policy_version_unsupported");
  }
  const rows = history.filter((row: unknown) => typeof row === "object" && row !== null && "version" in row && row.version === tuple.version);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (rows.length !== 1 || !row || Object.keys(row).sort().join() !== keys.join()
    || row.digest !== tuple.expectedDigest || row.schemaVersion !== tuple.schemaVersion
    || ![row.releaseCommit, row.productApprovalRef, row.securityApprovalRef].every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error("policy_version_unsupported");
  }
}
