import type { FastifyRequest } from "fastify";
import { apiIdentity, InProcessCounterStore, loadPrototypeRegistry, loadRegistrations, RateLimitEngine, invocation } from "../../../../packages/rate-limit/src/index.ts";
import type { Decision, EnforcementEvidence, Registration, VerifiedContext } from "../../../../packages/rate-limit/src/index.ts";

/**
 * PROTO-ACTIVATION-001 A7 (review R04, SEC-ACT-F03): the identity runtime supplies the bootstrap record's
 * ceremony context from its own stores -- the server-issued ceremony id behind a callback/authorize state or
 * a chooser request, the ceremony that signed the acting subject in for the initial `space.create`
 * reservation -- never from a request field taken at face value. A route with no resolvable ceremony
 * yields nothing, and the bootstrap record then denies as `deny_input_invalid`.
 */
export type CeremonyContextResolver = (request: FastifyRequest, actorId: string | undefined) => Promise<Pick<VerifiedContext, "ceremonyId" | "bootstrapStage" | "credentialVerified" | "primaryOwnerVerified">>;

const LOOPBACK: readonly string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
export interface ApiSurfaceGate {
  evidence(request: FastifyRequest): EnforcementEvidence;
  enforce(request: FastifyRequest, actorId: string | undefined): Promise<Decision>;
  /**
   * PROTO-ACTIVATION-001 B1 (review R2-02, SEC-ACT-R2-F02): true when this request's unit would be one of the
   * bootstrap record's *reserved* units (a stage other than `ordinary`). The contract routes a reserved unit only
   * to the eligible effect of the valid ceremony (section 4.7 `proto-bootstrap-v1`), so the guard consumes it
   * only once the session gate, the CSRF check, the replay lookup and the locator validation have succeeded --
   * a denied attempt spends nothing reserved. PROTO-QA-FIXES-001 F1: an attempt admitted past those gates but
   * denied inside its effect (proposal_not_current, confirmation_stale) is refunded through the decision's
   * `refund`, exactly once, so only a committed effect keeps the ceremony's reserved unit.
   */
  reserved?(request: FastifyRequest, actorId: string | undefined): Promise<boolean>;
}
export class ApiRateLimits implements ApiSurfaceGate {
  readonly #engine: RateLimitEngine; readonly #registrations: readonly Registration[]; readonly #build: string;
  readonly #evidence = new WeakMap<object, EnforcementEvidence>();
  readonly #ceremony: CeremonyContextResolver | undefined;
  readonly #contexts = new WeakMap<object, Promise<Awaited<ReturnType<CeremonyContextResolver>>>>();
  constructor(build: string, registry = loadPrototypeRegistry(), registrations = loadRegistrations(), store = new InProcessCounterStore(), ceremony?: CeremonyContextResolver) {
    this.#engine = new RateLimitEngine(registry, registrations, store); this.#registrations = registrations; this.#build = build; this.#ceremony = ceremony;
  }
  evidence(request: FastifyRequest): EnforcementEvidence {
    const existing = this.#evidence.get(request); if (existing) return existing;
    const id = apiIdentity(request.method, request.routeOptions.url ?? "/");
    const registration = this.#registrations.find((r) => r.registration_id === id && r.registration_lifecycle === "active");
    const evidence = { ...invocation(id, "api_route", this.#engine.releaseSetDigest, this.#build), surface_id: registration?.surface_id ?? null, parameter_record_id: registration?.parameter_record_id ?? null };
    this.#evidence.set(request, evidence); return evidence;
  }
  /**
   * A7; CBD266-SURFACE-STAGES-001: every route on the authentication surface gets its ceremony and stage
   * from the identity runtime (resolved once per request), whether it is registered to the bootstrap
   * record or -- now that a stage set can share the surface with it -- the ordinary ceremony record. The
   * resolved stage decides which of the two approved records actually counts the unit (packages/rate-limit
   * `recordForStage`), never the static registration alone.
   */
  #ceremonyFor(request: FastifyRequest, actorId: string | undefined): Promise<Awaited<ReturnType<CeremonyContextResolver>>> {
    const evidence = this.evidence(request);
    if (!LOOPBACK.includes(request.ip) || evidence.surface_id !== "surf-266-authentication" || !this.#ceremony) return Promise.resolve({});
    let pending = this.#contexts.get(request);
    if (!pending) { pending = this.#ceremony(request, actorId); this.#contexts.set(request, pending); }
    return pending;
  }
  async reserved(request: FastifyRequest, actorId: string | undefined): Promise<boolean> {
    const ceremony = await this.#ceremonyFor(request, actorId);
    return ceremony.bootstrapStage !== undefined && ceremony.bootstrapStage !== "ordinary";
  }
  async enforce(request: FastifyRequest, actorId: string | undefined): Promise<Decision> {
    const evidence = this.evidence(request);
    const local = LOOPBACK.includes(request.ip);
    const ceremony = await this.#ceremonyFor(request, actorId);
    // PROTO-GUARD-STAGES-SEC-001 SEC-STAGES-F02: a request on the authentication surface's ordinary
    // ceremony-record routes (authorize, chooser, callback) that resolves no ceremony at all -- an unknown
    // or missing state -- names no counting dimension the ceremony record's derivation actually needs, so
    // it would otherwise still consume the same shared ordinary pool a real, in-flight ceremony's own
    // authorize/chooser/callback traffic draws from. Deny it here, before any counter is touched, so a
    // flood of unresolvable requests can never exhaust the pool a valid ceremony needs to complete. A
    // reserved-stage route (bootstrap-registered: begin, confirm) is unaffected -- its own record already
    // fails closed on a missing ceremony id (CountingKeyDeriver#derive, quota.unit "bootstrap_stage_decision").
    if (evidence.surface_id === "surf-266-authentication" && evidence.parameter_record_id !== "rlp-266-bootstrap-v1" && !ceremony.ceremonyId) {
      return { outcome: "deny_input_invalid" };
    }
    return this.#engine.decide({ registrationId: evidence.registration_id, surfaceId: evidence.surface_id ?? "", parameterRecordId: evidence.parameter_record_id,
      releaseSetDigest: evidence.release_set_digest, requestOrJobUnit: 1,
      // The pre-authentication cohort is the direct loopback transport itself (never a forwarded header):
      // the only network cohort a single local prototype process can observe (privacy_network_cohort_v1).
      verifiedContext: { ...(actorId ? { actorId } : {}), localCaller: local, ...(local ? { networkCohort: "loopback" } : {}), ...ceremony },
    });
  }
}
