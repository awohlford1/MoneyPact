import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "./canonical.ts";
import type { EffectClass } from "./input.ts";
import type { PolicyDecision } from "./decision.ts";

export interface LocalSigningKeyPair { publicKey: KeyObject; privateKey: KeyObject }
export interface TransportedPolicyDecision {
  decision: PolicyDecision; action: string; targetBinding: string; claimedEffectClass: EffectClass;
  issuer: string; audience: string; issuedAt: string; expiresAt: string; oneUseId: string;
  algorithm: "Ed25519"; signature: string;
}
const domain = "cobudget.authorization.TransportedPolicyDecision.v1";
export function generateLocalSigningKeyPair(): LocalSigningKeyPair { return generateKeyPairSync("ed25519"); }
function bytes(envelope: Omit<TransportedPolicyDecision, "signature">): Buffer {
  return Buffer.concat([Buffer.from(domain), Buffer.from([0]), Buffer.from(canonicalize(envelope))]);
}
export function signLocalDecision(envelope: Omit<TransportedPolicyDecision, "signature">, privateKey: KeyObject): TransportedPolicyDecision {
  return { ...envelope, signature: sign(null, bytes(envelope), privateKey).toString("base64url") };
}
export function verifyLocalDecision(envelope: TransportedPolicyDecision, publicKey: KeyObject, expected: { issuer: string; audience: string; now: string; maximumLifetimeMs: number }): boolean {
  if (envelope.algorithm !== "Ed25519" || envelope.issuer !== expected.issuer || envelope.audience !== expected.audience) return false;
  const issued = Date.parse(envelope.issuedAt); const expires = Date.parse(envelope.expiresAt); const now = Date.parse(expected.now);
  if (![issued, expires, now].every(Number.isFinite) || issued > now || expires <= now || expires - issued > expected.maximumLifetimeMs) return false;
  if (envelope.claimedEffectClass !== envelope.decision.effectClass || envelope.action === "" || envelope.targetBinding === "") return false;
  const { signature, ...unsigned } = envelope;
  try { return verify(null, bytes(unsigned), publicKey, Buffer.from(signature, "base64url")); } catch { return false; }
}
