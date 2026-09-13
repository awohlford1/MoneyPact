import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { decryptField, encryptField } from "./cipher.ts";
import type { EncryptionContext } from "./cipher.ts";
import { createLocalKeyProvider } from "./local-provider.ts";
import { createKmsKeyProvider } from "./kms-provider.ts";
import { KmsProviderNotConfiguredError } from "./kms-provider.ts";
import { LocalProviderNotAllowedError, MissingFieldEncryptionConfigError, resolveFieldEncryptionProvider } from "./config.ts";
import { UnknownKeyVersionError } from "./provider.ts";

const CANARY_PLAINTEXT = "account-number-4111111111111111";

const CONTEXT: EncryptionContext = {
  tenantId: "space-1",
  table: "budget_line_items",
  rowId: "row-1",
  column: "account_number",
};

void test("CBD-246-AC04: encrypting records the key version, and the ciphertext alone does not reveal the plaintext", async () => {
  const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);

  assert.equal(value.keyVersion, "v1", "the ciphertext must record which key version encrypted it");

  // "database access alone" is exactly the row this function returns: the
  // base64 blobs that would be stored. Reading them as text must not surface
  // the plaintext.
  const storedRow = JSON.stringify(value);
  assert.ok(!storedRow.includes(CANARY_PLAINTEXT), "the stored ciphertext must not contain the plaintext");
  assert.ok(
    !Buffer.from(value.ciphertext, "base64").toString("latin1").includes(CANARY_PLAINTEXT),
    "the raw ciphertext bytes must not contain the plaintext either",
  );

  const roundTripped = await decryptField(provider, value, CONTEXT);
  assert.equal(roundTripped, CANARY_PLAINTEXT);
});

void test("CBD-246-AC04: a database-only actor (no key) cannot decrypt -- wrong key fails closed", async () => {
  const writer = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const attacker = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(writer, CANARY_PLAINTEXT, CONTEXT);
  await assert.rejects(() => decryptField(attacker, value, CONTEXT), /Unsupported state|auth/i);
});

void test("CBD-246-AC04: decrypting with an unrecorded key version is refused", async () => {
  const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);
  await assert.rejects(
    () => decryptField(provider, { ...value, keyVersion: "v2" }, CONTEXT),
    UnknownKeyVersionError,
  );
});

void test("CBD-246-AC04 finding 4: a ciphertext moved to a different row fails to decrypt (AAD binds row identity)", async () => {
  const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);
  await assert.rejects(() => decryptField(provider, value, { ...CONTEXT, rowId: "row-2" }), /Unsupported state|auth/i);
});

void test("CBD-246-AC04 finding 4: a ciphertext moved to a different tenant fails to decrypt (AAD binds tenant identity)", async () => {
  const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);
  await assert.rejects(() => decryptField(provider, value, { ...CONTEXT, tenantId: "space-2" }), /Unsupported state|auth/i);
});

void test("CBD-246-AC04 finding 4: a ciphertext moved to a different column fails to decrypt (AAD binds column)", async () => {
  const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);
  await assert.rejects(() => decryptField(provider, value, { ...CONTEXT, column: "routing_number" }), /Unsupported state|auth/i);
});

void test("CBD-246-AC04 finding 4: a ciphertext moved to a different table fails to decrypt (AAD binds table)", async () => {
  const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "v1" });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);
  await assert.rejects(() => decryptField(provider, value, { ...CONTEXT, table: "other_table" }), /Unsupported state|auth/i);
});

void test("CBD-246-AC04: an absent provider configuration fails startup naming the variable", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({}),
    (error: unknown) => error instanceof MissingFieldEncryptionConfigError
      && error.message.includes("COBUDGET_FIELD_ENCRYPTION_PROVIDER"),
  );
});

void test("CBD-246-AC04: local provider selected without a key fails naming the key variable", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({ COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", NODE_ENV: "test" }),
    (error: unknown) => error instanceof MissingFieldEncryptionConfigError
      && error.message.includes("COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY"),
  );
});

void test("CBD-246-AC04: local provider selected without a key version fails naming that variable", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
      NODE_ENV: "test",
    }),
    (error: unknown) => error instanceof MissingFieldEncryptionConfigError
      && error.message.includes("COBUDGET_FIELD_ENCRYPTION_KEY_VERSION"),
  );
});

void test("CBD-246-AC04: a fully configured local provider resolves and round-trips", async () => {
  const provider = resolveFieldEncryptionProvider({
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
    COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
    COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "local-dev-v1",
    NODE_ENV: "development",
  });
  const value = await encryptField(provider, CANARY_PLAINTEXT, CONTEXT);
  assert.equal(await decryptField(provider, value, CONTEXT), CANARY_PLAINTEXT);
});

void test("CBD-246-AC04: kms provider without a client fails startup rather than silently falling back", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({ COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms" }),
    KmsProviderNotConfiguredError,
  );
  assert.throws(() => createKmsKeyProvider(undefined), KmsProviderNotConfiguredError);
});

void test("CBD-246-AC04 finding 6: the local provider is refused when NODE_ENV is production", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "v1",
      NODE_ENV: "production",
    }),
    LocalProviderNotAllowedError,
  );
});

void test("CBD-246-AC04 finding 6: the local provider is refused when NODE_ENV is absent", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "v1",
    }),
    LocalProviderNotAllowedError,
  );
});

void test("CBD-246-AC04 finding 6: the local provider is allowed under NODE_ENV=test and NODE_ENV=development", () => {
  for (const nodeEnv of ["test", "development"]) {
    assert.doesNotThrow(() => resolveFieldEncryptionProvider({
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "v1",
      NODE_ENV: nodeEnv,
    }));
  }
});

void test("CBD-246-AC04 finding 6: the kms provider is not subject to the local-only NODE_ENV restriction", () => {
  assert.throws(
    () => resolveFieldEncryptionProvider({ COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms", NODE_ENV: "production" }),
    KmsProviderNotConfiguredError,
  );
});
