import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { applyAssignmentArchive } from "../archive/index.ts";
import type { ArchiveApplyResult, ArchiveJournal } from "../archive/index.ts";
import { assertContainedStatePath } from "../storage/index.ts";

export interface ArchiveRecoveryResult {
  operationId: string;
  priorStage: ArchiveJournal["stage"];
  result: ArchiveApplyResult;
}

export async function recoverInterruptedArchives(stateRoot: string, maxOperations = 100): Promise<ArchiveRecoveryResult[]> {
  const directory = await assertContainedStatePath(stateRoot, path.join("archive", ".operations"));
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const results: ArchiveRecoveryResult[] = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort().slice(0, maxOperations)) {
    const journal = JSON.parse(await readFile(path.join(directory, name), "utf8")) as ArchiveJournal;
    if (journal.stage === "completed") continue;
    const result = await applyAssignmentArchive({ stateRoot, plan: journal.plan });
    results.push({ operationId: journal.operation_id, priorStage: journal.stage, result });
  }
  return results;
}
