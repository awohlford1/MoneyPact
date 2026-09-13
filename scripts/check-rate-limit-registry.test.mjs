import assert from "node:assert/strict";
import { it } from "node:test";
import { checkInventory, printReport } from "./check-rate-limit-registry.mjs";
import { loadPrototypeRegistry, loadRegistrations } from "../packages/rate-limit/src/index.ts";

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
