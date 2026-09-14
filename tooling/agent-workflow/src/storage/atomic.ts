import { open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertContainedStatePath } from "./layout.ts";
import { storageError } from "./errors.ts";
import { canonicalJson } from "./json.ts";
import type { JsonValue } from "./types.ts";

async function durableWrite(pathname: string, content: string, flag: "wx" | "w"): Promise<void> {
  const handle = await open(pathname, flag, 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(source, target); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EACCES") || attempt >= 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 5));
    }
  }
}

export async function writeJsonAtomic(stateRoot: string, relativePath: string, value: JsonValue): Promise<string> {
  const target = await assertContainedStatePath(stateRoot, relativePath);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await durableWrite(temporary, `${JSON.stringify(value, null, 2)}\n`, "wx");
    await replaceWithRetry(temporary, target);
    return target;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeJsonImmutable(stateRoot: string, relativePath: string, value: JsonValue): Promise<string> {
  const target = await assertContainedStatePath(stateRoot, relativePath);
  await durableWrite(target, `${JSON.stringify(value, null, 2)}\n`, "wx");
  return target;
}

export async function writeJsonImmutableIdempotent(stateRoot: string, relativePath: string, value: JsonValue): Promise<string> {
  const target = await assertContainedStatePath(stateRoot, relativePath);
  try {
    return await writeJsonImmutable(stateRoot, relativePath, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let existing: JsonValue;
    try { existing = JSON.parse(await readFile(target, "utf8")) as JsonValue; }
    catch (cause) { throw storageError("STATE_RECORD_CONFLICT", `Immutable record exists but cannot be compared: ${relativePath}`, { cause: String(cause) }); }
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw storageError("STATE_RECORD_CONFLICT", `Immutable record already exists with different content: ${relativePath}`);
    }
    return target;
  }
}
