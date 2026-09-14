import { createHash, createPublicKey, verify } from "node:crypto";
import type { ActorRef } from "../contracts/actors.ts";
import { AgentWorkflowError } from "../contracts/errors.ts";
import { canonicalJson } from "../config/canonical.ts";

export interface ExecutiveApprovalReceiptPayload {
  version: "1.0";
  approvalId: string;
  assignmentId: string;
  planId: string;
  planRevision: number;
  scope: string;
  decision: "approve" | "reject" | "waive";
  executiveId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface SignedExecutiveApprovalReceipt {
  keyId: string;
  payload: ExecutiveApprovalReceiptPayload;
  signature: string;
}

export interface ApprovalVerification {
  mode: "record_only" | "signed_ed25519";
  keyId?: string;
  receiptDigest?: string;
}

export function verifyExecutiveApprovalReceipt(input: {
  receipt: SignedExecutiveApprovalReceipt;
  trustedPublicKeys: Readonly<Record<string, string>>;
  expected: Pick<ExecutiveApprovalReceiptPayload, "approvalId" | "assignmentId" | "planId" | "planRevision" | "scope" | "decision">;
  receiptMaxAgeSeconds: number;
  now?: Date;
}): { actor: ActorRef; verification: ApprovalVerification } {
  const now = input.now ?? new Date();
  const payload = input.receipt?.payload;
  if (!payload || payload.version !== "1.0") throw new AgentWorkflowError({ code: "APPROVAL_RECEIPT_INVALID", message: "A version 1.0 signed executive approval receipt is required." });
  for (const [key, value] of Object.entries(input.expected)) {
    if (payload[key as keyof ExecutiveApprovalReceiptPayload] !== value) throw new AgentWorkflowError({ code: "APPROVAL_RECEIPT_SCOPE_MISMATCH", message: `Approval receipt does not match ${key}.` });
  }
  const issued = Date.parse(payload.issuedAt), expires = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now.getTime() || expires <= now.getTime() || now.getTime() - issued > input.receiptMaxAgeSeconds * 1000) {
    throw new AgentWorkflowError({ code: "APPROVAL_RECEIPT_EXPIRED", message: "Executive approval receipt is expired or outside the accepted time window." });
  }
  if (!payload.executiveId || !payload.nonce) throw new AgentWorkflowError({ code: "APPROVAL_RECEIPT_INVALID", message: "Executive identity and nonce are required." });
  const encodedKey = input.trustedPublicKeys[input.receipt.keyId];
  if (!encodedKey) throw new AgentWorkflowError({ code: "APPROVAL_SIGNER_UNTRUSTED", message: "Executive approval receipt signer is not trusted." });
  let valid = false;
  try {
    const key = createPublicKey({ key: Buffer.from(encodedKey, "base64"), format: "der", type: "spki" });
    valid = verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(input.receipt.signature, "base64"));
  } catch { valid = false; }
  if (!valid) throw new AgentWorkflowError({ code: "APPROVAL_SIGNATURE_INVALID", message: "Executive approval receipt signature is invalid." });
  return {
    actor: { actorId: payload.executiveId, actorType: "executive" },
    verification: { mode: "signed_ed25519", keyId: input.receipt.keyId, receiptDigest: `sha256:${createHash("sha256").update(canonicalJson(input.receipt)).digest("hex")}` },
  };
}
