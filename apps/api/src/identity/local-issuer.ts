/**
 * CBD-190 §8 local Cognito-shaped issuer (`PROVIDERS-LOCAL-001`).
 *
 * A replaceable infrastructure adapter, not a second identity contract. It
 * emulates the observable ports the production adapter depends on --
 * authorization-code callback shapes, one-time codes, PKCE S256, nonce
 * binding, expiry, RS256 compact JWTs with rotating `kid`, Cognito's
 * `token_use=id` claim shape, immutable opaque `sub` across first and repeat
 * use, and deterministic negative scenarios -- while stubbing branding,
 * e-mail, MFA and every other §8.2 item. Every result it produces carries
 * `FIDELITY_LABEL = "simulated"` (from `@cobudget/sessions`) in test
 * evidence and never in customer-visible output.
 *
 * The transport seam is `ProviderTransport`: the bounded exchange
 * (`exchange.ts`) speaks only to that interface, so the same parser and
 * validator run unchanged against this in-process issuer and, after a
 * separately authorized activation, against an HTTPS transport. Nothing in
 * `exchange.ts` or `token.ts` branches on which transport is in use (§9).
 *
 * Forbidden shortcuts (§8.3) are structurally absent: there is no way to
 * hand the mapping layer a caller-supplied subject, `sub` is never an
 * e-mail, no unsigned token is accepted by the validator, and the local
 * issuer never issues an application session -- it only returns provider
 * tokens that the exchange then revokes and destroys.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { FIDELITY_LABEL } from "@cobudget/sessions";

export interface TokenResponse {
  readonly id_token: string;
  readonly access_token: string;
  readonly refresh_token: string | undefined;
  readonly token_type: "Bearer";
  readonly expires_in: number;
}

export type ExchangeTransportResult =
  | { readonly ok: true; readonly tokens: TokenResponse }
  | { readonly ok: false; readonly error: "invalid_grant" | "invalid_client" | "outage" };

export type RevocationTransportResult = "revoked" | "failed" | "ambiguous" | "outage";

export interface Jwk {
  readonly kty: string;
  readonly kid: string;
  readonly use?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
}

/** The declared network seam (§9): the only thing a fixture or local adapter may replace. */
export interface ProviderTransport {
  exchange(input: { readonly code: string; readonly codeVerifier: string; readonly redirectUri: string; readonly clientId: string }): Promise<ExchangeTransportResult>;
  revoke(input: { readonly token: string; readonly clientId: string }): Promise<RevocationTransportResult>;
  jwks(): Promise<{ readonly keys: readonly Jwk[] } | undefined>;
}

export const HUMAN_SCENARIOS = Object.freeze(["subject-a", "subject-b", "cancel", "deny", "verification-pending", "outage"] as const);
export const NEGATIVE_TOKEN_SCENARIOS = Object.freeze([
  "bad-signature", "wrong-issuer", "wrong-audience", "expired-token", "future-token", "nonce-mismatch",
  "unknown-kid",
  "alg-none",
  "alg-hs256",
  "malformed-token",
  "missing-sub",
  "use-not-id",
  "no-refresh",
] as const);
export type LocalScenario = (typeof HUMAN_SCENARIOS)[number] | (typeof NEGATIVE_TOKEN_SCENARIOS)[number];
const ALL_SCENARIOS: readonly string[] = [...HUMAN_SCENARIOS, ...NEGATIVE_TOKEN_SCENARIOS];

export function isLocalScenario(value: unknown): value is LocalScenario {
  return typeof value === "string" && ALL_SCENARIOS.includes(value);
}

export type AuthorizeResult =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly error: "invalid_request" | "unauthorized_client" | "unsupported_response_type" | "invalid_scope"; readonly redirectUri: string | undefined; readonly state: string | undefined };

interface PendingAuthorization {
  readonly requestId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly expiresAt: number;
  used: boolean;
}

interface IssuedCode {
  readonly code: string;
  readonly redirectUri: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly scenario: LocalScenario;
  /** The signing key current when the code was issued; a key retired before redemption yields a stale-`kid` token. */
  readonly signingKey: SigningKey;
  readonly expiresAt: number;
  used: boolean;
}

/**
 * PROTO-IDENTITY-API-001 correction C6 (security S01): a token family
 * previously stored the raw access/refresh token strings in this
 * process-lifetime array, so custody was unbounded even after revocation.
 * Only one-way digests are kept -- enough to recognize a presented token
 * for revocation and post-revocation probing, never enough to reconstruct
 * it.
 */
interface TokenFamily {
  readonly accessTokenDigest: string;
  readonly refreshTokenDigest: string;
  revoked: boolean;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

interface SigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly jwk: Jwk;
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT_SCENARIOS: Readonly<Record<string, string>> = Object.freeze({ "subject-a": "a", "subject-b": "b" });

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** Deterministic synthetic subjects so a repeat local ceremony maps to the same immutable `sub` across process restarts (§8.1 item 5). */
function syntheticSubject(issuer: string, label: string): string {
  return `local-${createHash("sha256").update(`${issuer}\u0000${label}`).digest("base64url").slice(0, 32)}`;
}

function generateSigningKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const exported = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  return { kid, privateKey, jwk: { kty: exported.kty, kid, use: "sig", alg: "RS256", n: exported.n, e: exported.e } };
}

export interface LocalIssuerOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly callbackUri: string;
  readonly now?: () => Date;
  readonly codeLifetimeMs?: number;
  readonly tokenLifetimeSeconds?: number;
}

export class LocalIssuer implements ProviderTransport {
  readonly fidelity = FIDELITY_LABEL;
  readonly issuer: string;
  readonly clientId: string;
  readonly callbackUri: string;
  readonly #now: () => Date;
  readonly #codeLifetimeMs: number;
  readonly #lifetimeSeconds: number;
  readonly #pending: Record<string, PendingAuthorization | undefined> = Object.create(null);
  readonly #codes: Record<string, IssuedCode | undefined> = Object.create(null);
  readonly #families: TokenFamily[] = [];
  #keys: SigningKey[] = [];
  #retired: SigningKey[] = [];
  #tokenEndpoint: "ok" | "outage" = "ok";
  #revocation: "ok" | "fail" | "ambiguous" | "outage" = "ok";
  #jwksEndpoint: "ok" | "outage" = "ok";
  readonly revocations: string[] = [];
  readonly egress: { readonly destination: "token" | "revocation" | "jwks"; readonly at: Date }[] = [];

  constructor(options: LocalIssuerOptions) {
    this.issuer = options.issuer;
    this.clientId = options.clientId;
    this.callbackUri = options.callbackUri;
    this.#now = options.now ?? (() => new Date());
    this.#codeLifetimeMs = options.codeLifetimeMs ?? 300_000;
    this.#lifetimeSeconds = options.tokenLifetimeSeconds ?? 3_600;
  }

  #currentKey(): SigningKey {
    if (this.#keys.length === 0) this.#keys.push(generateSigningKey());
    return this.#keys[this.#keys.length - 1]!;
  }

  /** §8.1 item 4: rotating `kid`. The previous key stays published until `retireOldKeys()`. */
  rotateSigningKey(): string {
    this.#currentKey();
    const key = generateSigningKey();
    this.#keys.push(key);
    return key.kid;
  }

  /** Simulates the issuer dropping a retired key from JWKS (stale-key fail-closed path). */
  retireOldKeys(): void {
    const current = this.#currentKey();
    this.#retired = this.#keys.filter((key) => key !== current);
    this.#keys = [current];
  }

  setTokenEndpoint(mode: "ok" | "outage"): void { this.#tokenEndpoint = mode; }
  setRevocation(mode: "ok" | "fail" | "ambiguous" | "outage"): void { this.#revocation = mode; }
  setJwksEndpoint(mode: "ok" | "outage"): void { this.#jwksEndpoint = mode; }

  subjectFor(scenario: "subject-a" | "subject-b"): string {
    return syntheticSubject(this.issuer, SUBJECT_SCENARIOS[scenario]!);
  }

  /**
   * The hosted authorization endpoint (§4.1 receiving side). Exact `client_id`,
   * exact `redirect_uri`, `response_type=code`, PKCE S256 and exactly the
   * `openid` scope are required; anything else is a provider-declared error.
   */
  authorize(query: Readonly<Record<string, string | string[] | undefined>>): AuthorizeResult {
    const single = (key: string): string | undefined => {
      const value = query[key];
      return typeof value === "string" && value.length > 0 && value.length <= 2_048 ? value : undefined;
    };
    const redirectUri = single("redirect_uri");
    const state = single("state");
    const failure = (error: Exclude<AuthorizeResult, { ok: true }>["error"]): AuthorizeResult => ({ ok: false, error, redirectUri: redirectUri === this.callbackUri ? redirectUri : undefined, state });
    if (single("client_id") !== this.clientId) return failure("unauthorized_client");
    if (redirectUri !== this.callbackUri) return failure("invalid_request");
    if (single("response_type") !== "code") return failure("unsupported_response_type");
    if (single("scope") !== "openid") return failure("invalid_scope");
    const codeChallenge = single("code_challenge");
    const nonce = single("nonce");
    if (single("code_challenge_method") !== "S256" || !codeChallenge || !CODE_PATTERN.test(codeChallenge) || !state || !nonce) return failure("invalid_request");
    const requestId = randomBytes(24).toString("base64url");
    this.#pending[requestId] = { requestId, redirectUri, state, nonce, codeChallenge, expiresAt: this.#now().getTime() + this.#codeLifetimeMs, used: false };
    return { ok: true, requestId };
  }

  /** The synthetic chooser's selection: returns the exact callback navigation for `scenario`, or `undefined` for an unknown/used request. */
  /** PROTO-ACTIVATION-001 A7: the raw state of a pending hosted request, so the chooser route's rate-limit context can name its ceremony. */
  stateOf(requestId: string): string | undefined {
    const pending = this.#pending[requestId];
    return pending && !pending.used && pending.expiresAt > this.#now().getTime() ? pending.state : undefined;
  }

  choose(requestId: string, scenario: LocalScenario): string | undefined {
    const pending = this.#pending[requestId];
    if (!pending || pending.used || pending.expiresAt <= this.#now().getTime()) return undefined;
    pending.used = true;
    delete this.#pending[requestId];
    const target = new URL(pending.redirectUri);
    const providerError = scenario === "cancel" ? "access_denied" : scenario === "deny" ? "unauthorized_client" : scenario === "verification-pending" ? "interaction_required" : scenario === "outage" ? "server_error" : undefined;
    if (providerError) {
      target.searchParams.set("error", providerError);
      target.searchParams.set("error_description", "synthetic local scenario; diagnostic only");
      target.searchParams.set("state", pending.state);
      return target.toString();
    }
    const code = randomBytes(32).toString("base64url");
    this.#codes[code] = { code, redirectUri: pending.redirectUri, nonce: pending.nonce, codeChallenge: pending.codeChallenge, scenario, signingKey: this.#currentKey(), expiresAt: this.#now().getTime() + this.#codeLifetimeMs, used: false };
    target.searchParams.set("code", code);
    target.searchParams.set("state", pending.state);
    return target.toString();
  }

  #signedToken(header: Record<string, unknown>, payload: Record<string, unknown>, key: SigningKey | "garbage" | "none"): string {
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    if (key === "none") return `${signingInput}.`;
    if (key === "garbage") return `${signingInput}.${base64url(randomBytes(256))}`;
    return `${signingInput}.${sign("sha256", Buffer.from(signingInput, "ascii"), key.privateKey).toString("base64url")}`;
  }

  #idToken(issued: IssuedCode): string {
    const now = Math.floor(this.#now().getTime() / 1000);
    const key = issued.signingKey;
    const scenario = issued.scenario;
    const subjectScenario = scenario === "subject-b" ? "b" : "a";
    const payload: Record<string, unknown> = {
      iss: scenario === "wrong-issuer" ? `${this.issuer}-other` : this.issuer,
      sub: syntheticSubject(this.issuer, subjectScenario),
      aud: scenario === "wrong-audience" ? `${this.clientId}-other` : this.clientId,
      token_use: scenario === "use-not-id" ? "access" : "id",
      auth_time: now,
      iat: scenario === "future-token" ? now + 3_600 : now,
      exp: scenario === "expired-token" ? now - 60 : now + this.#lifetimeSeconds,
      nonce: scenario === "nonce-mismatch" ? randomBytes(32).toString("base64url") : issued.nonce,
      jti: randomUUID(),
      origin_jti: randomUUID(),
      event_id: randomUUID(),
      // Synthetic contact data, identical for both subjects on purpose (§8.1 item 5): never an identity key.
      email: "synthetic@example.invalid",
      email_verified: true,
      "cognito:username": "synthetic-user",
    };
    if (scenario === "missing-sub") delete payload.sub;
    const header: Record<string, unknown> = { alg: "RS256", kid: key.kid, typ: "JWT" };
    if (scenario === "unknown-kid") header.kid = randomUUID();
    if (scenario === "alg-none") { header.alg = "none"; delete header.kid; return this.#signedToken(header, payload, "none"); }
    if (scenario === "alg-hs256") { header.alg = "HS256"; return this.#signedToken(header, payload, "garbage"); }
    if (scenario === "bad-signature") return this.#signedToken(header, payload, "garbage");
    if (scenario === "malformed-token") return "not.a-jwt";
    return this.#signedToken(header, payload, key);
  }

  async exchange(input: { readonly code: string; readonly codeVerifier: string; readonly redirectUri: string; readonly clientId: string }): Promise<ExchangeTransportResult> {
    this.egress.push({ destination: "token", at: this.#now() });
    if (this.#tokenEndpoint === "outage") return { ok: false, error: "outage" };
    if (input.clientId !== this.clientId) return { ok: false, error: "invalid_client" };
    const issued = this.#codes[input.code];
    if (!issued || issued.used || issued.expiresAt <= this.#now().getTime()) return { ok: false, error: "invalid_grant" };
    issued.used = true;
    delete this.#codes[input.code];
    if (issued.redirectUri !== input.redirectUri) return { ok: false, error: "invalid_grant" };
    const expected = Buffer.from(issued.codeChallenge, "ascii");
    const actual = Buffer.from(createHash("sha256").update(input.codeVerifier, "ascii").digest("base64url"), "ascii");
    if (expected.length !== actual.length || !expected.equals(actual)) return { ok: false, error: "invalid_grant" };
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    this.#families.push({ accessTokenDigest: tokenDigest(accessToken), refreshTokenDigest: tokenDigest(refreshToken), revoked: false });
    return {
      ok: true,
      tokens: {
        id_token: this.#idToken(issued),
        access_token: accessToken,
        refresh_token: issued.scenario === "no-refresh" ? undefined : refreshToken,
        token_type: "Bearer",
        expires_in: this.#lifetimeSeconds,
      },
    };
  }

  async revoke(input: { readonly token: string; readonly clientId: string }): Promise<RevocationTransportResult> {
    this.egress.push({ destination: "revocation", at: this.#now() });
    if (this.#revocation === "outage") return "outage";
    if (this.#revocation === "fail") return "failed";
    if (this.#revocation === "ambiguous") return "ambiguous";
    if (input.clientId !== this.clientId) return "failed";
    const digest = tokenDigest(input.token);
    const family = this.#families.find((candidate) => candidate.refreshTokenDigest === digest);
    if (family) family.revoked = true;
    this.revocations.push(digest);
    return "revoked";
  }

  async jwks(): Promise<{ readonly keys: readonly Jwk[] } | undefined> {
    this.egress.push({ destination: "jwks", at: this.#now() });
    if (this.#jwksEndpoint === "outage") return undefined;
    this.#currentKey();
    return { keys: this.#keys.map((key) => key.jwk) };
  }

  /** Post-revocation probe (CT-190-016 shape): a UserInfo-style check that must fail after the family was revoked. */
  probeAccessToken(accessToken: string): { readonly active: boolean } {
    const digest = tokenDigest(accessToken);
    const family = this.#families.find((candidate) => candidate.accessTokenDigest === digest);
    return { active: family !== undefined && !family.revoked };
  }

  /** Test evidence only: how many token families were issued and how many are revoked. */
  familyCounts(): { readonly issued: number; readonly revoked: number } {
    return { issued: this.#families.length, revoked: this.#families.filter((family) => family.revoked).length };
  }

  /** Test evidence only: a private key handle for the retired-key scenario is never exposed; only its kid is. */
  retiredKids(): readonly string[] {
    return this.#retired.map((key) => key.kid);
  }

  /** Renders the accessible synthetic chooser. No script, no style, no credential input (§8, §11). */
  renderChooser(requestId: string, choosePath: string): string {
    const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
    const links = HUMAN_SCENARIOS.map((scenario) => `<li><a href="${escape(choosePath)}?request=${encodeURIComponent(requestId)}&amp;scenario=${scenario}">${scenario}</a></li>`).join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Simulated identity ceremony</title></head><body><main><h1 tabindex="-1">Simulated identity ceremony</h1><p>This local Cognito-shaped adapter serves synthetic scenarios only. No password, passkey, factor or recovery input exists here.</p><ul>${links}</ul></main></body></html>`;
  }

}
