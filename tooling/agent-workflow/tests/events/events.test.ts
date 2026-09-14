import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentWorkflowError } from "../../src/contracts/errors.ts";
import { appendEvent, readDailyEvents } from "../../src/events/index.ts";
import { initializeStateRoot } from "../../src/storage/index.ts";

const actor = { actor_id: "runtime-1", actor_type: "runtime" as const };

test("concurrent appends allocate globally unique increasing sequences and valid JSONL", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-events-"));
  const recordedAt = "2026-09-13T12:00:00.000Z";
  const acknowledgements = await Promise.all(Array.from({ length: 30 }, (_, index) => appendEvent({
    projectRoot, operationId: `op-${index}`, event: {
      schema_version: "1.0", event_id: `event-${index}`, event_type: "task.created",
      occurred_at: recordedAt, recorded_at: recordedAt, actor, recorded_by: actor,
      data: { index },
    },
  })));
  const sequences = acknowledgements.map((item) => item.sequence).sort((a, b) => a - b);
  assert.deepEqual(sequences, Array.from({ length: 30 }, (_, index) => index + 1));
  const { stateRoot } = await initializeStateRoot(projectRoot);
  const events = await readDailyEvents(stateRoot, "2026-09-13");
  assert.equal(events.length, 30);
  assert.deepEqual(events.map((item) => item.sequence), sequences);
});

test("same event ID and content is idempotent while conflicting content is rejected", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "aw-event-id-"));
  const base = {
    schema_version: "1.0", event_id: "event-same", event_type: "action.started",
    occurred_at: null, actor, recorded_by: actor, data: { action: "test" },
  };
  const first = await appendEvent({ projectRoot, operationId: "op-first", event: base });
  const second = await appendEvent({ projectRoot, operationId: "op-retry", event: base });
  assert.equal(second.sequence, first.sequence);
  assert.equal(second.idempotent, true);
  await assert.rejects(
    appendEvent({ projectRoot, operationId: "op-conflict", event: { ...base, data: { action: "different" } } }),
    (error) => error instanceof AgentWorkflowError && error.code === "EVENT_ID_CONFLICT",
  );
});
