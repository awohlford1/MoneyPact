/**
 * The CBD-246 seam for the two audit tables of CBD-73 SS13:
 * `budget_space_lifecycle_audit` (budget-space scope) and
 * `invitation_security_event` (identity scope).
 *
 * Both are append-only. The payload allowlist is the application module's and
 * is applied before a row exists (`assertAuditPayload`), so this module does
 * no filtering of its own; the two rules it does apply are the ones that are
 * properties of the *write* rather than of the event:
 *
 *  * a restricted-only class can never be written with `audience =
 *    'customer'`. The PK-2 CHECK refuses it and this module refuses it first,
 *    because a 23514 at COMMIT would roll back the whole causing transaction
 *    for what is a programming error in one audit row;
 *  * an `AE-73-14` for a value that resolved to nothing carries a null
 *    `budget_space_id`, which is exactly why that class lives in the sibling
 *    identity-scope table rather than in the space's own audit.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import { insertLifecycleAudit, listLifecycleAudit } from "../../../data-access/src/budget-space-lifecycle-audit.ts";
import type { BudgetSpaceLifecycleAuditRow } from "../../../data-access/src/budget-space-lifecycle-audit.ts";
import { insertInvitationSecurityEvent, listInvitationSecurityEvents } from "../../../data-access/src/invitation-security-event.ts";
import type { InvitationSecurityEventRow } from "../../../data-access/src/invitation-security-event.ts";
import { InvitationError, RESTRICTED_ONLY_EVENT_CODES } from "../invitations/records.ts";

export type { BudgetSpaceLifecycleAuditRow, InvitationSecurityEventRow };

export async function writeLifecycleAudit(
  client: DataAccessClient, budgetSpaceId: string, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (RESTRICTED_ONLY_EVENT_CODES.includes(String(values.event_code)) && values.audience !== "restricted") {
    throw new InvitationError("constraint_violation", "audit.audience");
  }
  await insertLifecycleAudit(client, budgetSpaceId, values);
}

export async function writeInvitationSecurityEvent(
  client: DataAccessClient, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  await insertInvitationSecurityEvent(client, values);
}

export function lifecycleAuditStatements(client: DataAccessClient) {
  return {
    insertAudit: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => writeLifecycleAudit(client, budgetSpaceId, values),
    insertSecurityEvent: (values: Readonly<Record<string, unknown>>) => writeInvitationSecurityEvent(client, values),
  };
}

/** Reads, for the live suite and for PK-6's restricted-vs-customer projection. */
export function lifecycleAuditReads(client: DataAccessClient) {
  return {
    listAudit: (budgetSpaceId: string) => listLifecycleAudit(client, budgetSpaceId),
    listSecurityEvents: (correlationId: string) => listInvitationSecurityEvents(client, correlationId),
  };
}
