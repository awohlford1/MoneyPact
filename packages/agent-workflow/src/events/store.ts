import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Clock } from "../contracts/time.ts";
import { systemClock } from "../contracts/time.ts";
import { withOperationLock } from "../concurrency/locks.ts";
import { writeJsonAtomic } from "../storage/atomic.ts";
import { storageError } from "../storage/errors.ts";
import { jsonDigest } from "../storage/json.ts";
import { assertContainedStatePath, assertPortableId, initializeStateRoot } from "../storage/layout.ts";
import type { JsonValue, StructuralValidator } from "../storage/types.ts";
import type { EventAcknowledgement, EventEnvelope, EventInput } from "./types.ts";

interface EventReceipt extends EventAcknowledgement { inputDigest: string }

async function readJson<T>(filename: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(filename, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

function withoutRecordedAt(input: EventInput): JsonValue {
  const copy = { ...input };
  delete copy.recorded_at;
  return copy as unknown as JsonValue;
}

async function appendDurably(filename: string, line: string): Promise<void> {
  const handle = await open(filename, "a", 0o600);
  try { await handle.writeFile(line, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

async function inspectLogs(stateRoot: string, eventId: string, inputDigest: string): Promise<{ receipt?: EventReceipt; maximumSequence: number }> {
  const eventsDirectory = await assertContainedStatePath(stateRoot, "events");
  const files = (await readdir(eventsDirectory).catch(() => [])).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name));
  let maximumSequence = 0;
  const seenSequences = new Set<number>();
  let receipt: EventReceipt | undefined;
  for (const name of files.sort()) {
    const content = await readFile(path.join(eventsDirectory, name), "utf8");
    for (const line of content.split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line) as EventEnvelope;
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || seenSequences.has(event.sequence)) {
        throw storageError("EVENT_SEQUENCE_INVALID", "Event log contains a duplicate or invalid sequence", { sequence: event.sequence, log: name });
      }
      seenSequences.add(event.sequence);
      maximumSequence = Math.max(maximumSequence, event.sequence);
      if (event.event_id !== eventId) continue;
      const recoveredInput = { ...event } as Record<string, unknown>;
      delete recoveredInput.sequence;
      delete recoveredInput.recorded_at;
      const recoveredDigest = jsonDigest(recoveredInput as JsonValue);
      if (recoveredDigest !== inputDigest) throw storageError("EVENT_ID_CONFLICT", `Event ID already exists with different content: ${eventId}`);
      receipt = {
        eventId, sequence: event.sequence, recordedAt: event.recorded_at,
        logPath: path.join(eventsDirectory, name), digest: jsonDigest(event as unknown as JsonValue),
        inputDigest, idempotent: true,
      };
    }
  }
  return { ...(receipt === undefined ? {} : { receipt }), maximumSequence };
}

export interface AppendEventOptions<T extends JsonValue = JsonValue> {
  projectRoot: string;
  stateDirectory?: string;
  event: EventInput<T>;
  operationId: string;
  validator?: StructuralValidator<EventInput<T>>;
  schemaId?: string;
  clock?: Clock;
}

export async function appendEvent<T extends JsonValue = JsonValue>(options: AppendEventOptions<T>): Promise<EventAcknowledgement> {
  assertPortableId(options.event.event_id, "event ID");
  assertPortableId(options.operationId, "operation ID");
  const { stateRoot } = await initializeStateRoot(options.projectRoot, options.stateDirectory);
  const inputDigest = jsonDigest(withoutRecordedAt(options.event));
  const receiptRelative = path.join(".runtime", "event-receipts", `${options.event.event_id}.json`);
  const receiptPath = await assertContainedStatePath(stateRoot, receiptRelative);
  return withOperationLock({ stateRoot, resource: "event-append", ownerId: options.operationId }, async () => {
    const existing = await readJson<EventReceipt>(receiptPath);
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) throw storageError("EVENT_ID_CONFLICT", `Event ID already exists with different content: ${options.event.event_id}`);
      return { ...existing, idempotent: true };
    }
    const inspected = await inspectLogs(stateRoot, options.event.event_id, inputDigest);
    if (inspected.receipt !== undefined) {
      await writeJsonAtomic(stateRoot, receiptRelative, inspected.receipt as unknown as JsonValue);
      return inspected.receipt;
    }
    const sequenceRelative = path.join(".runtime", "event-sequence.json");
    const sequencePath = await assertContainedStatePath(stateRoot, sequenceRelative);
    const prior = await readJson<{ lastSequence: number }>(sequencePath);
    if (prior !== undefined && (!Number.isSafeInteger(prior.lastSequence) || prior.lastSequence < 0)) {
      throw storageError("EVENT_SEQUENCE_INVALID", "Persisted event sequence is invalid", { lastSequence: prior.lastSequence });
    }
    const sequence = Math.max(prior?.lastSequence ?? 0, inspected.maximumSequence) + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw storageError("EVENT_SEQUENCE_INVALID", "Unable to allocate a valid event sequence");
    await writeJsonAtomic(stateRoot, sequenceRelative, { lastSequence: sequence });
    const clock = options.clock ?? systemClock;
    const recordedAt = options.event.recorded_at ?? clock.now().toISOString();
    const date = recordedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(recordedAt))) {
      throw storageError("VALIDATION_REJECTED", "recorded_at must be an ISO timestamp", { recordedAt });
    }
    const envelope: EventEnvelope<T> = { ...options.event, sequence, recorded_at: recordedAt };
    if (options.validator !== undefined) {
      if (options.schemaId === undefined) throw storageError("VALIDATION_REJECTED", "A schema ID is required when a structural validator is supplied");
      const result = await options.validator.validate(options.schemaId, envelope, options.event.schema_version);
      if (!result.valid) throw storageError("VALIDATION_REJECTED", "Event failed structural validation", { errors: result.errors });
    }
    const logPath = await assertContainedStatePath(stateRoot, path.join("events", `${date}.jsonl`));
    await appendDurably(logPath, `${JSON.stringify(envelope)}\n`);
    const receipt: EventReceipt = {
      eventId: envelope.event_id, sequence, recordedAt, logPath,
      digest: jsonDigest(envelope as unknown as JsonValue), inputDigest, idempotent: false,
    };
    await writeJsonAtomic(stateRoot, receiptRelative, receipt as unknown as JsonValue);
    return receipt;
  });
}

export async function readDailyEvents(stateRoot: string, date: string): Promise<EventEnvelope[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw storageError("STATE_INVALID_IDENTIFIER", "Invalid UTC event-log date", { date });
  const filename = await assertContainedStatePath(stateRoot, path.join("events", `${date}.jsonl`));
  try {
    return (await readFile(filename, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as EventEnvelope);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
