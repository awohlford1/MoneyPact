/**
 * Tenant-scoped statements for `manual_transaction_idempotency` (CBD-200-AC05,
 * PROTO-CBD200-CONCURRENCY-IDEMPOTENCY-001; migration 20260915T140000Z).
 *
 * One row per (budget space, acting membership, action, Idempotency-Key),
 * inserted in the same transaction as the version it records. There is no
 * update and no delete: the migration refuses UPDATE (23514) and revokes
 * DELETE from the runtime roles, so a stored response is exactly the one the
 * route returned when the key was first accepted. A caller reads the row
 * before the effect (outside any transaction) to answer a replay, and writes
 * it inside the effect's transaction; the unique scope makes two concurrent
 * first attempts under one key a 23505 for the second, which the caller maps
 * to a conflict.
 */
import { instantText, integerValue, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const MANUAL_TRANSACTION_IDEMPOTENCY_TABLE = "manual_transaction_idempotency";

export type ManualTransactionIdempotencyStatementClient = TenantStatementClient;

export const MANUAL_TRANSACTION_IDEMPOTENCY_ACTIONS = ["create", "edit", "remove"] as const;
export type ManualTransactionIdempotencyAction = (typeof MANUAL_TRANSACTION_IDEMPOTENCY_ACTIONS)[number];

export interface ManualTransactionIdempotencyRow {
  readonly idempotency_id: string;
  readonly budget_space_id: string;
  readonly membership_id: string;
  readonly action: ManualTransactionIdempotencyAction;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly transaction_version_id: string;
  readonly committed_response: unknown;
  /** SEC-C200-F1: the acting membership's authorization_version at write time (migration 20260915T160000Z). */
  readonly authorization_version: number;
  readonly created_at: string;
}

export interface ManualTransactionIdempotencyScope {
  readonly budgetSpaceId: string;
  readonly membershipId: string;
  readonly action: ManualTransactionIdempotencyAction;
  readonly idempotencyKey: string;
}

function actionValue(value: unknown): ManualTransactionIdempotencyAction {
  if (!(MANUAL_TRANSACTION_IDEMPOTENCY_ACTIONS as readonly string[]).includes(textValue(value))) throw new TypeError("expected an idempotency action");
  return value as ManualTransactionIdempotencyAction;
}

function toRow(value: unknown): ManualTransactionIdempotencyRow {
  const row = value as Record<string, unknown>;
  return {
    idempotency_id: textValue(row.idempotency_id),
    budget_space_id: textValue(row.budget_space_id),
    membership_id: textValue(row.membership_id),
    action: actionValue(row.action),
    idempotency_key: textValue(row.idempotency_key),
    request_digest: textValue(row.request_digest),
    transaction_version_id: textValue(row.transaction_version_id),
    committed_response: row.committed_response,
    authorization_version: integerValue(row.authorization_version),
    created_at: instantText(row.created_at),
  };
}

/** The committed row for one idempotency scope, or null when the key has never been accepted in it. */
export async function readManualTransactionIdempotency(client: ManualTransactionIdempotencyStatementClient, scope: ManualTransactionIdempotencyScope): Promise<ManualTransactionIdempotencyRow | null> {
  const result = await client.tenantSelect({
    table: MANUAL_TRANSACTION_IDEMPOTENCY_TABLE,
    budgetSpaceId: scope.budgetSpaceId,
    conditions: [
      { column: "membership_id", value: scope.membershipId },
      { column: "action", value: scope.action },
      { column: "idempotency_key", value: scope.idempotencyKey },
    ],
  });
  const first = result.rows[0];
  return first === undefined ? null : toRow(first);
}

export type ManualTransactionIdempotencyInsert = Omit<ManualTransactionIdempotencyRow, "idempotency_id" | "created_at"> & { readonly idempotency_id?: string; readonly created_at?: string };

/** Writes the scope's one row; runs inside the effect's transaction so the response never outlives the version it names. */
export async function insertManualTransactionIdempotency(client: ManualTransactionIdempotencyStatementClient, row: ManualTransactionIdempotencyInsert): Promise<void> {
  const { budget_space_id, committed_response, ...values } = row;
  await client.tenantInsert({
    table: MANUAL_TRANSACTION_IDEMPOTENCY_TABLE,
    budgetSpaceId: budget_space_id,
    values: { ...values, committed_response: JSON.stringify(committed_response) },
  });
}

/** The statement set the application's data-access adapter is composed from. */
export function manualTransactionIdempotencyStatements(client: ManualTransactionIdempotencyStatementClient) {
  return {
    readIdempotency: (scope: ManualTransactionIdempotencyScope) => readManualTransactionIdempotency(client, scope),
    insertIdempotency: (row: ManualTransactionIdempotencyInsert) => insertManualTransactionIdempotency(client, row),
  };
}
