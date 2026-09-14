import assert from "node:assert/strict";
import { test } from "node:test";
import { registrationErrors, seal, validateRegistry } from "../../../../packages/rate-limit/src/index.ts";
import type { ParameterRecord, Registration } from "../../../../packages/rate-limit/src/index.ts";
import proposal from "./rate-limit-proposal.json" with { type: "json" };

void test("all budget route registrations and pending parameter records validate without granting approval", () => {
  const records = proposal.records as unknown as ParameterRecord[];
  const registrations = proposal.registrations as unknown as Registration[];
  assert.equal(registrations.length, 8);
  assert.equal(new Set(registrations.map(row => row.registration_id)).size, 8);
  for (const row of registrations) {
    assert.deepEqual(registrationErrors(row), []);
    assert.equal(records.find(record => record.record_id === row.parameter_record_id)?.surface_id, row.surface_id);
  }
  const registry = validateRegistry(records, { now: new Date().toISOString(), environment: "local-prototype", singleProcess: true, resolve: () => undefined });
  assert.deepEqual(registry.diagnostics, []); assert.equal(registry.approved.size, 0);
  for (const record of records) {
    assert.equal(record.product_owner_approval.status, "pending");
    assert.equal(record.record_digest, seal(record).record_digest);
  }
});
