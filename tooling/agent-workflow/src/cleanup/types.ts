import type { HoldRecord } from "../retention/index.ts";

export interface CleanupPlanEntry {
  target: string;
  record_id: string;
  reason: "raw_response_retention_elapsed";
  digest: string;
}

export interface CleanupPlan {
  schema_version: "1.0";
  operation_id: string;
  created_at: string;
  retention_days: number;
  mode: "dry-run" | "apply";
  bounded: boolean;
  entries: CleanupPlanEntry[];
}

export interface PlanRawResponseCleanupOptions {
  stateRoot: string;
  operationId: string;
  mode: "dry-run" | "apply";
  now?: Date;
  retentionDays?: number;
  /** @deprecated Ignored. Holds are loaded from canonical persisted state. */
  holds?: readonly HoldRecord[];
  maxEntries?: number;
  maxBytes?: number;
}

export interface CleanupManifest {
  schema_version: "1.0";
  record_id: string;
  record_type: "cleanup-manifest";
  created_at: string;
  manifest_id: string;
  mode: "apply";
  entries: Array<{ target: string; reason: string; digest: string }>;
  status: "completed";
}

export interface CleanupJournal {
  operation_id: string;
  created_at: string;
  updated_at: string;
  stage: "planned" | "deleting" | "completed" | "failed";
  plan: CleanupPlan;
  error?: string;
}

export interface CleanupApplyResult {
  status: "completed" | "no-op";
  deleted: number;
  manifestPath: string;
}
