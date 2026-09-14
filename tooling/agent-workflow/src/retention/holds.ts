import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertContainedStatePath, assertPortableId, writeJsonAtomic } from "../storage/index.ts";
import type { JsonValue } from "../storage/index.ts";
import type { HoldRecord } from "./types.ts";
import { assertValidCoreRecord } from "../validation/persistence.ts";

const HOLDS_DIRECTORY = path.join("cleanup", "holds");

export async function saveHold(stateRoot: string, hold: HoldRecord): Promise<string> {
  assertPortableId(hold.hold_id, "hold ID");
  if (hold.record_id !== hold.hold_id) throw new Error("Hold record_id must equal hold_id");
  assertValidCoreRecord("hold", hold);
  await mkdir(await assertContainedStatePath(stateRoot, HOLDS_DIRECTORY), { recursive: true });
  return writeJsonAtomic(stateRoot, path.join(HOLDS_DIRECTORY, `${hold.hold_id}.json`), hold as unknown as JsonValue);
}

export async function releaseHold(stateRoot: string, holdId: string, releasedAt: string): Promise<HoldRecord> {
  assertPortableId(holdId, "hold ID");
  const filename = await assertContainedStatePath(stateRoot, path.join(HOLDS_DIRECTORY, `${holdId}.json`));
  const hold = JSON.parse(await readFile(filename, "utf8")) as HoldRecord;
  if (hold.status === "released") return hold;
  const released: HoldRecord = { ...hold, status: "released", released_at: releasedAt, updated_at: releasedAt };
  await saveHold(stateRoot, released);
  return released;
}

export async function loadHolds(stateRoot: string): Promise<HoldRecord[]> {
  const directory = await assertContainedStatePath(stateRoot, HOLDS_DIRECTORY);
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const holds: HoldRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    holds.push(JSON.parse(await readFile(path.join(directory, name), "utf8")) as HoldRecord);
  }
  return holds;
}
