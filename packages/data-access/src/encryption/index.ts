export type { KeyMaterial, KeyProvider } from "./provider.ts";
export { UnknownKeyVersionError } from "./provider.ts";
export { createLocalKeyProvider } from "./local-provider.ts";
export { LOCAL_PROVIDER_NAME } from "./local-provider.ts";
export type { LocalKeyProviderConfig } from "./local-provider.ts";
export { createKmsKeyProvider } from "./kms-provider.ts";
export { KMS_PROVIDER_NAME, KmsProviderNotConfiguredError } from "./kms-provider.ts";
export type { KmsClient } from "./kms-provider.ts";
export { decryptField, encryptField } from "./cipher.ts";
export type { Ciphertext, EncryptionContext } from "./cipher.ts";
export {
  fieldEncryptionConfigFailures,
  fieldEncryptionConfigSchema,
  LocalProviderNotAllowedError,
  MissingFieldEncryptionConfigError,
  resolveFieldEncryptionProvider,
} from "./config.ts";
export type { FieldEncryptionEnvironment } from "./config.ts";
