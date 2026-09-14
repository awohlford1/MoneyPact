import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { it } from "node:test";
import { checkInventory, printReport } from "./check-rate-limit-registry.mjs";
import { loadPrototypeRegistry, loadRegistrations, seal, validateRegistry, prototypeApprovalContext } from "../packages/rate-limit/src/index.ts";

it("prints all six sorted diagnostic sections, fails deliberate omissions, then passes restored inventory", () => {
  const registrations = loadRegistrations(); const registry = loadPrototypeRegistry();
  const discovered = registrations.map((r) => ({ id: r.registration_id, source: r.source_locator }));
  const output = []; const write = (line) => output.push(line);
  assert.equal(printReport(checkInventory([...discovered, { id: "api:GET:/negative", source: "negative-api-fixture" }, { id: "job:worker:negative:1", source: "negative-worker-fixture" }], registrations, registry), write), false);
  assert.ok(output.some((line) => line.includes("api:GET:/negative")));
  assert.ok(output.some((line) => line.includes("job:worker:negative:1")));
  assert.equal(printReport(checkInventory(discovered, registrations, registry), write), true);
  assert.equal(output.filter((line) => /^[A-Z_]+ \(/.test(line)).length, 12);
});
it("fails stale, duplicate, unknown and pending parameter bindings", () => {
  const registry = loadPrototypeRegistry(); const registrations = loadRegistrations();
  const bounded = { ...registrations[0], registration_id: "api:POST:/new", surface_id: "surf-266-budget-mutation", parameter_record_id: "rlp-266-mutation-v1", authorization_metadata_id: "test-only" };
  const report = checkInventory([], [...registrations, bounded, { ...bounded, surface_id: "surf-266-unknown" }], registry);
  assert.ok(report.UNKNOWN_SURFACES.length); assert.ok(report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS.length); assert.ok(report.STALE_REGISTRATIONS.length);
  const duplicates = checkInventory([{ id: "api:POST:/new", source: "fixture" }], [bounded, bounded], registry);
  assert.ok(duplicates.DUPLICATE_REGISTRATIONS.length);
});

it("rejects a route bound to an explicitly pending record", () => {
  const records = loadPrototypeRegistry().records.map((r) => seal({ ...r, product_owner_approval: { ...r.product_owner_approval, status: "pending" } }));
  const registry = validateRegistry(records, prototypeApprovalContext());
  const registration = { registration_id: "api:GET:/pending", executor_kind: "api_route", source_locator: "fixture.ts#pending", surface_id: "surf-266-budget-read", parameter_record_id: "rlp-266-authenticated-read-v1", registration_lifecycle: "active", introduced_by: "test", authorization_metadata_id: "test" };
  const report = checkInventory([{ id: registration.registration_id, source: registration.source_locator }], [registration], registry);
  assert.deepEqual(report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS, [registration.registration_id]);
});

it("guard fails a changed approval digest and passes restored evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "rate-limit-guard-")); const path = join(dir, "approvals.json");
  const original = readFileSync(new URL("../config/rate-limit/approvals.json", import.meta.url), "utf8");
  const registrations = loadRegistrations();
  const discovered = registrations.map((r) => ({ id: r.registration_id, source: r.source_locator }));
  try {
    const evidence = JSON.parse(original); evidence[0].candidateDigests[0] = "0".repeat(64);
    writeFileSync(path, JSON.stringify(evidence));
    const broken = loadPrototypeRegistry(path);
    assert.equal(printReport(checkInventory(discovered, registrations, broken)), false);
    assert.ok(broken.diagnostics.some((d) => d.code === "approval_evidence_invalid"));
    writeFileSync(path, original);
    const restored = loadPrototypeRegistry(path);
    assert.equal(printReport(checkInventory(discovered, registrations, restored)), true);
    // Five prototype sets plus rlp-266-identity-session-v1 and rlp-266-identity-ceremony-v1, projected next
    // to rlp-266-bootstrap-v1 on a disjoint stage set (CBD266-IDENTITY-RECORDS-001, CBD266-SURFACE-STAGES-001).
    assert.equal(restored.approved.size, 7);
    console.log("Restored approval evidence: approved=7");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
