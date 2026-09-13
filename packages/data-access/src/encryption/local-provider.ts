/**
 * The one documented local provider CBD-246-AC04 asks for.
 *
 * Consistent with PROVIDERS-LOCAL-001 (no provider account is activated in
 * the prototype phase) and CBD236-SIGNING-KEY-001 (a generated, local-only
 * key -- never a real secret, never shared, regenerated per developer
 * environment -- is used to build and test a real cross-process path before
 * custody of a real key is decided at hosting): this provider holds one
 * 256-bit key, supplied by its caller, tagged with one version string. It is
 * never trusted outside a local environment.
 */
import type { KeyMaterial, KeyProvider } from "./provider.ts";
import { UnknownKeyVersionError } from "./provider.ts";

export const LOCAL_PROVIDER_NAME = "local";
const KEY_LENGTH_BYTES = 32; // AES-256

export interface LocalKeyProviderConfig {
  /** Raw 32-byte AES-256 key. Never a real secret outside a local environment. */
  readonly key: Buffer;
  readonly keyVersion: string;
}

export function createLocalKeyProvider(config: LocalKeyProviderConfig): KeyProvider {
  if (config.key.length !== KEY_LENGTH_BYTES) {
    throw new RangeError(`local key provider requires a ${KEY_LENGTH_BYTES}-byte key; got ${config.key.length}`);
  }
  if (config.keyVersion.trim() === "") {
    throw new RangeError("local key provider requires a non-empty keyVersion");
  }
  const material: KeyMaterial = { keyVersion: config.keyVersion, key: config.key };
  return {
    name: LOCAL_PROVIDER_NAME,
    currentKey: () => material,
    keyByVersion: (keyVersion) => {
      if (keyVersion !== material.keyVersion) throw new UnknownKeyVersionError(LOCAL_PROVIDER_NAME, keyVersion);
      return material;
    },
  };
}
