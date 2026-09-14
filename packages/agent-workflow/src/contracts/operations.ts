import type { ActorRef } from "./actors.ts";
import type { FrameworkError } from "./errors.ts";

export const OPERATION_OUTCOMES = [
  "succeeded",
  "failed",
  "prevented",
  "cancelled",
  "unknown",
] as const;

export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

export interface OperationRequest<T = unknown> {
  operationId: string;
  command: string;
  actor: ActorRef;
  projectRoot: string;
  assignmentId?: string;
  taskId?: string;
  executionId?: string;
  payload: T;
}

export interface OperationResult<T = unknown> {
  operationId: string;
  status: OperationOutcome;
  eventIds: string[];
  data?: T;
  error?: FrameworkError;
}
