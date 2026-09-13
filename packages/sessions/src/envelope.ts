/**
 * §3.1/§5.3 sealed delivery envelope: authenticated encryption over the exact
 * selector/verifier/CSRF delivery values, audience-bound to one
 * `session_handoff_id`.
 *
 * CBD191-CORRECTION-001 item 1 (CBD191-SECURITY-002 High finding 3): the key
 * is supplied by the caller (`issuance.ts`, via `envelope-key.ts`'s
 * `EnvelopeKeyProvider`) rather than derived here. An earlier revision
 * derived it via HKDF from `COBUDGET_SESSION_PEPPER`, which Security
 * correctly flagged: HKDF gives cryptographic domain separation, not the
 * separated custody and independent rotation §3.1 requires. This module has
 * no opinion on where the key comes from; it only performs AES-256-GCM
 * given one, and is deliberately not re-exported from `index.ts` --
 * decrypt/seal capability is confined to `issuance.ts`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LENGTH = 12;

export interface DeliveryPayload {
  readonly cookieValue: string;
  readonly csrfValue: string;
  readonly sessionRef: string;
  readonly sessionHandoffId: string;
}

/** Seals `payload` with `key` (32 bytes, AES-256), audience-binding it to `payload.sessionHandoffId` via AAD. */
export function sealDelivery(key: Buffer, payload: DeliveryPayload): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(payload.sessionHandoffId, "utf8"));
  const plaintext = Buffer.from(JSON.stringify({ cookieValue: payload.cookieValue, csrfValue: payload.csrfValue, sessionRef: payload.sessionRef }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export class DeliveryEnvelopeTamperedError extends Error {
  constructor() {
    super("session delivery envelope failed authentication; it is treated as absent, never partially trusted");
    this.name = "DeliveryEnvelopeTamperedError";
  }
}

/** Opens a sealed envelope with `key`, requiring it be bound to `sessionHandoffId`. */
export function openDelivery(key: Buffer, sealed: Buffer, sessionHandoffId: string): Omit<DeliveryPayload, "sessionHandoffId"> {
  const iv = sealed.subarray(0, IV_LENGTH);
  const tag = sealed.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = sealed.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(sessionHandoffId, "utf8"));
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as Omit<DeliveryPayload, "sessionHandoffId">;
  } catch {
    throw new DeliveryEnvelopeTamperedError();
  }
}
