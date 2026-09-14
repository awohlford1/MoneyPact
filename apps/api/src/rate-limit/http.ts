import type { FastifyRequest } from "fastify";
import { apiIdentity, InProcessCounterStore, loadPrototypeRegistry, loadRegistrations, RateLimitEngine, invocation } from "../../../../packages/rate-limit/src/index.ts";
import type { Decision, EnforcementEvidence, Registration } from "../../../../packages/rate-limit/src/index.ts";

const LOOPBACK: readonly string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
export interface ApiSurfaceGate {
  evidence(request: FastifyRequest): EnforcementEvidence;
  enforce(request: FastifyRequest, actorId: string | undefined): Promise<Decision>;
}
export class ApiRateLimits implements ApiSurfaceGate {
  readonly #engine: RateLimitEngine; readonly #registrations: readonly Registration[]; readonly #build: string;
  readonly #evidence = new WeakMap<object, EnforcementEvidence>();
  constructor(build: string, registry = loadPrototypeRegistry(), registrations = loadRegistrations(), store = new InProcessCounterStore()) {
    this.#engine = new RateLimitEngine(registry, registrations, store); this.#registrations = registrations; this.#build = build;
  }
  evidence(request: FastifyRequest): EnforcementEvidence {
    const existing = this.#evidence.get(request); if (existing) return existing;
    const id = apiIdentity(request.method, request.routeOptions.url ?? "/");
    const registration = this.#registrations.find((r) => r.registration_id === id && r.registration_lifecycle === "active");
    const evidence = { ...invocation(id, "api_route", this.#engine.releaseSetDigest, this.#build), surface_id: registration?.surface_id ?? null, parameter_record_id: registration?.parameter_record_id ?? null };
    this.#evidence.set(request, evidence); return evidence;
  }
  async enforce(request: FastifyRequest, actorId: string | undefined): Promise<Decision> {
    const evidence = this.evidence(request);
    return this.#engine.decide({ registrationId: evidence.registration_id, surfaceId: evidence.surface_id ?? "", parameterRecordId: evidence.parameter_record_id,
      releaseSetDigest: evidence.release_set_digest, requestOrJobUnit: 1,
      // The pre-authentication cohort is the direct loopback transport itself (never a forwarded header):
      // the only network cohort a single local prototype process can observe (privacy_network_cohort_v1).
      verifiedContext: { ...(actorId ? { actorId } : {}), localCaller: LOOPBACK.includes(request.ip), ...(LOOPBACK.includes(request.ip) ? { networkCohort: "loopback" } : {}) },
    });
  }
}
