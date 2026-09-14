export interface ParameterRecord {
  schema_version: 1; record_id: string; surface_id: string;
  window: { duration_ms: number; kind: "fixed" | "sliding"; anchor: string };
  threshold: number;
  burst: { additional_units: number; refill_units: number; refill_interval_ms: number };
  safe_counting_key: { phase: "pre_authentication" | "post_authentication" | "service" | "compound"; components: string[]; derivation_version: string; normalization: string; rotation_behavior: string; privacy_basis: string; subject_bound_after_authentication: boolean };
  counter_store: { binding: string; namespace: string; atomic_operation: string; consistency: string; region: string; ttl_ms: number; clock_source: string; failure_mode: "deny" };
  quota: { unit: string; ceiling: number; scope: string; reset: string; resource_dimensions: string[] };
  anti_lockout_rule: { attackable_dimensions: string[]; victim_bound_dimensions: string[]; independent_recovery_surface_id: string | null; pool_isolation: string; exhaustion_state_effect: "none"; reset_authority: string; notification_behavior: string; rationale: string; verification_cases: string[] };
  capacity_basis: { evidence_locator: string; measured_at: string; sustained_capacity: string; peak_assumption: string; headroom: string; failure_budget: string; workload_assumptions: string[]; reviewer_role: string };
  product_owner_approval: { status: "pending" | "approved" | "rejected" | "revoked" | "expired"; approval_id: string | null; approved_by_actor_id: string | null; decided_at: string | null; candidate_digest: string; conditions: string[]; expires_at: string | null };
  source_requirements: string[]; created_at: string; supersedes_record_id: string | null; record_digest: string;
}
export interface Registration {
  registration_id: string; executor_kind: "api_route" | "worker_job"; source_locator: string; surface_id: string;
  parameter_record_id: string | null; registration_lifecycle: "active" | "retired"; introduced_by: string; authorization_metadata_id: string | null;
}
export type Denial = "deny_exhausted" | "deny_unregistered" | "deny_policy_unavailable" | "deny_counter_unavailable" | "deny_input_invalid";
/** `refund` (PROTO-QA-FIXES-001 F1) is present only when the admitted unit is a reserved bootstrap unit the
 * store can return once; see `CounterResult`. */
export type Decision = { outcome: "allow"; provenance: string; release: () => Promise<void>; refund?: () => Promise<boolean> } | { outcome: Denial };
export interface ApprovalEvidence {
  approvalId: string; actorId: string; candidateDigests: readonly string[]; conditions: readonly string[];
  decidedAt: string; expiresAt: string | null; revoked: boolean;
}
export interface ApprovalContext {
  now: string; environment: "local-prototype" | "hosted"; singleProcess: boolean;
  resolve(id: string): ApprovalEvidence | undefined;
}
