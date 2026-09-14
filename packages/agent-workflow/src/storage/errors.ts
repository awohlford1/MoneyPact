import { AgentWorkflowError } from "../contracts/errors.ts";

export const STORAGE_ERROR_CODES = [
  "STATE_PATH_ESCAPE",
  "STATE_LINK_REJECTED",
  "STATE_INVALID_IDENTIFIER",
  "STATE_RECORD_EXISTS",
  "STATE_RECORD_NOT_FOUND",
  "STATE_RECORD_CONFLICT",
  "STATE_IO_ERROR",
  "EVENT_ID_CONFLICT",
  "EVENT_SEQUENCE_INVALID",
  "LOCK_TIMEOUT",
  "LOCK_NOT_OWNED",
  "LEASE_CONFLICT",
  "LEASE_NOT_OWNED",
  "LEASE_TRANSFER_INVALID",
  "PENDING_INVALID_OUTCOME",
  "PENDING_ACTION_MISMATCH",
  "VALIDATION_REJECTED",
] as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

export function storageError(
  code: StorageErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AgentWorkflowError<StorageErrorCode> {
  return new AgentWorkflowError({ code, message, ...(details === undefined ? {} : { details }) });
}
