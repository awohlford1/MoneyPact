import type { EffectClass } from "../input.ts";
import { ACTION_DEFINITIONS as P5_ACTION_DEFINITIONS, SERVICE_CELLS as P5_SERVICE_CELLS, USER_CELLS as P5_USER_CELLS } from "./v5.ts";
import type { P5UserCell } from "./v5.ts";
import type { SubjectCell } from "./v2.ts";
import type { ActionDefinition, ServiceCell } from "./v1.ts";

/** Policy version p6 = every p5 table entry byte-identical (and therefore every p4, p3, p2 and p1 entry), plus the
 * three subject-self cells this section appends (docs/cbd-236-authorization-policy-contract.md section 8.9;
 * docs/cbd-236-p6-subject-self-amendment-proposal.md section 2, `P6-E01`, under `EXEC-P6-RULINGS-001` `P6-D01`/`P6-D02`).
 * `v1.ts` through `v5.ts` are not edited (PC-236-011). No `ResourceType` union member is added; `schemaVersion` stays 1
 * (proposal section 5).
 *
 * `notice.read` closes `GAPS-F01`/`SEC-GAPS-R1`'s discriminating gap: the notices routes previously ran on the
 * released `profile.read` subject-self cell, whose `effectClass` is `read`, so a mark-read mutation on that cell
 * never carried `recheck_at_commit`. `notice.mark_read` and `profile.set_display_name` are `mutate` cells, so the
 * evaluator's universal obligations (section 5.3) add `recheck_at_commit` to each; `notice.read` carries `audit`
 * alone plus the `bind_cache_key` obligation stated explicitly below, following the same rule every subject-scoped
 * read cell already uses (section 5.3, `profile.read`, `membership.list_own`).
 *
 * All three are subject-self (no `resourceType`, no target row; proposal section 3, `P6-D01`): isolation rests
 * entirely on provenance (`subject.accountSubjectId` from `session_store`, never a locator), exactly as
 * `invitation.attach` already proves for a mutate subject-self cell. */
// [operation, effectClass, cell obligations]
const subjectRows = [
  ["notice.read", "read", ["bind_cache_key"]],
  ["notice.mark_read", "mutate", []],
  ["profile.set_display_name", "mutate", []],
] as const satisfies readonly (readonly [string, EffectClass, readonly string[]])[];

export const P6_ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze(subjectRows.map(([action, effectClass]) => ({
  action, permission: "subject", operation: action.split(".", 2)[1] ?? action, effectClass, authorityModes: ["user_delegated"] as const,
})));
export const P6_SUBJECT_CELLS: readonly SubjectCell[] = Object.freeze(subjectRows.map(([action, effectClass, obligations]) => ({
  action, permission: "subject" as const, role: "acting_subject" as const,
  notation: effectClass === "read" ? "Read" as const : "Allow" as const, obligations,
})));

export type P6UserCell = P5UserCell;
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([...P5_ACTION_DEFINITIONS, ...P6_ACTION_DEFINITIONS]);
export const USER_CELLS: readonly P6UserCell[] = Object.freeze([...P5_USER_CELLS, ...P6_SUBJECT_CELLS]);
export const SERVICE_CELLS: readonly ServiceCell[] = P5_SERVICE_CELLS;
export const POLICY_SET = Object.freeze({ actionDefinitions: ACTION_DEFINITIONS, userCells: USER_CELLS, serviceCells: SERVICE_CELLS, schemaVersion: 1 });
