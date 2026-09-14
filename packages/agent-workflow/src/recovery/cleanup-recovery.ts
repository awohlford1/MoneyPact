import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { applyRawResponseCleanup } from "../cleanup/index.ts";
import type { CleanupApplyResult, CleanupJournal } from "../cleanup/index.ts";
import { assertContainedStatePath } from "../storage/index.ts";

export interface CleanupRecoveryResult {
  operationId: string;
  priorStage: CleanupJournal["stage"];
  result: CleanupApplyResult;
}

export async function recoverInterruptedCleanups(stateRoot: string, maxOperations = 100): Promise<CleanupRecoveryResult[]> {
  const directory = await assertContainedStatePath(stateRoot, path.join("cleanup", ".operations"));
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const results: CleanupRecoveryResult[] = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort().slice(0, maxOperations)) {
    const journal = JSON.parse(await readFile(path.join(directory, name), "utf8")) as CleanupJournal;
    if (journal.stage === "completed") continue;
    const result = await applyRawResponseCleanup(stateRoot, journal.plan);
    results.push({ operationId: journal.operation_id, priorStage: journal.stage, result });
  }
  return results;
}
