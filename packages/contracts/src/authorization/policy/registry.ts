import { sha256 } from "../canonical.ts";
import * as v1 from "./v1.ts";
import * as v2 from "./v2.ts";
import * as v3 from "./v3.ts";
import * as v4 from "./v4.ts";
import * as v5 from "./v5.ts";
import * as v6 from "./v6.ts";

/** The deployed version. p2 was released by docs/cbd-236-p2-release-step.md; p3 by
 * docs/cbd-236-p3-release-step.md; p4 and p5 were released together by the combined form of
 * docs/cbd-236-p5-release-step.md section 1 (p4 by docs/cbd-236-p4-release-step.md, released and never
 * deployed), after the release-history rows carrying each version's two approvals (p4:
 * PO-P4P5-APPROVAL-001, PROTO-POLICY-V4-SEC-001-RESULT-001; p5: PO-P4P5-APPROVAL-001,
 * PROTO-POLICY-V5-SEC-001-RESULT-001) were appended (PC-236-011, CBD236-POLICY-APPROVAL-001). p6 is
 * registered here (docs/cbd-236-authorization-policy-contract.md section 8.9) but not yet released:
 * it carries no release-history row and CURRENT_POLICY_VERSION stays p5 until
 * docs/cbd-236-p6-release-step.md is applied by a separate change (PROTO-CONTRACTS-P6-SPLIT-001),
 * after the release-history row carrying its two approvals (PO-P6-APPROVAL-001,
 * PROTO-CONTRACTS-P6-SEC-001-RESULT) is appended. */
export const CURRENT_POLICY_VERSION = "p5" as const;

function serialization<V extends string>(version: V, set: { actionDefinitions: readonly v1.ActionDefinition[]; userCells: readonly v6.P6UserCell[]; serviceCells: readonly v1.ServiceCell[] }) {
  return Object.freeze({ version, schemaVersion: 1, actionDefinitions: set.actionDefinitions, userCells: set.userCells, serviceCells: set.serviceCells });
}
const serializations = Object.freeze({
  p1: serialization("p1", { actionDefinitions: v1.ACTION_DEFINITIONS, userCells: v1.USER_CELLS, serviceCells: v1.SERVICE_CELLS }),
  p2: serialization("p2", { actionDefinitions: v2.ACTION_DEFINITIONS, userCells: v2.USER_CELLS, serviceCells: v2.SERVICE_CELLS }),
  p3: serialization("p3", { actionDefinitions: v3.ACTION_DEFINITIONS, userCells: v3.USER_CELLS, serviceCells: v3.SERVICE_CELLS }),
  p4: serialization("p4", { actionDefinitions: v4.ACTION_DEFINITIONS, userCells: v4.USER_CELLS, serviceCells: v4.SERVICE_CELLS }),
  p5: serialization("p5", { actionDefinitions: v5.ACTION_DEFINITIONS, userCells: v5.USER_CELLS, serviceCells: v5.SERVICE_CELLS }),
  p6: serialization("p6", { actionDefinitions: v6.ACTION_DEFINITIONS, userCells: v6.USER_CELLS, serviceCells: v6.SERVICE_CELLS }),
});
export const P1_DIGEST = sha256(serializations.p1);
export const P2_DIGEST = sha256(serializations.p2);
export const P3_DIGEST = sha256(serializations.p3);
export const P4_DIGEST = sha256(serializations.p4);
export const P5_DIGEST = sha256(serializations.p5);
export const P6_DIGEST = sha256(serializations.p6);
export const POLICY_VERSIONS = Object.freeze({
  p1: Object.freeze({ ...serializations.p1, digest: P1_DIGEST }),
  p2: Object.freeze({ ...serializations.p2, digest: P2_DIGEST }),
  p3: Object.freeze({ ...serializations.p3, digest: P3_DIGEST }),
  p4: Object.freeze({ ...serializations.p4, digest: P4_DIGEST }),
  p5: Object.freeze({ ...serializations.p5, digest: P5_DIGEST }),
  p6: Object.freeze({ ...serializations.p6, digest: P6_DIGEST }),
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
