import assert from "node:assert/strict";
import { it } from "node:test";
import { loadPrototypeRegistry } from "./prototype.ts";
import { PARAMETER_SCHEMA, parseRegistryJson } from "./schema.ts";
import type { Schema } from "./schema.ts";
import { canonical, seal, validateRegistry } from "./registry.ts";
import type { ApprovalContext, ParameterRecord } from "./types.ts";

const pending = loadPrototypeRegistry().records[0]!;
const reviewContext: ApprovalContext = { now: "2026-09-13T12:00:00Z", environment: "local-prototype", singleProcess: true, resolve: () => undefined };
export function syntheticApproval(record = pending): { record: ParameterRecord; context: ApprovalContext } {
  const r = structuredClone(record);
  r.product_owner_approval = { ...r.product_owner_approval, status: "approved", approval_id: "test-only", approved_by_actor_id: "test-only-actor", decided_at: "2026-09-13T04:00:00Z" };
  const result = seal(r);
  return { record: result, context: { ...reviewContext, resolve: () => ({ approvalId: "test-only", actorId: "test-only-actor", candidateDigests: [result.product_owner_approval.candidate_digest], conditions: result.product_owner_approval.conditions, decidedAt: result.product_owner_approval.decided_at!, expiresAt: null, revoked: false }) } };
}
function requiredPointers(schema: Schema, prefix = ""): string[] {
  if (schema.$ref) return requiredPointers(PARAMETER_SCHEMA.$defs![schema.$ref.split("/").at(-1)!]!, prefix);
  return (schema.required ?? []).flatMap((key) => [`${prefix}/${key}`, ...requiredPointers(schema.properties![key]!, `${prefix}/${key}`)]);
}
for (const pointer of requiredPointers(PARAMETER_SCHEMA)) {
  it(`FX-266-SCHEMA-MISSING-FIELD ${pointer}`, () => {
    const variant = structuredClone(pending) as unknown as Record<string, unknown>;
    const parts = pointer.slice(1).split("/"); let parent = variant;
    for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
    delete parent[parts.at(-1)!];
    const result = validateRegistry([variant], reviewContext);
    assert.ok(result.diagnostics.some((d) => d.code === "record_schema_invalid" && d.pointer === pointer));
    assert.equal(result.approved.size, 0);
  });
}
it("rejects duplicate JSON keys including escaped aliases before overwriting", () => {
  for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[{"x":{"a":1,"a":2}}]']) assert.throws(() => parseRegistryJson(source), /duplicate_key/);
  assert.equal(canonical(parseRegistryJson('{"b":2,"a":[1,null]}')), '{"a":[1,null],"b":2}');
});
it("rejects unsupported versions, unknown fields, TTL, anchors, unsafe components and digest tampering", () => {
  for (const edit of [
    (r: ParameterRecord) => { r.schema_version = 2 as 1; },
    (r: ParameterRecord) => { Object.assign(r, { extra: true }); },
    (r: ParameterRecord) => { r.counter_store.ttl_ms = 1; },
    (r: ParameterRecord) => { r.window.anchor = "2026-09-13T00:00:00Z"; },
    (r: ParameterRecord) => { r.safe_counting_key.components = ["claimed_email"]; },
    (r: ParameterRecord) => { r.threshold++; },
  ]) { const r = structuredClone(pending); edit(r); const result = validateRegistry([r], reviewContext); assert.ok(result.diagnostics.length); assert.equal(result.approved.size, 0); }
});
it("approval requires exact evidence, digest, environment, conditions, status, and expiry", () => {
  const { record, context } = syntheticApproval();
  assert.equal(validateRegistry([record], context).approved.size, 1);
  for (const variant of [{ ...context, environment: "hosted" as const }, { ...context, singleProcess: false }, { ...context, resolve: () => undefined },
    { ...context, resolve: () => ({ ...context.resolve("test-only")!, revoked: true }) },
    { ...context, resolve: () => ({ ...context.resolve("test-only")!, candidateDigests: [] }) },
    { ...context, resolve: () => ({ ...context.resolve("test-only")!, conditions: [] }) },
  ]) assert.equal(validateRegistry([record], variant).approved.size, 0);
  for (const status of ["pending", "rejected", "revoked", "expired"] as const) {
    const r = structuredClone(record); r.product_owner_approval.status = status;
    assert.equal(validateRegistry([seal(r)], context).approved.size, 0);
  }
  const expired = structuredClone(record); expired.product_owner_approval.expires_at = "2026-09-13T05:00:00Z";
  assert.equal(validateRegistry([seal(expired)], context).approved.size, 0);
});
it("never partially accepts duplicate IDs, ambiguous surfaces, broken supersession or one invalid row", () => {
  const { record, context } = syntheticApproval(); const bad = structuredClone(record); bad.record_id = "rlp-266-broken-v1"; bad.supersedes_record_id = bad.record_id;
  for (const records of [[record, record], [record, seal(bad)], [record, { ...record, threshold: -1 }]]) {
    const result = validateRegistry(records, context); assert.ok(result.diagnostics.length); assert.equal(result.approved.size, 0);
  }
});
it("checked-in actor-bound projections stay closed without independent approved recovery", () => {
  for (const pendingRecord of loadPrototypeRegistry().records.slice(1)) {
    const { record, context } = syntheticApproval(pendingRecord);
    assert.equal(validateRegistry([record], context).approved.size, 0);
  }
});
