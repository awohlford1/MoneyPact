import { sha256 } from "../canonical.ts";
import { ACTION_DEFINITIONS, SERVICE_CELLS, USER_CELLS } from "./v1.ts";

export const CURRENT_POLICY_VERSION = "p1" as const;
export const POLICY_SERIALIZATION = Object.freeze({
  version: CURRENT_POLICY_VERSION,
  schemaVersion: 1,
  actionDefinitions: ACTION_DEFINITIONS,
  userCells: USER_CELLS,
  serviceCells: SERVICE_CELLS,
});
export const P1_DIGEST = sha256(POLICY_SERIALIZATION);
export const POLICY_VERSIONS = Object.freeze({
  p1: Object.freeze({ ...POLICY_SERIALIZATION, digest: P1_DIGEST }),
});
export type RegisteredPolicyVersion = keyof typeof POLICY_VERSIONS;
export function policyCompatibility(version: string, expectedDigest: string, schemaVersion: number): boolean {
  const policy = POLICY_VERSIONS[version as RegisteredPolicyVersion];
  return policy !== undefined && policy.digest === expectedDigest && policy.schemaVersion === schemaVersion && sha256(POLICY_SERIALIZATION) === expectedDigest;
}
