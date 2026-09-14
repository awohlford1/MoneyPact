import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { verifyExecutiveApprovalReceipt, type ExecutiveApprovalReceiptPayload } from "../../src/approvals/index.ts";
import { canonicalJson } from "../../src/config/canonical.ts";
import defaults from "../../defaults/config.json" with { type: "json" };
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";
import { MemoryWorkflowRepository, WorkflowCommandService } from "../../src/commands/index.ts";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload: ExecutiveApprovalReceiptPayload = {
    version: "1.0", approvalId: "apr-1", assignmentId: "asn-1", planId: "pln-1", planRevision: 2,
    scope: "execute", decision: "approve", executiveId: "executive:owner", issuedAt: "2026-09-13T12:00:00.000Z",
    expiresAt: "2026-09-13T12:10:00.000Z", nonce: "nonce-1",
  };
  return {
    payload,
    trustedPublicKeys: { owner: publicKey.export({ format: "der", type: "spki" }).toString("base64") },
    receipt: { keyId: "owner", payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") },
  };
}

test("signed receipts authenticate the executive and exact approval scope", () => {
  const value = fixture();
  const verified = verifyExecutiveApprovalReceipt({ ...value, expected: { approvalId: "apr-1", assignmentId: "asn-1", planId: "pln-1", planRevision: 2, scope: "execute", decision: "approve" }, receiptMaxAgeSeconds: 900, now: new Date("2026-09-13T12:05:00.000Z") });
  assert.deepEqual(verified.actor, { actorId: "executive:owner", actorType: "executive" });
  assert.equal(verified.verification.mode, "signed_ed25519");
  assert.match(verified.verification.receiptDigest!, /^sha256:[a-f0-9]{64}$/);
});

test("signed receipts reject tampering, wrong scope, expiry, and untrusted keys", () => {
  const value = fixture();
  const expected = { approvalId: "apr-1", assignmentId: "asn-1", planId: "pln-1", planRevision: 2, scope: "execute", decision: "approve" as const };
  assert.throws(() => verifyExecutiveApprovalReceipt({ ...value, expected: { ...expected, planRevision: 3 }, receiptMaxAgeSeconds: 900, now: new Date("2026-09-13T12:05:00.000Z") }), /does not match planRevision/);
  assert.throws(() => verifyExecutiveApprovalReceipt({ ...value, receipt: { ...value.receipt, signature: Buffer.alloc(64).toString("base64") }, expected, receiptMaxAgeSeconds: 900, now: new Date("2026-09-13T12:05:00.000Z") }), /signature is invalid/);
  assert.throws(() => verifyExecutiveApprovalReceipt({ ...value, expected, receiptMaxAgeSeconds: 900, now: new Date("2026-09-13T12:11:00.000Z") }), /expired/);
  assert.throws(() => verifyExecutiveApprovalReceipt({ ...value, trustedPublicKeys: {}, expected, receiptMaxAgeSeconds: 900, now: new Date("2026-09-13T12:05:00.000Z") }), /not trusted/);
});

test("the command service itself rejects self-asserted executive identity in signed mode", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const config = structuredClone(defaults) as FrameworkConfiguration;
  config.security.executiveApproval = { mode: "signed_ed25519", trustedPublicKeys: { owner: publicKey.export({ format: "der", type: "spki" }).toString("base64") }, receiptMaxAgeSeconds: 900 };
  const service = new WorkflowCommandService(new MemoryWorkflowRepository(), config, { async requestStop() { return { confirmed: true }; }, async createTransferPackage() { return { packageId: "pkg-1", valid: true }; }, async transferOwnership() { return { accepted: true }; } });
  const manager = { actor: { actorId: "manager-1", actorType: "manager" as const }, managerInstanceId: "mgr-1", now: () => new Date("2026-09-13T12:05:00.000Z") };
  const started = await service.start({ objective: "Secure approval", approach: ["work"], acceptanceCriteria: ["done"] }, manager);
  const approval = started.assignment.approvals[0]!;
  const context = { ...manager, ownershipToken: started.assignment.ownershipLease!.token };
  await assert.rejects(service.approvePlan(started.assignment.assignmentId, approval.approvalId, { actorId: "executive:forged", actorType: "executive" }, context), /APPROVAL_RECEIPT_REQUIRED/);
  const payload: ExecutiveApprovalReceiptPayload = { version: "1.0", approvalId: approval.approvalId, assignmentId: started.assignment.assignmentId, planId: approval.subjectId, planRevision: approval.subjectRevision, scope: approval.scope, decision: "approve", executiveId: "executive:owner", issuedAt: "2026-09-13T12:00:00.000Z", expiresAt: "2026-09-13T12:10:00.000Z", nonce: "nonce-service" };
  const receipt = { keyId: "owner", payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") };
  const approved = await service.approvePlan(started.assignment.assignmentId, approval.approvalId, { actorId: "executive:ignored", actorType: "executive" }, context, receipt);
  assert.equal(approved.assignment.approvals[0]!.approver.actorId, "executive:owner");
  assert.equal(approved.assignment.approvals[0]!.verification?.mode, "signed_ed25519");
});
