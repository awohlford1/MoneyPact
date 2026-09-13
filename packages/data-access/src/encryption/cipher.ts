/**
 * S4 field encryption (CBD-246-AC04): encrypt with a key from a `KeyProvider`,
 * record the key version on every ciphertext, decrypt only with that same
 * version's key.
 *
 * AES-256-GCM: the authentication tag makes a tampered ciphertext fail to
 * decrypt rather than silently return altered plaintext, which matters more
 * for a stored financial field than it would for data that is only ever read
 * back by the process that wrote it.
 *
 * CBD246-SECURITY-001 finding 4: an authentication tag alone only proves a
 * ciphertext was not altered -- it does not prove it belongs where it is
 * being read from. Without additional authenticated data (AAD) binding a
 * ciphertext to the row it was written for, a database-level actor (or a
 * bug) that copies a valid ciphertext from one tenant, row, or column into
 * another still decrypts successfully. Every call here therefore requires
 * an `EncryptionContext` -- schema/envelope version, tenant (budget-space)
 * id, owning row id, and column -- and binds it as AAD. `decryptField` takes
 * its own `expectedContext` rather than trusting anything stored beside the
 * ciphertext: nothing about that context is persisted in `Ciphertext`, so
 * there is nothing for an attacker to forge alongside a stolen ciphertext.
 * A ciphertext moved to a different row, column, or tenant fails to decrypt
 * with an authentication error from the cipher itself.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyProvider } from "./provider.ts";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AAD_VERSION = "cbd246-aad-v1";

export interface EncryptionContext {
  /** The budget-space (tenant) this field's row belongs to. */
  readonly tenantId: string;
  /** The table the ciphertext is stored in. */
  readonly table: string;
  /** The primary key (or other stable identity) of the row the ciphertext belongs to. */
  readonly rowId: string;
  /** The column the ciphertext is stored in. */
  readonly column: string;
}

export interface Ciphertext {
  readonly keyVersion: string;
  readonly iv: string; // base64
  readonly authTag: string; // base64
  readonly ciphertext: string; // base64
}

function assertNonBlank(field: string, value: string): void {
  if (value.trim().length === 0) throw new RangeError(`encryption context field "${field}" must not be blank`);
}

/** Canonical, order-fixed AAD bytes for `context`. Every field is length-delimited so no combination of values can collide across fields. */
function encodeAad(context: EncryptionContext): Buffer {
  assertNonBlank("tenantId", context.tenantId);
  assertNonBlank("table", context.table);
  assertNonBlank("rowId", context.rowId);
  assertNonBlank("column", context.column);
  const fields = [AAD_VERSION, context.tenantId, context.table, context.rowId, context.column];
  return Buffer.from(fields.map((field) => `${field.length}:${field}`).join(""), "utf8");
}

export async function encryptField(provider: KeyProvider, plaintext: string, context: EncryptionContext): Promise<Ciphertext> {
  const { key, keyVersion } = await provider.currentKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(encodeAad(context));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    keyVersion,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export async function decryptField(provider: KeyProvider, value: Ciphertext, expectedContext: EncryptionContext): Promise<string> {
  const { key } = await provider.keyByVersion(value.keyVersion);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, "base64"));
  decipher.setAAD(encodeAad(expectedContext));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
