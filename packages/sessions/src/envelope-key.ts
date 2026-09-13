/**
 * §3.1 delivery-envelope key custody (CBD191-SECURITY-002 High finding 3;
 * Manager ruling `CBD191-CORRECTION-001` item 1): a separately configured,
 * versioned key, resolved through a provider with the same local-only
 * admission rule `@cobudget/data-access/encryption`'s
 * `resolveFieldEncryptionProvider` uses (`PROVIDERS-LOCAL-001`), never
 * derived from `COBUDGET_SESSION_PEPPER`. Compromise or rotation of the
 * verifier/CSRF pepper (`config.ts`) therefore has no effect on this key,
 * and vice versa.
 *
 * `EnvelopeKeyProvider` is deliberately not a field on `SessionConfig`:
 * `SessionConfig` flows into `resolve.ts`/`fact-source.ts`/`cookie.ts`,
 * every one of which only ever needs the pepper. Threading the envelope key
 * through the same object would hand decrypt capability to code that never
 * calls `openDelivery`. Only `issuance.ts` (the "isolated issuance/replay
 * component" Security's remediation names) receives an
 * `EnvelopeKeyProvider`.
 */
export interface EnvelopeKeyConfigEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER?: string | undefined;
  readonly COBUDGET_SESSION_ENVELOPE_KEY?: string | undefined;
  readonly COBUDGET_SESSION_ENVELOPE_KEY_VERSION?: string | undefined;
}

export interface EnvelopeKeyProvider {
  readonly currentVersion: string;
  /** The key to seal a new envelope with, at `currentVersion`. */
  sealingKey(): Buffer;
  /** The key a previously sealed envelope at `version` was sealed with, or
   * `undefined` if that version is not (or no longer) resolvable -- callers
   * must treat an unresolvable version as a terminal decrypt failure, never
   * as "try the current key instead." */
  keyFor(version: string): Buffer | undefined;
}

export class MissingEnvelopeKeyConfigError extends Error {
  constructor(variable: string) {
    super(`session envelope-key configuration is missing "${variable}"; there is no silent default (§3.1) -- startup fails closed`);
    this.name = "MissingEnvelopeKeyConfigError";
  }
}

export class EnvelopeKeyProviderNotAllowedError extends Error {
  constructor(nodeEnv: string | undefined) {
    super(
      `the local session envelope-key provider is refused outside NODE_ENV=development or NODE_ENV=test `
        + `(got ${nodeEnv === undefined ? "undefined" : JSON.stringify(nodeEnv)}); a hosted environment requires the kms provider (PROVIDERS-LOCAL-001).`,
    );
    this.name = "EnvelopeKeyProviderNotAllowedError";
  }
}

export class KmsEnvelopeKeyProviderNotConfiguredError extends Error {
  constructor() {
    super("the kms session envelope-key provider is not yet implemented; no live Cognito/hosted activation may select it (PROVIDERS-LOCAL-001)");
    this.name = "KmsEnvelopeKeyProviderNotConfiguredError";
  }
}

const LOCAL_PROVIDER_ALLOWED_NODE_ENVS = new Set(["development", "test"]);

function createLocalEnvelopeKeyProvider(key: Buffer, version: string): EnvelopeKeyProvider {
  return {
    currentVersion: version,
    sealingKey: () => key,
    keyFor: (candidateVersion: string) => (candidateVersion === version ? key : undefined),
  };
}

/**
 * Pure: `env` is a parameter, never `process.env` read here. Mirrors
 * `resolveFieldEncryptionProvider`'s fail-closed shape exactly, on its own
 * dedicated variables so the envelope key and the field-encryption key
 * never share a provider selection either.
 */
export function resolveSessionEnvelopeKeyProvider(env: EnvelopeKeyConfigEnvironment): EnvelopeKeyProvider {
  const provider = env.COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER;
  if (!provider) throw new MissingEnvelopeKeyConfigError("COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER");

  if (provider === "kms") throw new KmsEnvelopeKeyProviderNotConfiguredError();
  if (provider !== "local") throw new MissingEnvelopeKeyConfigError("COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER");

  if (!LOCAL_PROVIDER_ALLOWED_NODE_ENVS.has(env.NODE_ENV ?? "")) {
    throw new EnvelopeKeyProviderNotAllowedError(env.NODE_ENV);
  }

  const encoded = env.COBUDGET_SESSION_ENVELOPE_KEY;
  if (!encoded) throw new MissingEnvelopeKeyConfigError("COBUDGET_SESSION_ENVELOPE_KEY");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength < 32) throw new MissingEnvelopeKeyConfigError("COBUDGET_SESSION_ENVELOPE_KEY");

  const version = env.COBUDGET_SESSION_ENVELOPE_KEY_VERSION;
  if (!version) throw new MissingEnvelopeKeyConfigError("COBUDGET_SESSION_ENVELOPE_KEY_VERSION");

  return createLocalEnvelopeKeyProvider(key, version);
}
