import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { validateAuthorizationPolicyHistory } from "./check-authorization-policy-history.mjs";

const canonicalize = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonicalize).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
const hash = (value) => createHash("sha256").update(canonicalize(value)).digest("hex");
const serialization = { version: "p1", schemaVersion: 1, actionDefinitions: [{ action: "1.view_space" }], userCells: [{ action: "1.view_space", notation: "Read" }], serviceCells: [] };
const pinned = hash(serialization);
const registry = { p1: { ...serialization, digest: pinned } };
const row = { version: "p1", digest: pinned, schemaVersion: 1, releaseCommit: "abc123", productApprovalRef: "product-approval", securityApprovalRef: "security-approval" };

describe("authorization policy release history guard", () => {
  it("accepts a valid unchanged released row", () => assert.deepEqual(validateAuthorizationPolicyHistory({ baseRows: [row], candidateRows: [row], registry }), []));
  it("rejects changing an old cell", () => {
    const changed = { p1: { ...registry.p1, userCells: [{ action: "1.view_space", notation: "Deny" }] } };
    assert.ok(validateAuthorizationPolicyHistory({ baseRows: [row], candidateRows: [row], registry: changed }).some((failure) => failure.includes("digest")));
  });
  it("rejects changing only the adjacent registry digest", () => {
    const changed = { p1: { ...registry.p1, digest: "0".repeat(64) } };
    assert.ok(validateAuthorizationPolicyHistory({ baseRows: [row], candidateRows: [row], registry: changed }).some((failure) => failure.includes("digest")));
  });
  it("rejects rewriting an old history row", () => {
    const rewritten = { ...row, digest: "0".repeat(64) };
    assert.ok(validateAuthorizationPolicyHistory({ baseRows: [row], candidateRows: [rewritten], registry }).some((failure) => failure.includes("changed")));
  });
  it("rejects removing an old history row", () => {
    assert.ok(validateAuthorizationPolicyHistory({ baseRows: [row], candidateRows: [], registry }).some((failure) => failure.includes("removed")));
  });
});
