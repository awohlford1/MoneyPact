import { randomUUID } from "node:crypto";
import type { Denial } from "./types.ts";

export interface EnforcementEvidence {
  correlation_id: string; registration_id: string; surface_id: string | null; parameter_record_id: string | null;
  release_set_digest: string; executor_kind: "api_route" | "worker_job"; service_build: string;
}
export interface EnforcementOutcome extends EnforcementEvidence {
  earliest_decisive_gate: "session" | "surface" | "authorization"; safe_reason_class: Denial | "not_authenticated" | "authorization_denied";
  authorization_evaluation: "not_run" | "evaluated"; outcome: "deny"; timestamp: string; counter_store_evidence: "not_consumed" | "decision_unavailable" | "exhausted";
}
export function invocation(registrationId: string, executor: EnforcementEvidence["executor_kind"], release: string, build: string): EnforcementEvidence {
  return { correlation_id: randomUUID(), registration_id: registrationId, surface_id: null, parameter_record_id: null, release_set_digest: release, executor_kind: executor, service_build: build };
}
export function surfaceOutcome(evidence: EnforcementEvidence, reason: Denial): EnforcementOutcome {
  return { ...evidence, earliest_decisive_gate: "surface", safe_reason_class: reason, authorization_evaluation: "not_run", outcome: "deny", timestamp: new Date().toISOString(),
    counter_store_evidence: reason === "deny_exhausted" || reason === "deny_in_flight" ? "exhausted" : reason === "deny_counter_unavailable" ? "decision_unavailable" : "not_consumed" };
}
