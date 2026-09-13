import type { EffectClass, ResourceType } from "../input.ts";

export type CellNotation = "Allow" | "Read" | "Authorizer" | "Own" | "Primary" | "Deny" | "Not applicable";
export interface ActionDefinition { action: string; permission: string; operation: string; effectClass: EffectClass; resourceType?: ResourceType; authorityModes: readonly ("user_delegated" | "service")[] }
export interface UserCell { action: string; permission: string; role: "primary_owner"; notation: CellNotation; obligations: readonly string[] }
export interface ServiceCell { action: "service.SA-92-002.generate_period_state"; purpose: "SA-92-002"; operation: "generate_period_state"; obligations: readonly string[] }

const rows = [
  ["1", "view_space", "read", "space"],
  ["2a", "create_plan|edit_plan|edit_target", "mutate", "plan"], ["2b", "discard_draft_plan", "lifecycle", "plan"],
  ["3", "create_bill|edit_bill|archive_bill|restore_bill|create_goal|edit_goal|archive_goal|restore_goal|discard_resource_draft", "mutate", "bill"],
  ["4", "create_category|edit_category|archive_category|restore_category", "mutate", "category"],
  ["5", "create_schedule|edit_schedule|cancel_schedule|confirm_schedule", "mutate", "schedule"],
  ["6a", "confirm_income_suggestion|reject_income_suggestion", "mutate", "income"],
  ["6b", "match_expected_income|unmatch_expected_income", "mutate", "income"],
  ["6c", "match_pending_posted|unmatch_pending_posted", "mutate", "transaction"],
  ["6d", "split_pending_posted_match", "mutate", "transaction"], ["6e", "dismiss_reconciliation_candidate", "mutate", "transaction"],
  ["7", "override_budget_date", "mutate", "transaction"], ["8", "assign_transaction_category|change_transaction_category", "mutate", "transaction"],
  ["9", "add_manual_transaction|edit_manual_transaction|remove_manual_transaction|restore_manual_transaction", "mutate", "transaction"],
  ["10", "edit_bank_source_field", "mutate", "transaction"], ["11a", "add_comment", "comment", "comment"],
  ["11b", "edit_own_comment", "comment", "comment"], ["11c", "remove_own_comment", "comment", "comment"],
  ["11d", "moderate_other_comment", "comment", "comment"], ["12", "acknowledge_firm_alert", "acknowledge", "alert_instance"],
  ["13", "acknowledge_informational_alert", "acknowledge", "alert_instance"],
  ["14", "view_accounts_balances_transactions", "read", "account"], ["15", "view_planning_and_reports", "read", "report"],
  ["16", "view_schedule_reconciliation_history", "read", "schedule"], ["17", "search_financial_records", "read", "transaction"],
  ["18", "view_derived_indicators", "read", "report"], ["19", "generate_report", "read", "report"],
  ["20a", "generate_financial_export|download_financial_export", "export", "export_package"],
  ["20b", "generate_admin_history_export|download_admin_history_export", "export", "export_package"],
  ["21", "create_viewer_snapshot", "export", "export_package"],
  ["22", "assign_viewer_scope|change_viewer_scope|remove_viewer_scope", "mutate", "membership"],
  ["23", "change_partner_partial_visibility", "mutate", "membership"],
  ["24", "invite_nonowner|revoke_nonowner|resend_invitation|replace_invitation|remove_nonowner", "mutate", "membership"],
  ["25", "assign_nonowner_role|change_nonowner_role", "mutate", "membership"], ["26", "invite_coowner|assign_coowner", "mutate", "membership"],
  ["27", "remove_coowner", "mutate", "membership"], ["28", "remove_primary_owner|demote_primary_owner", "mutate", "membership"],
  ["29", "transfer_primary_ownership", "protected", "membership"], ["30", "update_shared_setting", "mutate", "preference"],
  ["31", "authorize_connection", "protected", "connection"],
  ["32", "refresh_connection|repair_connection|reauthorize_connection|disconnect_connection", "protected", "connection"],
  ["33", "view_connection_management_details", "read", "connection"],
  ["34", "request_space_deletion|cancel_space_deletion", "lifecycle", "space"], ["35", "archive_space|restore_space", "lifecycle", "space"],
] as const satisfies readonly (readonly [string, string, EffectClass, ResourceType])[];

const notation: Readonly<Record<string, CellNotation>> = Object.freeze({ "1": "Read", "10": "Deny", "23": "Deny", "11b": "Own", "11c": "Own", "11d": "Deny", "13": "Not applicable", "14": "Read", "15": "Read", "16": "Read", "20b": "Primary", "27": "Primary", "28": "Deny", "29": "Primary", "32": "Authorizer", "33": "Authorizer", "34": "Primary", "35": "Primary" });
const obligations: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "2a": ["preserve"], "2b": ["confirm"], "3": ["confirm", "preserve"], "4": ["preserve"], "7": ["preserve", "invalidate"],
  "8": ["preserve", "invalidate"], "9": ["confirm", "preserve", "invalidate"], "14": ["mask", "bind_cache_key"],
  "15": ["mask", "bind_cache_key"], "16": ["mask", "bind_cache_key"], "17": ["mask", "bind_cache_key"], "18": ["bind_cache_key"],
  "19": ["bind_cache_key"], "20a": ["fresh_assurance", "secure_package"], "20b": ["fresh_assurance", "secure_package"],
  "21": ["secure_package", "invalidate"], "22": ["invalidate", "notify"], "24": ["invalidate", "notify"], "25": ["invalidate", "notify"],
  "26": ["notify"], "27": ["fresh_assurance", "confirm", "invalidate", "notify"], "29": ["fresh_assurance", "confirm", "invalidate", "notify", "preserve"],
  "31": ["preserve"], "32": ["confirm", "invalidate", "preserve"], "34": ["fresh_assurance", "confirm", "notify", "preserve"],
  "35": ["fresh_assurance", "confirm", "notify", "preserve", "invalidate"],
});

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([
  { action: "space.create", permission: "bootstrap", operation: "create", effectClass: "mutate", authorityModes: ["user_delegated"] },
  ...rows.flatMap(([permission, operations, effectClass, resourceType]) => operations.split("|").map((operation) => ({ action: `${permission}.${operation}`, permission, operation, effectClass, resourceType, authorityModes: ["user_delegated"] as const }))),
  { action: "profile.create", permission: "reserved", operation: "create", effectClass: "mutate", resourceType: "profile", authorityModes: ["user_delegated"] },
  { action: "profile.read", permission: "reserved", operation: "read", effectClass: "read", resourceType: "profile", authorityModes: ["user_delegated"] },
  { action: "preference.update", permission: "reserved", operation: "update", effectClass: "mutate", resourceType: "preference", authorityModes: ["user_delegated"] },
  { action: "service.SA-92-002.generate_period_state", permission: "SA-92-002", operation: "generate_period_state", effectClass: "mutate", resourceType: "period_state", authorityModes: ["service"] },
]);
export const USER_CELLS: readonly UserCell[] = Object.freeze([
  { action: "space.create", permission: "bootstrap", role: "primary_owner", notation: "Allow", obligations: ["create_primary_owner_membership"] },
  ...rows.flatMap(([permission, operations]) => operations.split("|").map((operation) => ({ action: `${permission}.${operation}`, permission, role: "primary_owner" as const, notation: notation[permission] ?? "Allow", obligations: obligations[permission] ?? [] }))),
]);
export const SERVICE_CELLS: readonly ServiceCell[] = Object.freeze([{ action: "service.SA-92-002.generate_period_state", purpose: "SA-92-002", operation: "generate_period_state", obligations: ["preserve"] }]);
export const POLICY_SET = Object.freeze({ actionDefinitions: ACTION_DEFINITIONS, userCells: USER_CELLS, serviceCells: SERVICE_CELLS, schemaVersion: 1 });
