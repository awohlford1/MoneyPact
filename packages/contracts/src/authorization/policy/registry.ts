import { sha256 } from "../canonical.ts";
import * as v1 from "./v1.ts";
import * as v2 from "./v2.ts";
import * as v3 from "./v3.ts";

/** The deployed version. p2 was released by docs/cbd-236-p2-release-step.md; p3 was released by
 * docs/cbd-236-p3-release-step.md after the release-history row carrying both approvals
 * (PO-P3-APPROVAL-001, PROTO-POLICY-V3-SEC-001-RESULT-001) was appended (PC-236-011, CBD236-POLICY-APPROVAL-001). */
export const CURRENT_POLICY_VERSION = "p3" as const;

function serialization<V extends string>(version: V, set: { actionDefinitions: readonly v1.ActionDefinition[]; userCells: readonly v2.P2UserCell[]; serviceCells: readonly v1.ServiceCell[] }) {
  return Object.freeze({ version, schemaVersion: 1, actionDefinitions: set.actionDefinitions, userCells: set.userCells, serviceCells: set.serviceCells });
}
const serializations = Object.freeze({
  p1: serialization("p1", { actionDefinitions: v1.ACTION_DEFINITIONS, userCells: v1.USER_CELLS, serviceCells: v1.SERVICE_CELLS }),
  p2: serialization("p2", { actionDefinitions: v2.ACTION_DEFINITIONS, userCells: v2.USER_CELLS, serviceCells: v2.SERVICE_CELLS }),
  p3: serialization("p3", { actionDefinitions: v3.ACTION_DEFINITIONS, userCells: v3.USER_CELLS, serviceCells: v3.SERVICE_CELLS }),
});
export const P1_DIGEST = sha256(serializations.p1);
export const P2_DIGEST = sha256(serializations.p2);
export const P3_DIGEST = sha256(serializations.p3);
export const POLICY_VERSIONS = Object.freeze({
  p1: Object.freeze({ ...serializations.p1, digest: P1_DIGEST }),
  p2: Object.freeze({ ...serializations.p2, digest: P2_DIGEST }),
  p3: Object.freeze({ ...serializations.p3, digest: P3_DIGEST }),
});
export type RegisteredPolicyVersion = keyof typeof POLICY_VERSIONS;
export type RegisteredPolicy = (typeof POLICY_VERSIONS)[RegisteredPolicyVersion];
/** The current version's digest-less serialization; the application startup guard hashes it. */
export const POLICY_SERIALIZATION = serializations[CURRENT_POLICY_VERSION];
export const CURRENT_POLICY = POLICY_VERSIONS[CURRENT_POLICY_VERSION];
/** True only for the deployed current tuple: a registered but non-current version is not compatible. */
export function policyCompatibility(version: string, expectedDigest: string, schemaVersion: number): boolean {
  const policy = POLICY_VERSIONS[version as RegisteredPolicyVersion];
  return policy !== undefined && version === CURRENT_POLICY_VERSION && policy.digest === expectedDigest && policy.schemaVersion === schemaVersion && sha256(POLICY_SERIALIZATION) === expectedDigest;
}
