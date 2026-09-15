import type { Role } from "../input.ts";
import { ACTION_DEFINITIONS as P3_ACTION_DEFINITIONS, ACCOUNT_PERMISSION, SERVICE_CELLS as P3_SERVICE_CELLS, USER_CELLS as P3_USER_CELLS } from "./v3.ts";
import type { P2UserCell } from "./v2.ts";
import type { ActionDefinition, CellNotation, ServiceCell } from "./v1.ts";

/** Policy version p4 = every p3 table entry byte-identical (and therefore every p2 and p1 entry), plus the
 * Co-owner and Collaborator cells for the four manual-account management operations that CBD-72 section 4
 * row 36 grants (approved as proposed under PO-CBD72-ROW36-001; docs/cbd-236-authorization-policy-contract.md
 * section 8.7). No action definition is added: the four `manual_account.*` codes already exist in p3 with an
 * `account` target, and a cell is keyed on (action, role), so p4 adds cells only. Obligations are the p3
 * Primary Owner obligations for the same operation, as row 36 states. Viewer and Accountability Partner are
 * Deny in row 36 and are denied by absence (`role_not_permitted`), exactly as every other role is for every
 * section 8.3 cell. `v1.ts`, `v2.ts` and `v3.ts` are not edited (PC-236-011).
 *
 * `14.view_progress_detail` stays a Primary Owner-only cell: row 36 does not govern it and row 14's non-owner
 * columns are not decided here. */
export type NonOwnerRole = Exclude<Role, "primary_owner" | "viewer" | "accountability_partner">;
export interface NonOwnerCell { action: string; permission: string; role: NonOwnerRole; notation: CellNotation; obligations: readonly string[] }
export type P4UserCell = P2UserCell | NonOwnerCell;

export const P4_ROLES: readonly NonOwnerRole[] = Object.freeze(["co_owner", "collaborator"]);
const p4Operations = ["create_manual_account", "edit_manual_account", "archive_manual_account", "restore_manual_account"] as const;

/** One cell per (operation, role); the obligations are copied from the p3 Primary Owner cell for the same action so the
 * two tables cannot drift (the contracts tests compare them against an independent transcription of section 8.7.1). */
export const P4_USER_CELLS: readonly NonOwnerCell[] = Object.freeze(P4_ROLES.flatMap((role) => p4Operations.map((operation) => {
  const action = `${ACCOUNT_PERMISSION}.${operation}`;
  const owner = P3_USER_CELLS.find((cell) => cell.action === action && cell.role === "primary_owner");
  if (!owner) throw new Error(`p3 carries no Primary Owner cell for ${action}`);
  return { action, permission: ACCOUNT_PERMISSION, role, notation: owner.notation as CellNotation, obligations: owner.obligations };
})));

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = P3_ACTION_DEFINITIONS;
export const USER_CELLS: readonly P4UserCell[] = Object.freeze([...P3_USER_CELLS, ...P4_USER_CELLS]);
export const SERVICE_CELLS: readonly ServiceCell[] = P3_SERVICE_CELLS;
export const POLICY_SET = Object.freeze({ actionDefinitions: ACTION_DEFINITIONS, userCells: USER_CELLS, serviceCells: SERVICE_CELLS, schemaVersion: 1 });
