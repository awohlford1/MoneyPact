export type MaintenanceAction = "archive" | "delete";
export type HoldScope = "archive" | "delete" | "archive_and_delete";

export interface HoldTarget {
  record_type: string;
  record_id: string;
  revision?: number;
}

export interface HoldRecord {
  schema_version: "1.0";
  record_id: string;
  record_type: "hold";
  created_at: string;
  updated_at?: string;
  hold_id: string;
  targets: HoldTarget[];
  placed_by: {
    actor_id: string;
    actor_type: "executive" | "manager" | "specialist" | "runtime" | "external_system";
    display_name?: string;
  };
  reason: string;
  scope: HoldScope;
  status: "active" | "released" | "expired";
  expires_at?: string;
  released_at?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export interface AssignmentArchiveFacts {
  target: HoldTarget;
  lifecycleState: string;
  closureDisposition?: string;
  closedAt?: string;
  reopenedAt?: string;
  relatedRecordsDiscoverable: boolean;
  referencesResolve: boolean;
  unresolvedExecutions: number;
  unresolvedActions: number;
  identitiesValid: boolean;
  hashesValid: boolean;
}

export interface TimedRecordFacts {
  target: HoldTarget;
  recordedAt: string;
  retired?: boolean;
  resolved?: boolean;
  promotedToEvidence?: boolean;
}
