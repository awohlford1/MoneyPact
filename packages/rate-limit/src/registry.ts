import { createHash } from "node:crypto";
import { PUBLIC_SURFACES, SURFACE_CATALOG } from "./catalog.ts";
import { instant, validateShape } from "./schema.ts";
import type { Diagnostic } from "./schema.ts";
import type { ApprovalContext, ParameterRecord, Registration } from "./types.ts";

export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("canonical_value_invalid");
}
export const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export function candidateDigest(record: ParameterRecord): string {
  const value = { ...record } as Partial<ParameterRecord>; delete value.product_owner_approval; delete value.record_digest; return digest(value);
}
export function recordDigest(record: ParameterRecord): string {
  const value = { ...record } as Partial<ParameterRecord>; delete value.record_digest; return digest(value);
}
export function seal(record: ParameterRecord): ParameterRecord {
  const result = structuredClone(record); result.product_owner_approval.candidate_digest = candidateDigest(result); result.record_digest = recordDigest(result); return result;
}
export const KEY_COMPONENTS: Readonly<Record<string, { trust: string; cardinality: string; phases: readonly string[] }>> = Object.freeze({
  privacy_network_cohort_v1: { trust: "direct loopback transport, never forwarded headers", cardinality: "one local network cohort", phases: ["pre_authentication"] },
  exact_surface_id: { trust: "canonical server registration", cardinality: "closed catalog", phases: ["pre_authentication", "post_authentication", "service"] },
  verified_actor_id_v1: { trust: "server session store", cardinality: "one verified actor", phases: ["post_authentication"] },
  server_issued_bootstrap_ceremony_id_v1: { trust: "server ceremony store", cardinality: "one valid ceremony", phases: ["compound"] },
  bootstrap_stage_v1: { trust: "server ceremony transition", cardinality: "first_sign_in or initial_space_create or ordinary", phases: ["compound"] },
  verified_primary_owner_id_v1: { trust: "server ceremony owner binding after credential verification", cardinality: "one Primary Owner", phases: ["compound"] },
});
export interface Registry {
  records: readonly ParameterRecord[]; approved: ReadonlyMap<string, ParameterRecord>; diagnostics: readonly Diagnostic[]; releaseSetDigest: string;
  approvalCurrent(record: ParameterRecord): boolean;
}
/**
 * CBD266-SURFACE-STAGES-001: a record's counting stage set, derived only from its own safe counting key
 * (never a value someone could rename around). A bootstrap-class record -- `phase: "compound"` with the
 * `bootstrap_stage_v1` component -- owns exactly the reserved stages named by its
 * `quota.resource_dimensions` entries shaped `reserved_<stage>=<units>` (for `proto-bootstrap-v1`,
 * `first_sign_in` and `initial_space_create`); it never owns the implicit `ordinary` stage, which is a
 * same-record sub-pool, not a cross-record uniqueness claim. Every other record owns exactly the single
 * `ordinary` stage. A record with no reserved dimension named is stage-less (an empty set).
 */
const RESERVED_STAGE_DIMENSION = /^reserved_([a-z0-9_]+)=\d+$/;
export function recordStages(record: ParameterRecord): ReadonlySet<string> {
  if (record.safe_counting_key.phase === "compound" && record.safe_counting_key.components.includes("bootstrap_stage_v1")) {
    const stages = new Set<string>();
    for (const dimension of record.quota.resource_dimensions) {
      const match = RESERVED_STAGE_DIMENSION.exec(dimension);
      if (match) stages.add(match[1]!);
    }
    return stages;
  }
  return new Set(["ordinary"]);
}
/** The approved record on `surfaceId` that owns `stage`, if any (packages/rate-limit route enforcement, CBD266-SURFACE-STAGES-001). */
export function recordForStage(registry: Pick<Registry, "approved">, surfaceId: string, stage: string): ParameterRecord | undefined {
  for (const candidate of registry.approved.values()) if (candidate.surface_id === surfaceId && recordStages(candidate).has(stage)) return candidate;
  return undefined;
}
export function validateRegistry(input: unknown, context: ApprovalContext): Registry {
  const diagnostics: Diagnostic[] = []; const records: ParameterRecord[] = []; const approved = new Map<string, ParameterRecord>();
  const add = (recordId: string, code: string, pointer: string): void => { diagnostics.push({ recordId, code, pointer }); };
  if (!Array.isArray(input)) add("", "record_schema_invalid", "");
  for (const value of Array.isArray(input) ? input : []) {
    const id = typeof value?.record_id === "string" ? value.record_id as string : "";
    const errors = validateShape(value);
    if (errors.length) { for (const pointer of errors) add(id, "record_schema_invalid", pointer); continue; }
    const r = structuredClone(value) as ParameterRecord; records.push(r);
    const invalid = (pointer: string): void => add(id, "record_semantic_invalid", pointer);
    if (!SURFACE_CATALOG[r.surface_id] && r.surface_id !== PUBLIC_SURFACES["api:GET:/health"]) invalid("/surface_id");
    if (r.window.kind === "sliding" ? r.window.anchor !== "request_time" : !instant(r.window.anchor)) invalid("/window/anchor");
    if (r.counter_store.ttl_ms < Math.max(r.window.duration_ms, Math.ceil(r.burst.additional_units / r.burst.refill_units) * r.burst.refill_interval_ms)) invalid("/counter_store/ttl_ms");
    if (r.quota.ceiling !== r.threshold + r.burst.additional_units) invalid("/quota/ceiling");
    if (!r.capacity_basis.sustained_capacity.includes("estimate") || !r.capacity_basis.failure_budget.includes("zero")) invalid("/capacity_basis");
    for (const component of r.safe_counting_key.components) if (!KEY_COMPONENTS[component]?.phases.includes(r.safe_counting_key.phase)) invalid("/safe_counting_key/components");
    const recovery = r.anti_lockout_rule.independent_recovery_surface_id;
    const terminalRecovery = r.surface_id === "surf-266-recovery" && recovery === null;
    if (r.safe_counting_key.subject_bound_after_authentication && (!["post_authentication", "compound"].includes(r.safe_counting_key.phase) || (!recovery && !terminalRecovery))) invalid("/safe_counting_key/subject_bound_after_authentication");
    if (r.anti_lockout_rule.victim_bound_dimensions.length && !recovery && !terminalRecovery) invalid("/anti_lockout_rule/independent_recovery_surface_id");
    if (recovery && (!SURFACE_CATALOG[recovery] || recovery === r.surface_id)) invalid("/anti_lockout_rule/independent_recovery_surface_id");
    if (candidateDigest(r) !== r.product_owner_approval.candidate_digest) invalid("/product_owner_approval/candidate_digest");
    if (recordDigest(r) !== r.record_digest) invalid("/record_digest");
    const a = r.product_owner_approval;
    if (["approved", "rejected", "revoked"].includes(a.status) && (!a.approval_id || !a.decided_at)) invalid("/product_owner_approval");
    if (a.status === "approved" && !a.approved_by_actor_id) invalid("/product_owner_approval/approved_by_actor_id");
    let evidence;
    try { evidence = a.approval_id ? context.resolve(a.approval_id) : undefined; } catch { evidence = undefined; }
    if (a.status === "approved" && context.environment === "local-prototype" && context.singleProcess && instant(context.now)
      && evidence && !evidence.revoked && evidence.approvalId === a.approval_id && evidence.actorId === a.approved_by_actor_id
      && evidence.candidateDigests.includes(a.candidate_digest) && canonical(evidence.conditions) === canonical(a.conditions)
      && evidence.decidedAt === a.decided_at && evidence.expiresAt === a.expires_at && Date.parse(a.decided_at!) <= Date.parse(context.now)
      && (!a.expires_at || Date.parse(a.expires_at) > Date.parse(context.now))) approved.set(id, r);
    if (a.status === "approved" && !approved.has(id)) add(id, "approval_evidence_invalid", "/product_owner_approval");
  }
  const ids = new Set<string>(); const digests = new Set<string>();
  // CBD266-SURFACE-STAGES-001: one approved record per (surface, stage), not per surface. A surface may
  // carry a bootstrap-class record (reserved stages) next to an ordinary record with a disjoint stage set;
  // two approved records on one surface are refused when their stage sets intersect or either is stage-less.
  const surfaceStages = new Map<string, Set<string>>();
  for (const r of records) {
    if (ids.has(r.record_id) || digests.has(r.record_digest)) add(r.record_id, "record_reference_invalid", "/record_id");
    ids.add(r.record_id); digests.add(r.record_digest);
    if (approved.has(r.record_id)) {
      const stages = recordStages(r);
      const owned = surfaceStages.get(r.surface_id);
      const conflict = stages.size === 0 || (owned && [...stages].some((stage) => owned.has(stage)));
      if (conflict) add(r.record_id, "record_reference_invalid", "/surface_id");
      else { const next = owned ?? new Set<string>(); for (const stage of stages) next.add(stage); surfaceStages.set(r.surface_id, next); }
    }
    const seen = new Set([r.record_id]); let previous = r.supersedes_record_id;
    while (previous) {
      const parent = records.find((item) => item.record_id === previous);
      if (!parent || seen.has(previous) || parent.surface_id !== r.surface_id || Date.parse(parent.created_at) > Date.parse(r.created_at)) { add(r.record_id, "record_reference_invalid", "/supersedes_record_id"); break; }
      seen.add(previous); previous = parent.supersedes_record_id;
    }
  }
  // An unavailable independent recovery pool cannot be represented as runtime approval.
  for (const [id, r] of approved) {
    const recovery = r.anti_lockout_rule.independent_recovery_surface_id;
    if (recovery && ![...approved.values()].some((other) => other.surface_id === recovery && other.counter_store.namespace !== r.counter_store.namespace && (canonical(other.safe_counting_key.components) !== canonical(r.safe_counting_key.components) || (other.surface_id !== r.surface_id && other.safe_counting_key.components.includes("exact_surface_id") && r.safe_counting_key.components.includes("exact_surface_id"))))) approved.delete(id);
  }
  diagnostics.sort((a, b) => `${a.recordId}:${a.pointer}:${a.code}`.localeCompare(`${b.recordId}:${b.pointer}:${b.code}`));
  if (diagnostics.length) approved.clear();
  return { records, approved, diagnostics, releaseSetDigest: digest(records.slice().sort((a, b) => a.record_id.localeCompare(b.record_id))),
    approvalCurrent: (r) => {
      try {
        const a = r.product_owner_approval; const e = a.approval_id ? context.resolve(a.approval_id) : undefined;
        return context.environment === "local-prototype" && context.singleProcess && a.status === "approved" && !!e && !e.revoked
          && e.actorId === a.approved_by_actor_id && e.approvalId === a.approval_id && e.candidateDigests.includes(candidateDigest(r))
          && canonical(e.conditions) === canonical(a.conditions) && e.decidedAt === a.decided_at && e.expiresAt === a.expires_at
          && instant(e.decidedAt) && Date.parse(e.decidedAt) <= Date.now()
          && (!e.expiresAt || Date.parse(e.expiresAt) > Date.now());
      } catch { return false; }
    } };
}

export function normalizePath(path: string): string { return `/${path.split("?")[0]!.split("/").filter(Boolean).join("/")}`.replace(/:([A-Za-z][\w]*)/g, "{$1}"); }
export const apiIdentity = (method: string, path: string): string => `api:${method.toUpperCase()}:${normalizePath(path)}`;
export function registrationErrors(r: Registration): string[] {
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["registration_schema_invalid"];
  const fields = ["registration_id", "executor_kind", "source_locator", "surface_id", "parameter_record_id", "registration_lifecycle", "introduced_by", "authorization_metadata_id"];
  const errors: string[] = [];
  if (Object.keys(r).sort().join() !== fields.sort().join()) errors.push("registration_schema_invalid");
  if (!fields.filter((key) => !["parameter_record_id", "authorization_metadata_id"].includes(key)).every((key) => typeof r[key as keyof Registration] === "string" && r[key as keyof Registration])) errors.push("registration_schema_invalid");
  if (!["active", "retired"].includes(r.registration_lifecycle) || !["api_route", "worker_job"].includes(r.executor_kind)) errors.push("registration_schema_invalid");
  if ((r.parameter_record_id !== null && (typeof r.parameter_record_id !== "string" || !/^rlp-266-[a-z0-9-]+-v[1-9]\d*$/.test(r.parameter_record_id)))
    || (r.authorization_metadata_id !== null && (typeof r.authorization_metadata_id !== "string" || !r.authorization_metadata_id.length))
    || typeof r.source_locator !== "string" || !/^[a-zA-Z0-9_./-]+#[a-zA-Z0-9_.-]+$/.test(r.source_locator)) errors.push("registration_schema_invalid");
  if (r.executor_kind === "api_route" ? !/^api:[A-Z]+:\/[^?]*$/.test(r.registration_id) : !/^job:[a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+:[1-9]\d*$/.test(r.registration_id)) errors.push("registration_identity_invalid");
  if (r.executor_kind === "api_route" && typeof r.registration_id === "string") {
    const [, method, ...path] = r.registration_id.split(":");
    if (!method || apiIdentity(method, path.join(":")) !== r.registration_id) errors.push("registration_identity_invalid");
  }
  const publicSurface = PUBLIC_SURFACES[r.registration_id];
  if (publicSurface ? publicSurface !== r.surface_id || r.parameter_record_id !== null || r.authorization_metadata_id !== null : !SURFACE_CATALOG[r.surface_id] || !r.parameter_record_id) errors.push("registration_binding_invalid");
  if (!publicSurface && !r.authorization_metadata_id && !["surf-266-registration", "surf-266-authentication", "surf-266-recovery"].includes(r.surface_id)) errors.push("registration_authorization_invalid");
  return errors;
}
export function registerSurface<T>(registration: Registration, handler: T): { registration: Readonly<Registration>; handler: T } {
  if (registrationErrors(registration).length) throw new Error("registration_invalid");
  return { registration: Object.freeze({ ...registration }), handler };
}
