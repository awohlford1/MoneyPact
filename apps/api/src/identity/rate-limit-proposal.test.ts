/**
 * PROTO-ACTIVATION-001 A7: the approved-but-unprojectable ceremony record. CBD266-IDENTITY-RECORDS-001
 * approved rlp-266-identity-ceremony-v1 exactly as the proposal file states it; this test pins that the
 * file still carries the approved candidate digest, and reproduces the reason it is not projected: the
 * registry admits one approved record per surface, and rlp-266-bootstrap-v1 already holds
 * surf-266-authentication. When the Executive supersedes or re-surfaces one of them, the second case here
 * is the signal to project the record and rebind the ceremony routes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateDigest, loadPrototypeRegistry, seal, validateRegistry } from "../../../../packages/rate-limit/src/index.ts";
import { prototypeApprovalContext } from "../../../../packages/rate-limit/src/prototype.ts";
import type { ParameterRecord } from "../../../../packages/rate-limit/src/index.ts";
import proposal from "./rate-limit-proposal.json" with { type: "json" };

const APPROVED_CANDIDATE_DIGEST = "2a21ca1d477e4c1d881fcaa981c1dee423f6155b733ed91b00c81881527805db";
const ceremony = proposal.records[0] as unknown as ParameterRecord;

describe("rlp-266-identity-ceremony-v1 (approved, not projectable)", () => {
  it("is still exactly the record the Executive approved", () => {
    assert.equal(ceremony.record_id, "rlp-266-identity-ceremony-v1");
    assert.equal(candidateDigest(ceremony), APPROVED_CANDIDATE_DIGEST);
    assert.equal(ceremony.surface_id, "surf-266-authentication");
  });

  it("cannot be projected next to rlp-266-bootstrap-v1: the registry refuses two approved records on one surface", () => {
    const live = loadPrototypeRegistry();
    assert.deepEqual(live.diagnostics, []);
    const bootstrap = live.records.find((record) => record.record_id === "rlp-266-bootstrap-v1")!;
    assert.equal(bootstrap.surface_id, ceremony.surface_id);
    const approval = { ...bootstrap.product_owner_approval, approval_id: "CBD266-IDENTITY-RECORDS-001", decided_at: "2026-09-14T11:49:36Z" };
    const projected = seal({ ...ceremony, product_owner_approval: approval } as ParameterRecord);
    const evidence = { approvalId: "CBD266-IDENTITY-RECORDS-001", actorId: bootstrap.product_owner_approval.approved_by_actor_id!, candidateDigests: [projected.product_owner_approval.candidate_digest], conditions: approval.conditions, decidedAt: approval.decided_at, expiresAt: null, revoked: false };
    const context = prototypeApprovalContext();
    const registry = validateRegistry([...live.records, projected], { ...context, resolve: (id) => id === "CBD266-IDENTITY-RECORDS-001" ? evidence : context.resolve(id) });
    assert.ok(registry.diagnostics.some((d) => d.recordId === "rlp-266-identity-ceremony-v1" && d.code === "record_reference_invalid" && d.pointer === "/surface_id"), JSON.stringify(registry.diagnostics));
    assert.equal(registry.approved.size, 0, "a surface conflict clears every approval, which is why the ceremony record stays a proposal");
  });
});
