import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PUBLIC_SURFACES } from "./catalog.ts";
import { canonical, recordForStage, registrationErrors } from "./registry.ts";
import type { Registry } from "./registry.ts";
import type { Decision, ParameterRecord, Registration } from "./types.ts";

export interface VerifiedContext {
  /** Only identity/ceremony adapters may populate these values. Never spread a request or envelope. */
  actorId?: string; networkCohort?: string; ceremonyId?: string;
  bootstrapStage?: "ordinary" | "first_sign_in" | "initial_space_create";
  credentialVerified?: boolean; primaryOwnerVerified?: boolean; localCaller: boolean;
}
export interface ConsumeInput {
  record: ParameterRecord; releaseSetDigest: string; keys: readonly string[]; unit: 1;
  bootstrapStage?: "ordinary" | "first_sign_in" | "initial_space_create";
}
/** PROTO-QA-FIXES-001 F1: `refund` returns a consumed *reserved* bootstrap unit to its ceremony, exactly once,
 * when the effect the unit admitted was denied after the surface decision; it resolves false (and returns
 * nothing) for an ordinary unit, for a second call, or once the window that held the reservation has ended.
 * Committed effects are never refunded: the caller invokes it only on a post-policy effect denial. */
/** EXEC-POV-C200F01-001 item 3: `in_flight` is the one refusal the store names -- the record's `concurrency=1`
 * dimension is held by a unit this same bucket admitted and has not yet released, while the sliding ceiling
 * still has room. Every other refusal (ceiling reached, burst spent, a reserved stage already taken) stays the
 * undifferentiated `exhausted`; when the ceiling and the concurrency dimension are both exceeded the ceiling
 * wins, so a bucket that is out of capacity is never told anything more specific than that. */
export type CounterResult = { outcome: "accepted"; provenance: string; release(): Promise<void>; refund(): Promise<boolean> } | { outcome: "exhausted" } | { outcome: "in_flight" };
export interface CounterStore {
  /** One atomic operation across window, burst, quota, reservations and concurrency.
   * A timeout/unknown result must never be retried as a fresh consume. */
  consume(input: ConsumeInput): Promise<CounterResult>;
}
interface Bucket { accepted: number[]; ordinary: number[]; reservations: Map<string, number>; tokens: number; refillAt: number; inFlight: Set<string>; last: number }

/** Primary store for one fresh local prototype process, NEVER a fallback.
 * Restart loses counters and ends the release; continued/hosted/multi-process use
 * requires a new store/release decision. No reset or failover bypass is exported. */
export class InProcessCounterStore implements CounterStore {
  readonly #buckets = new Map<string, Bucket>(); readonly #clock: () => number;
  #last = -Infinity; readonly #maximumBuckets: number;
  constructor(clock: () => number = () => performance.now(), maximumBuckets = 10_000) { this.#clock = clock; this.#maximumBuckets = maximumBuckets; }
  async consume(input: ConsumeInput): Promise<CounterResult> {
    const { record: r } = input; const now = this.#clock();
    if (!Number.isFinite(now) || now < this.#last || r.schema_version !== 1 || r.window.kind !== "sliding"
      || r.counter_store.binding !== "LOCAL_PROTOTYPE_COUNTER_STORE" || r.counter_store.consistency !== "single-process-linearizable"
      || input.unit !== 1 || !input.keys.length || input.keys.some((key) => !/^[a-f0-9]{64}$/.test(key))) throw new Error("counter_unavailable");
    this.#last = now;
    const prefix = `${input.releaseSetDigest}:${r.record_id}:${r.counter_store.namespace}:`;
    const aliases = input.keys.map((key) => prefix + key);
    const found = [...new Set(aliases.map((key) => this.#buckets.get(key)).filter((bucket): bucket is Bucket => !!bucket))];
    // Distinct histories cannot be safely merged by guessing their overlap.
    if (found.length > 1) throw new Error("counter_rotation_ambiguous");
    let bucket = found[0];
    if (!bucket) {
      if (this.#buckets.size + aliases.length > this.#maximumBuckets) throw new Error("counter_capacity_unavailable");
      bucket = { accepted: [], ordinary: [], reservations: new Map(), tokens: r.burst.additional_units, refillAt: now, inFlight: new Set(), last: now };
    }
    for (const alias of aliases) this.#buckets.set(alias, bucket);
    bucket.accepted = bucket.accepted.filter((at) => at > now - r.window.duration_ms);
    bucket.ordinary = bucket.ordinary.filter((at) => at > now - r.window.duration_ms);
    for (const [stage, at] of bucket.reservations) if (at <= now - r.window.duration_ms) bucket.reservations.delete(stage);
    const intervals = Math.floor((now - bucket.refillAt) / r.burst.refill_interval_ms);
    bucket.tokens = Math.min(r.burst.additional_units, bucket.tokens + intervals * r.burst.refill_units);
    bucket.refillAt += intervals * r.burst.refill_interval_ms; bucket.last = now;
    if (bucket.accepted.length >= r.quota.ceiling) return { outcome: "exhausted" };
    if (r.quota.resource_dimensions.includes("concurrency=1") && bucket.inFlight.size) return { outcome: "in_flight" };
    const bootstrap = r.quota.unit === "bootstrap_stage_decision";
    const stage = input.bootstrapStage ?? "ordinary";
    if (bootstrap) {
      if (stage === "ordinary" ? bucket.ordinary.length >= r.quota.ceiling - 2 : bucket.reservations.has(stage)) return { outcome: "exhausted" };
      if (stage === "ordinary") bucket.ordinary.push(now); else bucket.reservations.set(stage, now);
    } else if (bucket.accepted.length >= r.threshold) {
      if (bucket.tokens < 1) return { outcome: "exhausted" }; bucket.tokens--;
    }
    bucket.accepted.push(now); const lease = randomUUID(); bucket.inFlight.add(lease);
    const captured = bucket; const reserved = bootstrap && stage !== "ordinary"; let refunded = false;
    return { outcome: "accepted", provenance: "single-process-linearizable:consume-v1", release: async () => { captured.inFlight.delete(lease); },
      refund: async () => {
        // Single-use and keyed to this consumption: only the reservation this call placed (same stage, same instant) is returned.
        if (!reserved || refunded || captured.reservations.get(stage) !== now) return false;
        refunded = true; captured.reservations.delete(stage);
        const index = captured.accepted.indexOf(now); if (index !== -1) captured.accepted.splice(index, 1);
        return true;
      } };
  }
}

/** Rotation retains the previous derivation until the maximum registry TTL.
 * Aliases reference one bucket; rotation cannot clear counts or reservations. */
export class CountingKeyDeriver {
  #current: Buffer; #previous: { secret: Buffer; until: number } | undefined;
  readonly #clock: () => number; readonly #overlapMs: number;
  constructor(secret: Uint8Array = randomBytes(32), overlapMs = 1_200_000, clock: () => number = () => performance.now()) {
    if (secret.length !== 32 || overlapMs < 1_200_000) throw new Error("derivation_configuration_invalid");
    this.#current = Buffer.from(secret); this.#overlapMs = overlapMs; this.#clock = clock;
  }
  rotate(secret: Uint8Array): void {
    const now = this.#clock();
    if (secret.length !== 32 || (this.#previous && now < this.#previous.until)) throw new Error("rotation_overlap_active");
    this.#previous = { secret: this.#current, until: now + this.#overlapMs }; this.#current = Buffer.from(secret);
  }
  derive(r: ParameterRecord, context: VerifiedContext): string[] {
    if (!context.localCaller || r.safe_counting_key.derivation_version !== "hmac-sha256-v1") throw new Error("input_invalid");
    const values: string[] = [];
    for (const component of r.safe_counting_key.components) {
      let value: string | undefined;
      if (component === "exact_surface_id") value = r.surface_id;
      if (component === "verified_actor_id_v1") value = context.actorId;
      if (component === "privacy_network_cohort_v1") value = context.networkCohort;
      if (component === "server_issued_bootstrap_ceremony_id_v1") value = context.ceremonyId;
      // Stage/owner share a ceremony bucket so ordinary traffic and both reserved
      // completion stages jointly enforce the eight-unit ceiling.
      if (component === "bootstrap_stage_v1") value = "bootstrap-stage-pool-v1";
      if (component === "verified_primary_owner_id_v1") value = context.ceremonyId;
      if (typeof value !== "string" || !value.length || value.length > 256) throw new Error("input_invalid");
      values.push(value);
    }
    if (r.quota.unit === "bootstrap_stage_decision") {
      if (!context.ceremonyId || !context.bootstrapStage) throw new Error("input_invalid");
      if (context.bootstrapStage === "first_sign_in" && !context.credentialVerified) throw new Error("input_invalid");
      if (context.bootstrapStage === "initial_space_create" && (!context.primaryOwnerVerified || !context.actorId)) throw new Error("input_invalid");
    }
    const payload = canonical([r.counter_store.namespace, r.surface_id, values]);
    const secrets = [this.#current, ...(this.#previous && this.#clock() < this.#previous.until ? [this.#previous.secret] : [])];
    return secrets.map((secret) => createHmac("sha256", secret).update(payload).digest("hex"));
  }
}

/** True only for a record whose counting key is the verified actor after authentication, decided for that actor. */
export function actorOwnedBucket(record: ParameterRecord, context: VerifiedContext): boolean {
  return record.safe_counting_key.phase === "post_authentication" && record.safe_counting_key.subject_bound_after_authentication
    && record.safe_counting_key.components.includes("verified_actor_id_v1") && typeof context.actorId === "string" && context.actorId.length > 0;
}
export class RateLimitEngine {
  readonly #registry: Registry; readonly #registrations: readonly Registration[]; readonly #store: CounterStore;
  readonly #derivation: CountingKeyDeriver; readonly #timeoutMs: number;
  constructor(registry: Registry, registrations: readonly Registration[], store: CounterStore, deriver = new CountingKeyDeriver(), timeoutMs = 1_000) {
    this.#registry = { records: structuredClone(registry.records), approved: structuredClone(new Map(registry.approved)), diagnostics: structuredClone(registry.diagnostics), releaseSetDigest: registry.releaseSetDigest, approvalCurrent: registry.approvalCurrent };
    this.#registrations = structuredClone(registrations); this.#store = store; this.#derivation = deriver;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) throw new Error("counter_deadline_invalid"); this.#timeoutMs = timeoutMs;
  }
  get releaseSetDigest(): string { return this.#registry.releaseSetDigest; }
  async decide(input: { registrationId: string; surfaceId: string; parameterRecordId: string | null; releaseSetDigest: string; verifiedContext: VerifiedContext; requestOrJobUnit: number }): Promise<Decision> {
    const matches = this.#registrations.filter((r) => r.registration_id === input.registrationId && r.registration_lifecycle === "active");
    const r = matches[0]; if (matches.length !== 1 || !r || registrationErrors(r).length) return { outcome: "deny_unregistered" };
    if (input.surfaceId !== r.surface_id || input.parameterRecordId !== r.parameter_record_id || input.requestOrJobUnit !== 1) return { outcome: "deny_input_invalid" };
    // Exact public exceptions remain reachable without spending protected pools,
    // and independently of the release set: a malformed business record must
    // never lock health or OpenAPI out (contract section 9, CBD266-REVIEW-IMPL-001 finding 1).
    if (PUBLIC_SURFACES[r.registration_id] === r.surface_id) return { outcome: "allow", provenance: "exact-public-exception", release: async () => undefined };
    if (input.releaseSetDigest !== this.#registry.releaseSetDigest || this.#registry.diagnostics.length) return { outcome: "deny_policy_unavailable" };
    // CBD266-SURFACE-STAGES-001: the registration still names the surface's default (ordinary) record, but a
    // reserved bootstrap stage is always counted on the surface's record that owns that stage -- never on
    // whichever record the route happens to be registered against -- so a ceremony route registered to the
    // ordinary ceremony record still reserves its first-sign-in/initial-create unit on the bootstrap record.
    const stage = input.verifiedContext.bootstrapStage;
    const staged = stage && stage !== "ordinary" ? recordForStage(this.#registry, r.surface_id, stage) : undefined;
    const record = staged ?? (r.parameter_record_id ? this.#registry.approved.get(r.parameter_record_id) : undefined);
    if (!record || record.surface_id !== r.surface_id || !this.#registry.approvalCurrent(record)) return { outcome: "deny_policy_unavailable" };
    let keys: string[];
    try { keys = this.#derivation.derive(record, input.verifiedContext); } catch { return { outcome: "deny_input_invalid" }; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([this.#store.consume({ record, releaseSetDigest: input.releaseSetDigest, keys, unit: 1,
        ...(input.verifiedContext.bootstrapStage ? { bootstrapStage: input.verifiedContext.bootstrapStage } : {}) }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("counter_deadline")), this.#timeoutMs); })]);
      if (result.outcome === "exhausted") return { outcome: "deny_exhausted" };
      // EXEC-POV-C200F01-001 item 3 (SEC-C200-R01): the concurrency refusal is typed only when the record is
      // post-authentication and keyed on the verified actor, and this decision carries that actor -- the bucket
      // the caller is being refused from is the caller's own, so naming the reason discloses nothing about any
      // other actor, ceremony or cohort. A compound or pre-authentication record, or a call with no verified
      // actor, keeps the uniform `deny_exhausted`.
      if (result.outcome === "in_flight") return actorOwnedBucket(record, input.verifiedContext) ? { outcome: "deny_in_flight" } : { outcome: "deny_exhausted" };
      if (result.outcome !== "accepted" || result.provenance !== "single-process-linearizable:consume-v1" || typeof result.release !== "function") return { outcome: "deny_counter_unavailable" };
      return { outcome: "allow", provenance: result.provenance, release: result.release, ...(typeof result.refund === "function" ? { refund: result.refund } : {}) };
    } catch { return { outcome: "deny_counter_unavailable" }; } finally { clearTimeout(timer); }
  }
}
