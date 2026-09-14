import type { AssignmentArchiveFacts, HoldRecord } from "../retention/index.ts";

export type ArchiveStage = "planned" | "copying" | "verified" | "published" | "source_removed" | "completed" | "failed";

export interface ArchivePlanEntry {
  record: { record_type: string; record_id: string; revision?: number };
  source: string;
  destination: string;
  digest: string;
  size: number;
}

export interface ArchivePlan {
  schema_version: "1.0";
  operation_id: string;
  batch_id: string;
  assignment_id: string;
  created_at: string;
  retention_days: number;
  source_root: string;
  destination_root: string;
  eligible: boolean;
  reasons: string[];
  entries: ArchivePlanEntry[];
}

export interface ArchiveManifest {
  schema_version: "1.0";
  record_id: string;
  record_type: "archive-manifest";
  created_at: string;
  manifest_id: string;
  batch_id: string;
  entries: Array<Omit<ArchivePlanEntry, "size">>;
  status: "published";
}

export interface ArchiveJournal {
  operation_id: string;
  batch_id: string;
  assignment_id: string;
  created_at: string;
  updated_at: string;
  stage: ArchiveStage;
  last_successful_stage?: Exclude<ArchiveStage, "failed">;
  plan: ArchivePlan;
  error?: string;
}

export interface PlanAssignmentArchiveOptions {
  stateRoot: string;
  assignmentId: string;
  batchId?: string;
  operationId?: string;
  /** @deprecated Ignored. Eligibility is derived from canonical state. */
  facts?: AssignmentArchiveFacts;
  /** @deprecated Ignored. Holds are loaded from canonical persisted state. */
  holds?: readonly HoldRecord[];
  retentionDays?: number;
  now?: Date;
  maxEntries?: number;
}

export interface ApplyArchiveOptions {
  stateRoot: string;
  plan: ArchivePlan;
  injectFailure?: (stage: Exclude<ArchiveStage, "failed">) => void | Promise<void>;
}

export interface ArchiveApplyResult {
  status: "completed" | "no-op";
  manifestPath: string;
  filesArchived: number;
}

export interface AssignmentArchiveHistory {
  assignmentId: string;
  activePath?: string;
  batches: Array<{ batchId: string; path: string }>;
}
