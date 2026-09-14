import type { EffectClass, ResourceType } from "../input.ts";
import { ACTION_DEFINITIONS as P2_ACTION_DEFINITIONS, SERVICE_CELLS as P2_SERVICE_CELLS, USER_CELLS as P2_USER_CELLS } from "./v2.ts";
import type { P2UserCell } from "./v2.ts";
import type { ActionDefinition, ServiceCell, UserCell } from "./v1.ts";

/** Policy version p3 = every p2 table entry byte-identical (and therefore every p1 entry), plus the
 * manual-account increment cells below (docs/cbd-236-authorization-policy-contract.md section 8.6).
 * The new cells are ordinary space-bound Primary Owner cells evaluated on the section 8.2 "Allow" and
 * "Read" predicates; no evaluator change, no new input variant, no new reason class.
 * `v1.ts` and `v2.ts` are not edited (PC-236-011).
 *
 * `manual_account` is the permission key for the four management cells. CBD-72 section 4 carries no
 * manual-account management row (rows 31-33 govern bank connections, row 9 manual transactions), so the
 * key is deliberately not a matrix number: the governing source is the section 8.6.1 table, approved by
 * the Product Owner before release, until CBD-72 gains the row (OQ-236-011).
 *
 * `14.view_progress_detail` is the CBD-211 itemized progress-detail read. The permission is CBD-72 row 14
 * ("view accounts, balances, and transactions"); the p1 code `14.view_accounts_balances_transactions`
 * binds a single `account` target, and the drill-down is keyed on a category and period across every
 * account in the space, so it needs its own code with a `category` target. Same notation, same obligations.
 */
export const ACCOUNT_PERMISSION = "manual_account" as const;
export const PROGRESS_DETAIL_ACTION = "14.view_progress_detail" as const;

// [permission, operation, effectClass, resourceType, obligations]
const p3Rows = [
  [ACCOUNT_PERMISSION, "create_manual_account", "mutate", "account", ["preserve", "invalidate"]],
  [ACCOUNT_PERMISSION, "edit_manual_account", "mutate", "account", ["preserve", "invalidate"]],
  [ACCOUNT_PERMISSION, "archive_manual_account", "mutate", "account", ["confirm", "preserve", "invalidate"]],
  [ACCOUNT_PERMISSION, "restore_manual_account", "mutate", "account", ["confirm", "preserve", "invalidate"]],
  ["14", "view_progress_detail", "read", "category", ["mask", "bind_cache_key"]],
] as const satisfies readonly (readonly [string, string, EffectClass, ResourceType, readonly string[]])[];

export const P3_ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze(p3Rows.map(([permission, operation, effectClass, resourceType]) => ({
  action: `${permission}.${operation}`, permission, operation, effectClass, resourceType, authorityModes: ["user_delegated"] as const,
})));
export const P3_USER_CELLS: readonly UserCell[] = Object.freeze(p3Rows.map(([permission, operation, effectClass, , obligations]) => ({
  action: `${permission}.${operation}`, permission, role: "primary_owner" as const,
  notation: effectClass === "read" ? "Read" as const : "Allow" as const, obligations,
})));

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([...P2_ACTION_DEFINITIONS, ...P3_ACTION_DEFINITIONS]);
export const USER_CELLS: readonly P2UserCell[] = Object.freeze([...P2_USER_CELLS, ...P3_USER_CELLS]);
export const SERVICE_CELLS: readonly ServiceCell[] = P2_SERVICE_CELLS;
export const POLICY_SET = Object.freeze({ actionDefinitions: ACTION_DEFINITIONS, userCells: USER_CELLS, serviceCells: SERVICE_CELLS, schemaVersion: 1 });
