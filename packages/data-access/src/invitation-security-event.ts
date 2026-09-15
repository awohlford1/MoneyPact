/**
 * Identity-scoped statements for `invitation_security_event` (CBD-73 SS13):
 * the `AE-73-14` envelope for a presented value that resolved to nothing.
 *
 * It is a sibling of `budget_space_lifecycle_audit` rather than a row in it
 * because the ordinary case has no budget space at all -- an unknown or
 * malformed value belongs to no tenant -- so the table is identity-scoped and
 * reached through the platform seam. `abuse_fingerprint` is the same keyed,
 * non-reversible fingerprint the code row carries, so repeated presentation
 * of one value is countable without the value ever being stored.
 *
 * Insert only, for the same reason the lifecycle audit is.
 */
import { instantText, textValue } from "./budget-category.ts";
import type { PlatformStatementClient } from "./budget-space-invitation-outbox.ts";

export const INVITATION_SECURITY_EVENT_TABLE = "invitation_security_event";

export interface InvitationSecurityEventRow {
  readonly event_id: string;
  readonly event_code: string;
  readonly occurred_at: string;
  readonly budget_space_id: string | null;
  readonly outcome_class: string;
  readonly abuse_fingerprint: string | null;
  readonly correlation_id: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function toRow(value: unknown): InvitationSecurityEventRow {
  const row = value as Record<string, unknown>;
  return {
    event_id: textValue(row.event_id),
    event_code: textValue(row.event_code),
    occurred_at: instantText(row.occurred_at),
    budget_space_id: nullableText(row.budget_space_id),
    outcome_class: textValue(row.outcome_class),
    abuse_fingerprint: nullableText(row.abuse_fingerprint),
    correlation_id: textValue(row.correlation_id),
    payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
  };
}

export async function insertInvitationSecurityEvent(
  client: PlatformStatementClient, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  await client.platformInsert({
    table: INVITATION_SECURITY_EVENT_TABLE,
    values: { ...values, payload: JSON.stringify(values.payload ?? {}) },
  });
}

/** Every event of one correlation, for the live suite. There is no customer read of this table. */
export async function listInvitationSecurityEvents(
  client: PlatformStatementClient, correlationId: string,
): Promise<readonly InvitationSecurityEventRow[]> {
  const result = await client.platformSelect({
    table: INVITATION_SECURITY_EVENT_TABLE,
    conditions: [{ column: "correlation_id", value: correlationId }],
  });
  return result.rows.map(toRow);
}

export function invitationSecurityEventStatements(client: PlatformStatementClient) {
  return {
    insertSecurityEvent: (values: Readonly<Record<string, unknown>>) => insertInvitationSecurityEvent(client, values),
    listSecurityEvents: (correlationId: string) => listInvitationSecurityEvents(client, correlationId),
  };
}
