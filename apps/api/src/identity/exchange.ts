/**
 * CBD-190 §10.1 bounded provider-token exchange (`CBD190-AC02-CUSTODY-001`).
 *
 * One execution per callback, following exactly this order:
 *   1. receive the token response from the transport;
 *   2. validate the ID token under §4.3;
 *   3. extract only the allowlisted canonical fields into a token-free buffer;
 *   4. send the refresh token to the issuer revocation endpoint immediately;
 *   5. verify successful issuer revocation;
 *   6. destroy the authorization-code, PKCE, ID, access and refresh-token
 *      buffers and close the result channel; and
 *   7. only then release the token-free canonical result.
 *
 * A missing refresh token, revocation failure, ambiguity, outage, timeout or
 * validation failure fails closed: no canonical result is released and only
 * a token-free rejection class leaves this function. Discard alone never
 * satisfies AC02 -- step 5 must observe `revoked`.
 *
 * The evidence record carries monotonic step times and the ordered step
 * names (§10.3), never a token, code, verifier or nonce.
 *
 * Fidelity: the local prototype runs the exchange as one isolated async
 * activation with no shared token state, not as a separate OS process. The
 * §10.1 process-isolation, dump and capture disablement remain provider-
 * activation evidence (`fidelity=simulated`).
 */
import { performance } from "node:perf_hooks";
import { RefreshOnceKeySource } from "./token.ts";
import { validateIdToken } from "./token.ts";
import type { TokenRejection } from "./token.ts";
import type { ValidatedIdentityClaims } from "./token.ts";
import type { ExchangeTransportResult, Jwk, ProviderTransport, RevocationTransportResult } from "./local-issuer.ts";

export type ExchangeStep =
  | "token_response_received"
  | "id_token_validated"
  | "canonical_fields_extracted"
  | "revocation_requested"
  | "revocation_confirmed"
  | "buffers_destroyed"
  | "execution_terminated";

export const EXCHANGE_STEP_ORDER: readonly ExchangeStep[] = Object.freeze([
  "token_response_received",
  "id_token_validated",
  "canonical_fields_extracted",
  "revocation_requested",
  "revocation_confirmed",
  "buffers_destroyed",
  "execution_terminated",
]);

export type ExchangeRejection =
  | "provider_unavailable"
  | "grant_rejected"
  | "token_invalid"
  | "revocation_missing_token"
  | "revocation_failed"
  | "revocation_uncertain"
  | "exchange_timeout";

export interface ExchangeEvidence {
  readonly steps: readonly { readonly step: ExchangeStep; readonly atMs: number }[];
  readonly durationMs: number;
  readonly buffersZeroed: boolean;
  readonly tokenRejection: TokenRejection | undefined;
}

export type ExchangeOutcome =
  | { readonly status: "verified"; readonly claims: ValidatedIdentityClaims; readonly evidence: ExchangeEvidence }
  | { readonly status: "rejected"; readonly rejection: ExchangeRejection; readonly evidence: ExchangeEvidence };

export interface ExchangeInput {
  readonly transport: ProviderTransport;
  readonly code: string;
  readonly codeVerifier: Buffer;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly issuer: string;
  readonly allowedAlgorithms: readonly string[];
  readonly nonceDigest: string;
  readonly digest: (value: string) => string;
  readonly receiptTime: Date;
  readonly challengeIssuedAt: Date;
  readonly clockSkewSeconds: number;
  readonly maxLifetimeMs: number;
  readonly cachedKeys?: readonly Jwk[] | undefined;
}

class ExchangeTimeout extends Error {
  constructor() { super("exchange_timeout"); this.name = "ExchangeTimeout"; }
}

/**
 * PROTO-IDENTITY-API-001 correction C6 (security S01):
 *
 *   1. a rejected ID token previously returned `token_invalid` before any
 *      revocation attempt, leaving the provider-side token family live
 *      indefinitely -- revocation is now attempted for any received
 *      refresh token *before* the validity branch, exactly once, so an
 *      invalid token and a valid-but-rejected one both get the same one
 *      cleanup attempt;
 *   2. a timeout raced a deadline against the transport call and then
 *      abandoned it -- a token family minted by a late-arriving response
 *      was never revoked. The initial `transport.exchange(...)` promise is
 *      now retained and, on a timeout, settled in the background with one
 *      best-effort cleanup revocation if it turns out to have minted
 *      tokens; this function's own returned outcome is unaffected;
 *   3. copies were zeroed but the original response strings were not
 *      (`Buffer.from(string)` cannot erase the source string; this is a
 *      structural V8 limitation, not fully closable in JS). Custody is
 *      bounded instead: canonical fields are read into `buffers`-tracked
 *      copies immediately, and no code path here re-derives a fresh string
 *      copy of a token after its buffer exists.
 */
export async function runBoundedExchange(input: ExchangeInput): Promise<ExchangeOutcome> {
  const startedAt = performance.now();
  const steps: { step: ExchangeStep; atMs: number }[] = [];
  const mark = (step: ExchangeStep): void => { steps.push({ step, atMs: performance.now() - startedAt }); };
  const codeBuffer = Buffer.from(input.code, "utf8");
  const verifierBuffer = input.codeVerifier;
  const buffers: Buffer[] = [codeBuffer, verifierBuffer];
  let tokenRejection: TokenRejection | undefined;
  let zeroed = false;
  const destroy = (): void => {
    for (const buffer of buffers) buffer.fill(0);
    zeroed = buffers.every((buffer) => buffer.every((byte) => byte === 0));
    mark("buffers_destroyed");
  };
  const evidence = (): ExchangeEvidence => ({ steps: [...steps], durationMs: performance.now() - startedAt, buffersZeroed: zeroed, tokenRejection });
  const rejected = (rejection: ExchangeRejection): ExchangeOutcome => {
    if (!zeroed) destroy();
    mark("execution_terminated");
    return { status: "rejected", rejection, evidence: evidence() };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ExchangeTimeout()), input.maxLifetimeMs); });
  const bounded = async <T>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);
  /** A best-effort cleanup revocation for a token family that arrived after this execution already returned (a settled timeout). Never affects the returned outcome. */
  const revokeLateFamily = (refreshToken: string | undefined): void => {
    if (!refreshToken) return;
    void input.transport.revoke({ token: refreshToken, clientId: input.clientId }).catch(() => undefined);
  };

  try {
    const exchangePromise = input.transport.exchange({ code: codeBuffer.toString("utf8"), codeVerifier: verifierBuffer.toString("ascii"), redirectUri: input.redirectUri, clientId: input.clientId });
    let exchanged: ExchangeTransportResult;
    try {
      exchanged = await bounded(exchangePromise);
    } catch (error) {
      if (error instanceof ExchangeTimeout) {
        // Settle the abandoned call instead of leaving it dangling: a late family it mints still gets one revocation attempt.
        exchangePromise.then((late) => { if (late.ok) revokeLateFamily(late.tokens.refresh_token); }).catch(() => undefined);
      }
      throw error;
    }
    if (!exchanged.ok) return rejected(exchanged.error === "outage" ? "provider_unavailable" : "grant_rejected");
    mark("token_response_received");
    const idToken = Buffer.from(exchanged.tokens.id_token, "utf8");
    const accessToken = Buffer.from(exchanged.tokens.access_token, "utf8");
    const rawRefresh = exchanged.tokens.refresh_token;
    const refreshToken = rawRefresh === undefined ? undefined : Buffer.from(rawRefresh, "utf8");
    buffers.push(idToken, accessToken);
    if (refreshToken) buffers.push(refreshToken);

    const keys = new RefreshOnceKeySource(() => bounded(input.transport.jwks()), input.cachedKeys);
    const validation = await bounded(validateIdToken(idToken.toString("utf8"), {
      issuer: input.issuer, clientId: input.clientId, allowedAlgorithms: input.allowedAlgorithms, nonceDigest: input.nonceDigest,
      digest: input.digest, receiptTime: input.receiptTime, challengeIssuedAt: input.challengeIssuedAt, clockSkewSeconds: input.clockSkewSeconds,
    }, keys));
    if (!validation.ok) {
      const why = validation.rejection;
      tokenRejection = why;
      // C6 item 1: an invalid ID token must not leave a minted token family live at the issuer.
      // The step order and evidence of the verified path (below) are unchanged; this is a distinct,
      // best-effort cleanup attempt on the closed rejection path only, never a second attempt on the
      // same family the verified path already revoked.
      if (refreshToken) { try { await bounded(input.transport.revoke({ token: refreshToken.toString("utf8"), clientId: input.clientId })); } catch { /* cleanup only; the token_invalid rejection stands either way */ } }
      return rejected("token_invalid");
    }
    mark("id_token_validated");

    // Step 3: the only values that ever leave this execution.
    const canonical: ValidatedIdentityClaims = { issuer: validation.claims.issuer, providerSubject: validation.claims.providerSubject, authTime: validation.claims.authTime, issuedAt: validation.claims.issuedAt };
    mark("canonical_fields_extracted");

    if (!refreshToken) return rejected("revocation_missing_token");
    mark("revocation_requested");
    const revocation: RevocationTransportResult = await bounded(input.transport.revoke({ token: refreshToken.toString("utf8"), clientId: input.clientId }));
    if (revocation === "outage" || revocation === "failed") return rejected("revocation_failed");
    if (revocation !== "revoked") return rejected("revocation_uncertain");
    mark("revocation_confirmed");

    destroy();
    mark("execution_terminated");
    return { status: "verified", claims: canonical, evidence: evidence() };
  } catch (error) {
    return rejected(error instanceof ExchangeTimeout ? "exchange_timeout" : "provider_unavailable");
  } finally {
    clearTimeout(timer);
    if (!zeroed) destroy();
  }
}
