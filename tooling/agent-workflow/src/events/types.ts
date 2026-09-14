import type { ActorType } from "../contracts/actors.ts";
import type { JsonValue } from "../storage/types.ts";

export interface EventInput<T extends JsonValue = JsonValue> {
  schema_version: string;
  event_id: string;
  event_type: string;
  occurred_at: string | null;
  recorded_at?: string;
  actor: StoredActorRef;
  recorded_by: StoredActorRef;
  assignment_id?: string;
  task_id?: string;
  execution_id?: string;
  action_id?: string;
  subject?: { record_type: string; record_id: string; revision?: number };
  caused_by_event_id?: string;
  provider_context?: Readonly<Record<string, JsonValue>>;
  data: T;
  artifact_refs?: StoredRecordRef[];
}

export interface StoredActorRef {
  actor_id: string;
  actor_type: ActorType;
  display_name?: string;
}

export interface StoredRecordRef {
  record_type: string;
  record_id: string;
  revision?: number;
}

export interface EventEnvelope<T extends JsonValue = JsonValue> extends EventInput<T> {
  sequence: number;
  recorded_at: string;
}

export interface EventAcknowledgement {
  eventId: string;
  sequence: number;
  recordedAt: string;
  logPath: string;
  digest: string;
  idempotent: boolean;
}
