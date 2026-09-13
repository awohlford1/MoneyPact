/**
 * The key-provider interface CBD-246-AC04 requires: something that hands the
 * cipher a key and the version to record alongside every ciphertext, without
 * the cipher knowing whether that key came from a local file or a hosted KMS.
 */
export interface KeyMaterial {
  readonly keyVersion: string;
  readonly key: Buffer;
}

export interface KeyProvider {
  readonly name: string;
  /** The key new ciphertext is written with. */
  currentKey(): Promise<KeyMaterial> | KeyMaterial;
  /** The key a ciphertext recorded under `keyVersion` must be read back with. */
  keyByVersion(keyVersion: string): Promise<KeyMaterial> | KeyMaterial;
}

export class UnknownKeyVersionError extends Error {
  constructor(provider: string, keyVersion: string) {
    super(`${provider} key provider has no key for version "${keyVersion}"`);
    this.name = "UnknownKeyVersionError";
  }
}
