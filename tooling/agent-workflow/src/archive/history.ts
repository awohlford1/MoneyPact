import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assertContainedStatePath, assertPortableId } from "../storage/index.ts";
import type { AssignmentArchiveHistory } from "./types.ts";

async function directoryExists(filename: string): Promise<boolean> {
  try { return (await stat(filename)).isDirectory(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function resolveAssignmentHistory(stateRoot: string, assignmentId: string): Promise<AssignmentArchiveHistory> {
  assertPortableId(assignmentId, "assignment ID");
  const active = await assertContainedStatePath(stateRoot, path.join("assignments", assignmentId));
  const archiveRoot = await assertContainedStatePath(stateRoot, path.join("archive", "assignments", assignmentId));
  let batchIds: string[] = [];
  try { batchIds = (await readdir(archiveRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const activePath = await directoryExists(active) ? active : undefined;
  return {
    assignmentId,
    ...(activePath === undefined ? {} : { activePath }),
    batches: batchIds.map((batchId) => ({ batchId, path: path.join(archiveRoot, batchId, "records") })),
  };
}
