import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskPacket } from "../../src/workflows/index.ts";

test("builds a compact provider-neutral task packet", () => {
  const packet = buildTaskPacket({ task_id: "tsk-1", execution_id: "exe-1", assignment_id: "asn-1", objective: "Implement endpoint", scope: ["src/api.ts"], exclusions: ["deployment"], acceptance_criteria: [{ id: "AC-1", text: "Tests pass" }], permissions: ["edit src/api.ts"], constraints: ["no schema changes"], expected_outputs: ["implementation", "test evidence"], requested_model: { provider: "codex", model: "configured-model" } }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(packet.record_type, "task-packet"); assert.equal(packet.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(packet.record_id, "pkt-exe-1"); assert.notEqual(packet.record_id, packet.task_id);
  assert.equal("conversation" in packet, false);
});

test("rejects duplicate acceptance criterion identities", () => {
  assert.throws(() => buildTaskPacket({ task_id: "tsk-1", execution_id: "exe-1", assignment_id: "asn-1", objective: "Implement", scope: [], exclusions: [], acceptance_criteria: [{ id: "AC-1", text: "one" }, { id: "AC-1", text: "two" }], permissions: [], constraints: [], expected_outputs: ["result"], requested_model: { provider: "codex", model: "configured-model" } }), /unique/);
});
