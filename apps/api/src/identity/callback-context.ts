/**
 * The one implementation of "which origin did the browser address" and "is
 * this callback in the context its challenge was issued for" (GUARD-STAGES-F03).
 *
 * Three copies existed before this module. `observedOrigin` in
 * `identity/http.ts` derived the origin for the real callback handler; the
 * `contextValid` expression inside `IdentityCeremony#complete` decided whether
 * that callback may proceed; and `ceremonyContext` in `sessions/runtime.ts`
 * replicated both, because the rate-limit gate must predict -- before the
 * handler runs -- whether this request could reach credential verification and
 * therefore may draw the reserved first-sign-in unit (SEC-STAGES-F01). The
 * replica was written by a packet that could not edit these files, and it had
 * to be kept in step by hand: a change to either copy alone would silently
 * reopen a gap between what the gate predicts and what the ceremony accepts.
 *
 * Both callers now import from here, so a change is a change in both. The
 * accompanying test asserts that structurally as well as behaviourally: no
 * other file under apps/api/src may derive an origin from `x-forwarded-host`
 * or rebuild the context comparison out of its parts.
 *
 * The request shape is structural rather than `FastifyRequest` on purpose.
 * `IdentityCeremony` is transport-free -- it receives an already-derived
 * origin string -- so this module must not drag an HTTP framework into its
 * import graph.
 */
import { IDENTITY_CALLBACK_PATH } from "./config.ts";

/**
 * The loopback peers whose forwarding headers are honoured. The local proxy is
 * the only thing that can sit there; anything else reaches the process
 * directly and its Host header is already the truth.
 */
export const LOOPBACK_PEERS: readonly string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/** A host in `X-Forwarded-Host` shape: a hostname, optionally with a port. Anything else is ignored. */
const FORWARDED_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/iu;

/** The subset of a request this module reads. `FastifyRequest` satisfies it. */
export interface OriginObservable {
  readonly ip: string;
  readonly protocol: string;
  readonly host: string;
  readonly headers: Readonly<Record<string, unknown>>;
}

function headerValue(request: OriginObservable, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The origin the browser addressed. The application origin proxies `/v1` to
 * this process (the Next development server's rewrite; CBD-190 section 8 keeps
 * the ceremony origin distinct), and that proxy replaces the Host header with
 * its destination while carrying the browser's host in `X-Forwarded-Host`.
 * PROTO-ACTIVATION-001: the forwarded host and protocol are honoured only when
 * the TCP peer is the loopback interface -- the only place the local proxy can
 * live -- so the CBD-190 callback context check sees the origin the browser
 * navigated to. `trustProxy` stays off for everything else; a hosted deployment
 * needs its own reviewed proxy trust (reported as a finding).
 */
export function observedOrigin(request: OriginObservable): string {
  const forwardedHost = headerValue(request, "x-forwarded-host");
  if (forwardedHost && LOOPBACK_PEERS.includes(request.ip) && FORWARDED_HOST.test(forwardedHost)) {
    const forwardedProto = headerValue(request, "x-forwarded-proto");
    return `${forwardedProto === "https" ? "https" : "http"}://${forwardedHost}`;
  }
  return `${request.protocol}://${request.host}`;
}

/** What the request states about itself. `path` excludes the query string. */
export interface ObservedCallbackContext {
  readonly method: string;
  readonly path: string;
  readonly observedOrigin: string;
}

/** What the challenge was issued for. A stored challenge satisfies it. */
export interface IssuedCallbackContext {
  readonly callbackUri: string;
  readonly environmentId: string;
}

/**
 * CBD-190 section 7: the callback is in context only when it is the exact GET
 * on the exact callback path, the origin it was addressed on reconstructs the
 * challenge's own callback URI, and the challenge belongs to this environment.
 * Any other answer terminates the challenge in the ceremony and, in the
 * rate-limit gate, means the request counts as ordinary traffic instead of
 * drawing the reserved first-sign-in unit.
 */
export function callbackContextMatches(
  observed: ObservedCallbackContext,
  issued: IssuedCallbackContext,
  environmentId: string,
): boolean {
  return observed.method === "GET"
    && observed.path === IDENTITY_CALLBACK_PATH
    && `${observed.observedOrigin}${IDENTITY_CALLBACK_PATH}` === issued.callbackUri
    && issued.environmentId === environmentId;
}

/** The path half of a request URL, with any query string removed. */
export function requestPath(url: string): string {
  return url.split("?")[0] ?? url;
}
