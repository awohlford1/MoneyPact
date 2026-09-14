import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "./atomic.ts";
import { assertContainedStatePath, assertPortableId } from "./layout.ts";
import type { JsonValue } from "./types.ts";

export interface LedgerProjection<T = JsonValue> {
  projection: string;
  generated_at: string;
  source_digest?: string;
  data: T;
}

export interface LedgerProjector<T = JsonValue> {
  name: string;
  build(): Promise<LedgerProjection<T>>;
}

export async function publishLedgerProjection<T extends JsonValue>(stateRoot: string, projection: LedgerProjection<T>): Promise<string> {
  assertPortableId(projection.projection, "projection name");
  return writeJsonAtomic(stateRoot, path.join("ledger", `${projection.projection}.json`), projection as unknown as JsonValue);
}

export async function readLedgerProjection<T = JsonValue>(stateRoot: string, name: string): Promise<LedgerProjection<T> | undefined> {
  assertPortableId(name, "projection name");
  const filename = await assertContainedStatePath(stateRoot, path.join("ledger", `${name}.json`));
  try { return JSON.parse(await readFile(filename, "utf8")) as LedgerProjection<T>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function rebuildLedgerProjection<T extends JsonValue>(stateRoot: string, projector: LedgerProjector<T>): Promise<LedgerProjection<T>> {
  const projection = await projector.build();
  if (projection.projection !== projector.name) throw new Error(`Projector ${projector.name} produced projection ${projection.projection}`);
  await publishLedgerProjection(stateRoot, projection);
  return projection;
}
