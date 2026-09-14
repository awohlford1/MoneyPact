import type { EffectClass, ResourceType } from "../input.ts";
import { ACTION_DEFINITIONS as P1_ACTION_DEFINITIONS, SERVICE_CELLS as P1_SERVICE_CELLS, USER_CELLS as P1_USER_CELLS } from "./v1.ts";
import type { ActionDefinition, ServiceCell, UserCell } from "./v1.ts";

/** Policy version p2 = every p1 table entry byte-identical, plus the subject-scoped cells below.
 * A subject-scoped cell is keyed on the acting subject and the configured environment, never on a
 * space, membership, or consent (docs/cbd-236-authorization-policy-contract.md section 8.5).
 * The one p1 definition that changes is `profile.read`: reserved in p1, a subject-self read in p2
 * under PROTO-POLICY-V2-DECISION-001. `v1.ts` is not edited (PC-236-011).
 */
export type SubjectNotation = "Allow" | "Read";
export interface SubjectCell { action: string; permission: "subject"; role: "acting_subject"; notation: SubjectNotation; obligations: readonly string[] }
export type P2UserCell = UserCell | SubjectCell;

// [class, operation, effectClass, resourceType (undefined = subject-self cell), obligations]
const subjectRows = [
  ["proposal", "create", "mutate", undefined, []],
  ["proposal", "regenerate", "mutate", "proposal", []],
  ["proposal", "read", "read", "proposal", ["bind_cache_key"]],
  ["membership", "list_own", "read", undefined, ["bind_cache_key"]],
  ["profile", "read", "read", undefined, ["bind_cache_key"]],
] as const satisfies readonly (readonly [string, string, EffectClass, ResourceType | undefined, readonly string[]])[];

export const SUBJECT_ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze(subjectRows.map(([scope, operation, effectClass, resourceType]) => ({
  action: `${scope}.${operation}`, permission: "subject", operation, effectClass,
  ...(resourceType === undefined ? {} : { resourceType }), authorityModes: ["user_delegated"] as const,
})));
export const SUBJECT_CELLS: readonly SubjectCell[] = Object.freeze(subjectRows.map(([scope, operation, effectClass, , obligations]) => ({
  action: `${scope}.${operation}`, permission: "subject" as const, role: "acting_subject" as const,
  notation: effectClass === "read" ? "Read" as const : "Allow" as const, obligations,
})));

const enabledInP2 = new Set(SUBJECT_ACTION_DEFINITIONS.map((item) => item.action));
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([
  ...P1_ACTION_DEFINITIONS.filter((item) => !enabledInP2.has(item.action)),
  ...SUBJECT_ACTION_DEFINITIONS,
]);
export const USER_CELLS: readonly P2UserCell[] = Object.freeze([...P1_USER_CELLS, ...SUBJECT_CELLS]);
export const SERVICE_CELLS: readonly ServiceCell[] = P1_SERVICE_CELLS;
export const POLICY_SET = Object.freeze({ actionDefinitions: ACTION_DEFINITIONS, userCells: USER_CELLS, serviceCells: SERVICE_CELLS, schemaVersion: 1 });
