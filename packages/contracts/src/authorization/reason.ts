export type ReasonClass =
  | "allowed_by_cell" | "not_authenticated" | "input_invalid" | "input_unsupported"
  | "policy_version_unsupported" | "subject_not_active" | "membership_not_active" | "role_not_permitted"
  | "scope_mismatch" | "lifecycle_blocked" | "stale_version" | "consent_not_current"
  | "assurance_required" | "assurance_insufficient" | "authority_mode_unsupported"
  | "service_purpose_not_listed" | "reused_one_use_id";
export type ExternalDenial = { outcome: "deny"; reason: "denied" };
export function externalDenial(): ExternalDenial { return { outcome: "deny", reason: "denied" }; }
