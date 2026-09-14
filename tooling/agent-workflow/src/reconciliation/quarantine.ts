import path from "node:path";
import { readFile } from "node:fs/promises";
import { writeJsonAtomic, writeJsonImmutableIdempotent } from "../storage/atomic.ts";
import { assertContainedStatePath, assertPortableId } from "../storage/layout.ts";
import type { JsonValue } from "../storage/types.ts";
import type { QuarantineRecord } from "./awaiting.ts";
import { assertValidCoreRecord } from "../validation/persistence.ts";

export async function quarantineSubmission(stateRoot: string, record: QuarantineRecord): Promise<string> {
  assertPortableId(record.quarantine_id, "quarantine ID");
  if (record.submission === undefined || record.validation_errors.length === 0) {
    throw new Error("Quarantine requires original content and at least one validation failure");
  }
  assertValidCoreRecord("quarantine", record);
  return writeJsonImmutableIdempotent(
    stateRoot,
    path.join("quarantine", `${record.quarantine_id}.original.json`),
    record as unknown as JsonValue,
  );
}

export async function readQuarantineSubmission(stateRoot: string, quarantineId: string): Promise<QuarantineRecord | undefined> {
  assertPortableId(quarantineId, "quarantine ID");
  const filename = await assertContainedStatePath(stateRoot, path.join("quarantine", `${quarantineId}.original.json`));
  try { return JSON.parse(await readFile(filename, "utf8")) as QuarantineRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export interface QuarantineResolution {
  schema_version: string;
  quarantine_id: string;
  resolution_id: string;
  disposition: "corrected" | "dismissed";
  resolved_at: string;
  actor_id: string;
  rationale: string;
  replacement_record_id?: string;
}

export async function resolveQuarantine(stateRoot: string, resolution: QuarantineResolution): Promise<string> {
  assertPortableId(resolution.quarantine_id, "quarantine ID");
  assertPortableId(resolution.resolution_id, "resolution ID");
  const current = await readQuarantineSubmission(stateRoot, resolution.quarantine_id);
  if (current === undefined) throw new Error(`Quarantine record not found: ${resolution.quarantine_id}`);
  const updated: QuarantineRecord = {
    ...current,
    status: "resolved",
    resolution: `${resolution.disposition}: ${resolution.rationale}${resolution.replacement_record_id ? ` (replacement ${resolution.replacement_record_id})` : ""}`,
    updated_at: resolution.resolved_at,
  };
  assertValidCoreRecord("quarantine", updated);
  return writeJsonAtomic(stateRoot, path.join("quarantine", `${resolution.quarantine_id}.original.json`), updated as unknown as JsonValue);
}
