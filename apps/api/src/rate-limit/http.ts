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
    const local = LOOPBACK.includes(request.ip);
    // PROTO-ACTIVATION-001: the identity ceremony surfaces (surf-266-authentication) are bound to the approved
    // bootstrap record (proto-bootstrap-v1), whose counting key is a server-issued ceremony plus stage. The
    // local prototype observes one network cohort (loopback) and issues no ceremony identifier before `begin`
    // runs, so the ceremony dimension is the loopback cohort on the exact registered surface and every request
    // is an `ordinary` stage decision: the record's six ordinary units per window bound each ceremony route for
    // the single local cohort, and the two reserved completion units are never consumed here. This is a
    // prototype projection of the approved record, reported as a substitution; it changes no parameter value.
    const ceremony = local && evidence.surface_id === "surf-266-authentication" ? { ceremonyId: `loopback:${evidence.registration_id}`, bootstrapStage: "ordinary" as const } : {};
    return this.#engine.decide({ registrationId: evidence.registration_id, surfaceId: evidence.surface_id ?? "", parameterRecordId: evidence.parameter_record_id,
      releaseSetDigest: evidence.release_set_digest, requestOrJobUnit: 1,
      // The pre-authentication cohort is the direct loopback transport itself (never a forwarded header):
      // the only network cohort a single local prototype process can observe (privacy_network_cohort_v1).
      verifiedContext: { ...(actorId ? { actorId } : {}), localCaller: local, ...(local ? { networkCohort: "loopback" } : {}), ...ceremony },
    });
  }
}
