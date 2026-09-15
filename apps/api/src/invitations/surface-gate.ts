/**
 * The invitation ceremony's pre-counter gate (PK-6; CBD-266 section 8.1;
 * `SEC-STAGES-F02` precedent from `apps/api/src/rate-limit/http.ts`).
 *
 * The three pre-authentication ceremony routes count on
 * `rlp-266-invitation-ceremony-v1` (`CBD266-INVITATION-RECORDS-001`), a
 * cohort-keyed pool every link holder in the local cohort shares. A
 * `verify-channel` or `decline` request that names no resolvable ceremony --
 * a malformed ceremony id, no ceremony cookie, or an id no row carries -- names
 * nothing a real, in-flight ceremony needs, and would otherwise still spend
 * the shared ordinary pool a real ceremony's own verify and decline traffic
 * draws from. Exactly as the identity callback routes deny an unknown or
 * missing `state` before any counter is touched, this gate denies such a
 * request as `deny_input_invalid` ahead of the inner gate, so a flood of
 * unresolvable requests can never exhaust the pool a valid ceremony needs to
 * complete. `resolve` has no ceremony yet (the ceremony is what it creates),
 * so it passes straight to the inner gate, as the identity `begin` does.
 *
 * The resolution is location only -- one primary-key read through the same
 * closed statement the fact reader uses -- and decides nothing: the ceremony
 * secret, the environment, the state and the expiry are all compared inside
 * the route's own transaction afterwards. It is the same class of pre-counter
 * read the session gate already performs for every authenticated route.
 */
import type { FastifyRequest } from "fastify";
import type { ApiSurfaceGate } from "../rate-limit/http.js";
import type { CeremonyLocator } from "../sessions/budget-facts.ts";
import { readInvitationCeremonyCookie } from "./cookie.ts";

export const INVITATION_CEREMONY_RECORD_ID = "rlp-266-invitation-ceremony-v1";
const RESOLVE_ROUTE = "/v1/invitations/resolve";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function cookieHeader(request: FastifyRequest): string | undefined {
  const value = request.headers.cookie;
  return typeof value === "string" ? value : undefined;
}

/** True when the request names a ceremony that exists: a well-formed id, a well-formed cookie, and a row behind the id. */
export async function namesResolvableCeremony(request: FastifyRequest, locate: CeremonyLocator): Promise<boolean> {
  const ceremonyId = (request.params as Record<string, unknown> | undefined)?.ceremonyId;
  if (typeof ceremonyId !== "string" || !UUID.test(ceremonyId)) return false;
  if (!readInvitationCeremonyCookie(cookieHeader(request))) return false;
  return (await locate(ceremonyId.toLowerCase())) !== null;
}

export function invitationSurfaceGate(inner: ApiSurfaceGate, locate: CeremonyLocator): ApiSurfaceGate {
  const gate: ApiSurfaceGate = {
    evidence: (request) => inner.evidence(request),
    enforce: async (request, actorId) => {
      const evidence = inner.evidence(request);
      if (evidence.parameter_record_id === INVITATION_CEREMONY_RECORD_ID && request.routeOptions.url !== RESOLVE_ROUTE) {
        if (!await namesResolvableCeremony(request, locate)) return { outcome: "deny_input_invalid" };
      }
      return inner.enforce(request, actorId);
    },
  };
  if (inner.reserved) {
    const reserved = inner.reserved.bind(inner);
    return { ...gate, reserved };
  }
  return gate;
}
