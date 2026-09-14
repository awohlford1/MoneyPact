import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeJsonImmutableIdempotent } from "../storage/atomic.ts";
import { storageError } from "../storage/errors.ts";
import { assertContainedStatePath, assertPortableId } from "../storage/layout.ts";
import type { JsonValue } from "../storage/types.ts";
import { assertValidCoreRecord } from "../validation/persistence.ts";

export type ConcreteActionOutcome = "succeeded" | "failed" | "prevented" | "cancelled";

export interface PendingAction {
  schema_version: "1.0";
  record_id: string;
  record_type: "pending";
  created_at: string;
  pending_id: string;
  action_id: string;
  assignment_id: string;
  status: "unresolved";
  observed_outcome: "unknown";
}

export interface ActionReconciliation {
  schema_version: "1.0";
  record_id: string;
  record_type: "action-reconciliation";
  created_at: string;
  reconciliation_id: string;
  action_id: string;
  assignment_id: string;
  operation_id: string;
  outcome: ConcreteActionOutcome;
  reconciled_at: string;
  evidence_refs?: string[];
  rationale: string;
}

function pendingRelative(actionId: string): string { return path.join("pending", `${actionId}.json`); }

export async function createPendingAction(stateRoot: string, pending: PendingAction): Promise<string> {
  assertPortableId(pending.action_id, "action ID");
  if (pending.status !== "unresolved" || pending.observed_outcome !== "unknown") throw storageError("PENDING_INVALID_OUTCOME", "Pending actions must remain unresolved with an unknown observed outcome");
  assertValidCoreRecord("pending", pending);
  return writeJsonImmutableIdempotent(stateRoot, pendingRelative(pending.action_id), pending as unknown as JsonValue);
}

export async function readPendingAction(stateRoot: string, actionId: string): Promise<PendingAction | undefined> {
  assertPortableId(actionId, "action ID");
  const filename = await assertContainedStatePath(stateRoot, pendingRelative(actionId));
  try { return JSON.parse(await readFile(filename, "utf8")) as PendingAction; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function reconcilePendingAction(stateRoot: string, actionId: string, reconciliation: ActionReconciliation): Promise<string> {
  assertPortableId(actionId, "action ID");
  if ((["succeeded", "failed", "prevented", "cancelled"] as string[]).includes(reconciliation.outcome) === false) {
    throw storageError("PENDING_INVALID_OUTCOME", "Pending actions require a concrete reconciliation outcome", { outcome: reconciliation.outcome });
  }
  assertValidCoreRecord("action-reconciliation", reconciliation);
  const reconciliationRelative = path.join("validations", `reconciliation-${actionId}-${reconciliation.operation_id}.json`);
  const reconciliationPath = await assertContainedStatePath(stateRoot, reconciliationRelative);
  try {
    await readFile(reconciliationPath, "utf8");
    const existing = await writeJsonImmutableIdempotent(stateRoot, reconciliationRelative, reconciliation as unknown as JsonValue);
    await rm(await assertContainedStatePath(stateRoot, pendingRelative(actionId)), { force: true });
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const pending = await readPendingAction(stateRoot, actionId);
  if (pending === undefined) throw storageError("STATE_RECORD_NOT_FOUND", `Pending action not found: ${actionId}`);
  if (reconciliation.action_id !== actionId || reconciliation.assignment_id !== pending.assignment_id) {
    throw storageError("PENDING_ACTION_MISMATCH", "Reconciliation does not refer to the pending action and assignment");
  }
  const target = await writeJsonImmutableIdempotent(stateRoot, reconciliationRelative, reconciliation as unknown as JsonValue);
  await rm(await assertContainedStatePath(stateRoot, pendingRelative(actionId)));
  return target;
}
