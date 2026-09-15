import type { EffectClass, ResourceType, Role } from "../input.ts";
import { ACTION_DEFINITIONS as P4_ACTION_DEFINITIONS, SERVICE_CELLS as P4_SERVICE_CELLS, USER_CELLS as P4_USER_CELLS } from "./v4.ts";
import type { NonOwnerCell, NonOwnerRole, P4UserCell } from "./v4.ts";
import type { SubjectCell } from "./v2.ts";
import type { ActionDefinition, CellNotation, ServiceCell, UserCell } from "./v1.ts";

/** Policy version p5 = every p4 table entry byte-identical (and therefore every p3, p2 and p1 entry), plus the
 * invitations increment (docs/cbd-236-authorization-policy-contract.md section 8.8; approved design
 * docs/cbd-234-invitations-consent-design-proposal.md section 11 under INVITATIONS-DESIGN-001, whose "p4" is this
 * version because p4 took the manual-account Co-owner and Collaborator cells first). `v1.ts` to `v4.ts` are not edited
 * (PC-236-011). Four groups are appended, in this order:
 *
 *  1. Section 11.1: five p1 definitions are superseded in place - `24.invite_nonowner`, `24.resend_invitation`,
 *     `24.replace_invitation`, `24.revoke_nonowner` and `26.invite_coowner` change `resourceType` from `membership` to
 *     `invitation` (an invitation is not a membership row; for create the target is the server-allocated candidate row).
 *     Their p1 cells are untouched; every other definition is carried byte-identical in its p4 position.
 *  2. Section 11.2: new space-bound cells under CBD-72 rows 1, 24, 26 and 29 for the invitation projection, the
 *     confirmation, the members list and the Primary-transfer workflow, plus the Co-owner Allow column on the four
 *     row-24 invitation operations. `29.transfer_primary_ownership` is the unchanged p1 protected cell.
 *  3. Section 11.3: three subject-scoped invitee cells under the literal `subject` key (`invitation.attach` subject-self;
 *     `invitation.read_ceremony` and `invitation.accept` subject-target on `invitation_ceremony`).
 *  4. Section 11.4: the Co-owner and Collaborator columns for every baseline action code a route exposes (rows 1, 2a, 4,
 *     9, 14, 15), copied from the p4 Primary Owner cell for the same action so the two tables cannot drift; the
 *     manual_account cells are already in p4. Viewer and Accountability Partner hold no cell anywhere (IV-001).
 *
 * The universal obligations (`audit` on every decision, `recheck_at_commit` on every non-read allow) are added by the
 * evaluator (section 5.3) and are not listed in a cell. `schemaVersion` stays 1: the input schema is extended additively
 * by the two `ResourceType` members, exactly as when p2 added `proposal`. */
export type P5UserCell = P4UserCell;
export const INVITATION_RESOURCE = "invitation" as const satisfies ResourceType;
export const CEREMONY_RESOURCE = "invitation_ceremony" as const satisfies ResourceType;

/** Section 11.1: the p1 definitions whose target becomes the invitation row. */
export const SUPERSEDED_ACTIONS: readonly string[] = Object.freeze(["24.invite_nonowner", "24.resend_invitation", "24.replace_invitation", "24.revoke_nonowner", "26.invite_coowner"]);

// Section 11.2: [permission, operation, effectClass, resourceType, [role, notation][], cell obligations]
const spaceBoundRows = [
  ["24", "view_invitations", "read", "space", [["primary_owner", "Read"], ["co_owner", "Read"]], ["bind_cache_key"]],
  ["24", "confirm_acceptance", "mutate", INVITATION_RESOURCE, [["primary_owner", "Allow"], ["co_owner", "Allow"]], ["invalidate"]],
  ["26", "confirm_acceptance", "mutate", INVITATION_RESOURCE, [["primary_owner", "Allow"]], ["invalidate"]],
  ["1", "view_members", "read", "space", [["primary_owner", "Read"], ["co_owner", "Read"], ["collaborator", "Read"]], ["bind_cache_key"]],
  ["29", "propose_primary_transfer", "mutate", "membership", [["primary_owner", "Primary"]], []],
  ["29", "accept_primary_transfer", "mutate", "membership", [["co_owner", "Allow"], ["collaborator", "Allow"]], []],
  ["29", "decline_primary_transfer", "mutate", "membership", [["co_owner", "Allow"], ["collaborator", "Allow"]], []],
  ["29", "withdraw_primary_transfer", "mutate", "membership", [["primary_owner", "Primary"]], []],
  ["29", "view_primary_transfer", "read", "membership", [["primary_owner", "Read"], ["co_owner", "Read"], ["collaborator", "Read"]], ["bind_cache_key"]],
] as const satisfies readonly (readonly [string, string, EffectClass, ResourceType, readonly (readonly [Role, CellNotation])[], readonly string[]])[];

// Section 11.3: [operation, effectClass, resourceType (undefined = subject-self cell), obligations]
const subjectRows = [
  ["attach", "mutate", undefined, []],
  ["read_ceremony", "read", CEREMONY_RESOURCE, ["bind_cache_key"]],
  ["accept", "mutate", CEREMONY_RESOURCE, []],
] as const satisfies readonly (readonly [string, EffectClass, ResourceType | undefined, readonly string[]])[];

/** Section 11.2 last paragraph: the row-24 operations that gain the Co-owner column; `26.invite_coowner` stays Primary-only. */
export const COOWNER_INVITATION_ACTIONS: readonly string[] = Object.freeze(["24.invite_nonowner", "24.replace_invitation", "24.resend_invitation", "24.revoke_nonowner"]);
/** Section 11.4: the baseline action codes whose Co-owner and Collaborator columns p5 maps with CBD-72's values. */
export const BASELINE_NON_OWNER_ACTIONS: readonly string[] = Object.freeze([
  "1.view_space",
  "2a.create_plan", "2a.edit_plan", "2a.edit_target",
  "4.create_category", "4.edit_category", "4.archive_category", "4.restore_category",
  "9.add_manual_transaction", "9.edit_manual_transaction", "9.remove_manual_transaction", "9.restore_manual_transaction",
  "14.view_accounts_balances_transactions", "14.view_progress_detail",
  "15.view_planning_and_reports",
]);
export const P5_ROLES: readonly NonOwnerRole[] = Object.freeze(["co_owner", "collaborator"]);

function ownerCell(action: string): UserCell {
  const owner = P4_USER_CELLS.find((cell) => cell.action === action && cell.role === "primary_owner");
  if (!owner || owner.role !== "primary_owner") throw new Error(`p4 carries no Primary Owner cell for ${action}`);
  return owner;
}
/** A non-owner cell copied from the Primary Owner cell for the same action: same notation (Read or Allow), same obligations. */
function nonOwnerCopy(action: string, role: NonOwnerRole): NonOwnerCell {
  const owner = ownerCell(action);
  return { action, permission: owner.permission, role, notation: owner.notation, obligations: owner.obligations };
}

export const P5_SPACE_ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze(spaceBoundRows.map(([permission, operation, effectClass, resourceType]) => ({
  action: `${permission}.${operation}`, permission, operation, effectClass, resourceType, authorityModes: ["user_delegated"] as const,
})));
export const P5_SUBJECT_ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze(subjectRows.map(([operation, effectClass, resourceType]) => ({
  action: `invitation.${operation}`, permission: "subject", operation, effectClass,
  ...(resourceType === undefined ? {} : { resourceType }), authorityModes: ["user_delegated"] as const,
})));
/** Section 11.2 cells in table order, one per (action, role). */
export const P5_SPACE_CELLS: readonly (UserCell | NonOwnerCell)[] = Object.freeze(spaceBoundRows.flatMap(([permission, operation, , , roles, obligations]) =>
  roles.map(([role, notation]) => ({ action: `${permission}.${operation}`, permission, role, notation, obligations }) as UserCell | NonOwnerCell)));
export const P5_COOWNER_INVITATION_CELLS: readonly NonOwnerCell[] = Object.freeze(COOWNER_INVITATION_ACTIONS.map((action) => nonOwnerCopy(action, "co_owner")));
export const P5_SUBJECT_CELLS: readonly SubjectCell[] = Object.freeze(subjectRows.map(([operation, effectClass, , obligations]) => ({
  action: `invitation.${operation}`, permission: "subject" as const, role: "acting_subject" as const,
  notation: effectClass === "read" ? "Read" as const : "Allow" as const, obligations,
})));
export const P5_BASELINE_NON_OWNER_CELLS: readonly NonOwnerCell[] = Object.freeze(P5_ROLES.flatMap((role) => BASELINE_NON_OWNER_ACTIONS.map((action) => nonOwnerCopy(action, role))));

/** Every cell p5 appends, in the order the four groups above state. */
export const P5_USER_CELLS: readonly P5UserCell[] = Object.freeze([...P5_SPACE_CELLS, ...P5_COOWNER_INVITATION_CELLS, ...P5_SUBJECT_CELLS, ...P5_BASELINE_NON_OWNER_CELLS]);
export const P5_ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([...P5_SPACE_ACTION_DEFINITIONS, ...P5_SUBJECT_ACTION_DEFINITIONS]);

const superseded = new Set(SUPERSEDED_ACTIONS);
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([
  ...P4_ACTION_DEFINITIONS.map((item) => superseded.has(item.action) ? { ...item, resourceType: INVITATION_RESOURCE } : item),
  ...P5_ACTION_DEFINITIONS,
]);
export const USER_CELLS: readonly P5UserCell[] = Object.freeze([...P4_USER_CELLS, ...P5_USER_CELLS]);
export const SERVICE_CELLS: readonly ServiceCell[] = P4_SERVICE_CELLS;
export const POLICY_SET = Object.freeze({ actionDefinitions: ACTION_DEFINITIONS, userCells: USER_CELLS, serviceCells: SERVICE_CELLS, schemaVersion: 1 });
