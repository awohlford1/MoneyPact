import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { loadPrototypeRegistry, PROTOTYPE_APPROVALS_PATH, prototypeApprovalContext } from "./prototype.ts";
import { CountingKeyDeriver, InProcessCounterStore } from "./counter.ts";
import { seal, validateRegistry } from "./registry.ts";

const evidence = JSON.parse(readFileSync(PROTOTYPE_APPROVALS_PATH, "utf8"));
// Five prototype sets plus rlp-266-identity-session-v1 (CBD266-IDENTITY-RECORDS-001, projected by PROTO-ACTIVATION-001).
const APPROVED_RECORDS = 6;
it("projects all exact decision digests and the authorized actor", () => {
  const registry = loadPrototypeRegistry();
  assert.equal(registry.approved.size, APPROVED_RECORDS);
  assert.deepEqual(registry.diagnostics, []);
  for (const record of registry.records) {
    assert.equal(record.product_owner_approval.approved_by_actor_id, "atlassian:5cffa74b92e6c70c53499977");
    const source = evidence.find((e: { approvalId: string }) => e.approvalId === record.product_owner_approval.approval_id);
    assert.equal(record.product_owner_approval.decided_at, source.decidedAt);
    assert.ok(source.candidateDigests.includes(record.product_owner_approval.candidate_digest));
    assert.equal(registry.approvalCurrent(record), true);
  }
  assert.equal(prototypeApprovalContext(PROTOTYPE_APPROVALS_PATH, "hosted").resolve(evidence[0].approvalId), undefined);
});
it("rejects missing, malformed, duplicate, revoked and mismatched file evidence; rechecks live revocation", () => {
  const dir = mkdtempSync(join(tmpdir(), "rate-limit-approval-")); const path = join(dir, "approvals.json");
  try {
    assert.equal(loadPrototypeRegistry(path).approved.size, 0);
    for (const edit of [
      (e: typeof evidence) => { e[0].revoked = true; },
      (e: typeof evidence) => { e[0].candidateDigests[0] = "0".repeat(64); },
      (e: typeof evidence) => { e[0].actorId = "test-only-wrong-actor"; },
      (e: typeof evidence) => { e[0].conditions = []; },
      (e: typeof evidence) => { e[0].decidedAt = "2026-09-12T00:00:00Z"; },
      (e: typeof evidence) => { e[0].approvalId = "test-only-wrong-id"; },
      (e: typeof evidence) => { e[0].expiresAt = "2026-09-13T01:00:00Z"; },
      (e: typeof evidence) => { e.push(e[0]); },
      (e: typeof evidence) => { e[0].candidateDigests = null; },
    ]) {
      const changed = structuredClone(evidence); edit(changed); writeFileSync(path, JSON.stringify(changed));
      const registry = loadPrototypeRegistry(path); assert.equal(registry.approved.size, 0);
      assert.ok(registry.diagnostics.some((d) => d.code === "approval_evidence_invalid"));
    }
    writeFileSync(path, "{"); assert.equal(loadPrototypeRegistry(path).approved.size, 0);
    writeFileSync(path, JSON.stringify(evidence)); const registry = loadPrototypeRegistry(path);
    assert.equal(registry.approved.size, APPROVED_RECORDS);
    writeFileSync(path, JSON.stringify([{ ...evidence[0], revoked: true }]));
    assert.equal(registry.approvalCurrent(registry.records[0]!), false);
    writeFileSync(path, JSON.stringify(evidence)); assert.equal(loadPrototypeRegistry(path).approved.size, APPROVED_RECORDS);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("rejects matching but expired or future-dated records and evidence", () => {
  for (const future of [false, true]) {
    const records = loadPrototypeRegistry().records.map((record) => {
      const r = structuredClone(record);
      if (future) r.product_owner_approval.decided_at = "2099-09-13T00:00:00Z";
      else r.product_owner_approval.expires_at = "2026-09-13T01:00:00Z";
      return seal(r);
    });
    const e = { ...evidence[0], decidedAt: records[0]!.product_owner_approval.decided_at, expiresAt: records[0]!.product_owner_approval.expires_at };
    const registry = validateRegistry(records, { now: "2026-09-14T00:00:00Z", environment: "local-prototype", singleProcess: true, resolve: () => e });
    assert.equal(registry.approved.size, 0); assert.equal(registry.approvalCurrent(records[0]!), false);
  }
});

it("approved terminal recovery keeps an independent key and budget after read exhaustion", async () => {
  const registry = loadPrototypeRegistry();
  const read = registry.approved.get("rlp-266-authenticated-read-v1")!;
  const recovery = registry.approved.get("rlp-266-recovery-v1")!;
  const keys = new CountingKeyDeriver(); const store = new InProcessCounterStore(() => 0);
  const input = (record: typeof read) => ({ record, releaseSetDigest: registry.releaseSetDigest,
    keys: keys.derive(record, { actorId: "test-actor", localCaller: true }), unit: 1 as const });
  assert.notDeepEqual(input(read).keys, input(recovery).keys);
  for (let i = 0; i < 70; i++) assert.equal((await store.consume(input(read))).outcome, "accepted");
  assert.equal((await store.consume(input(read))).outcome, "exhausted");
  assert.equal((await store.consume(input(recovery))).outcome, "accepted");
});
it("retains recovery isolation and limits the terminal exception to the recovery surface", () => {
  const source = loadPrototypeRegistry().records;
  for (const mutate of [
    (records: typeof source) => { records[4]!.counter_store.namespace = records[1]!.counter_store.namespace; },
    (records: typeof source) => { records[1]!.anti_lockout_rule.independent_recovery_surface_id = null; },
  ]) {
    const changed = structuredClone(source); mutate(changed); const records = changed.map(seal);
    const context = prototypeApprovalContext(); const resolve = context.resolve;
    const registry = validateRegistry(records, { ...context, resolve: (id) => {
      const e = resolve(id); return e && { ...e, candidateDigests: records.filter((r) => r.product_owner_approval.approval_id === id).map((r) => r.product_owner_approval.candidate_digest) };
    } });
    assert.equal(registry.approved.has("rlp-266-authenticated-read-v1"), false);
  }
});
