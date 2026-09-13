/**
 * The one documented KMS provider CBD-246-AC04 asks for.
 *
 * CBD-19's subtask breakdown gives the KMS key and workload identity to
 * CBD-120, which is blocked: "the KMS provider binding is blocked by the
 * CBD-120 secret-manager and KMS subtask; the local provider, the layer, and
 * every test are not." This module is that binding's documented shape --
 * an interface a real KMS client will implement -- rather than a real
 * client. Constructing it before CBD-120 delivers a client is a startup
 * error naming what is missing, the same "fail loudly" behavior AC04 asks of
 * an absent local key: there is no silent fallback to an unencrypted or
 * locally-keyed path in a hosted environment.
 */
import type { KeyMaterial, KeyProvider } from "./provider.ts";

export const KMS_PROVIDER_NAME = "kms";

/** The shape CBD-120's KMS client will satisfy. Not implemented here. */
export interface KmsClient {
  getCurrentKey(): Promise<KeyMaterial>;
  getKeyByVersion(keyVersion: string): Promise<KeyMaterial>;
}

export class KmsProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "the KMS field-encryption provider has no client (CBD-120 is not yet delivered); "
        + "pass a KmsClient once the CBD-120 secret-manager and KMS binding exists, or use "
        + "the local provider outside a hosted environment",
    );
    this.name = "KmsProviderNotConfiguredError";
  }
}

/**
 * Builds a `KeyProvider` from a `KmsClient`. `client` is required and typed
 * as `undefined` only to make the "no silent default" failure explicit at
 * every call site that has not yet been wired to CBD-120's real client.
 */
export function createKmsKeyProvider(client: KmsClient | undefined): KeyProvider {
  if (!client) throw new KmsProviderNotConfiguredError();
  return {
    name: KMS_PROVIDER_NAME,
    currentKey: () => client.getCurrentKey(),
    keyByVersion: (keyVersion) => client.getKeyByVersion(keyVersion),
  };
}
