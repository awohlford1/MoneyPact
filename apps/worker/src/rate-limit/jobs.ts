import { InProcessCounterStore, invocation, loadPrototypeRegistry, loadRegistrations, RateLimitEngine } from "../../../../packages/rate-limit/src/index.ts";
import type { Decision, EnforcementEvidence, Registration } from "../../../../packages/rate-limit/src/index.ts";

export interface WorkerSurfaceGate {
  evidence(jobType: string): EnforcementEvidence;
  enforce(jobType: string, verifiedProducer: unknown): Promise<Decision>;
}
export class WorkerRateLimits implements WorkerSurfaceGate {
  readonly #engine: RateLimitEngine; readonly #registrations: readonly Registration[]; readonly #build: string;
  constructor(build: string, registry = loadPrototypeRegistry(), registrations = loadRegistrations()) {
    this.#engine = new RateLimitEngine(registry, registrations, new InProcessCounterStore()); this.#registrations = registrations; this.#build = build;
  }
  evidence(jobType: string): EnforcementEvidence {
    const id = `job:worker:${jobType}:1`;
    const r = this.#registrations.find((item) => item.registration_id === id && item.registration_lifecycle === "active");
    return { ...invocation(id, "worker_job", this.#engine.releaseSetDigest, this.#build), surface_id: r?.surface_id ?? null, parameter_record_id: r?.parameter_record_id ?? null };
  }
  async enforce(jobType: string, _verifiedProducer: unknown): Promise<Decision> {
    const e = this.evidence(jobType);
    // No worker/service class is approved by the four API-only prototype sets.
    return this.#engine.decide({ registrationId: e.registration_id, surfaceId: e.surface_id ?? "", parameterRecordId: e.parameter_record_id,
      releaseSetDigest: e.release_set_digest, requestOrJobUnit: 1, verifiedContext: { localCaller: false } });
  }
}
