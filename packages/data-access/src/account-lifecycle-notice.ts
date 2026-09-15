/**
 * Identity-scoped statements for `account_lifecycle_notice` (`DR-73-11`).
 *
 * A notice belongs to a person, not to a budget space, and one may exist with
 * no space at all -- so the table is identity-scoped and reached through the
 * platform seam, and every read here is predicated on the subject whose
 * notices they are. There is no delivery in the prototype: the row *is* the
 * notice, written inside the transaction that caused it, and no delivery is
 * ever an authorization or commit dependency (CBD-280-AC06).
 *
 * The row carries a message code and never the copy, and never another
 * person's state: `MSG-73-052` in particular tells a declined acceptor
 * nothing of who decided or why (CBD-73 SS5.1 item 6).
 */
import { instantText, nullableInstantText, textValue } from "./budget-category.ts";
import type { PlatformStatementClient } from "./budget-space-invitation-outbox.ts";

export const ACCOUNT_LIFECYCLE_NOTICE_TABLE = "account_lifecycle_notice";

export interface AccountLifecycleNoticeRow {
  readonly notice_id: string;
  readonly account_subject_id: string;
  readonly budget_space_id: string | null;
  readonly message_code: string;
  readonly event_correlation_id: string;
  readonly created_at: string;
  readonly read_at: string | null;
}

function toRow(value: unknown): AccountLifecycleNoticeRow {
  const row = value as Record<string, unknown>;
  return {
    notice_id: textValue(row.notice_id),
    account_subject_id: textValue(row.account_subject_id),
    budget_space_id: row.budget_space_id === null || row.budget_space_id === undefined ? null : textValue(row.budget_space_id),
    message_code: textValue(row.message_code),
    event_correlation_id: textValue(row.event_correlation_id),
    created_at: instantText(row.created_at),
    read_at: nullableInstantText(row.read_at),
  };
}

export async function insertAccountLifecycleNotice(
  client: PlatformStatementClient, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  await client.platformInsert({ table: ACCOUNT_LIFECYCLE_NOTICE_TABLE, values });
}

/**
 * One person's notices. The predicate is the subject's, never the space's:
 * a notice is read by the subject it belongs to and is never projected by
 * `budget_space_id` (`SEC-PK2-F07` follow-up for PK-5).
 */
export async function listAccountLifecycleNotices(
  client: PlatformStatementClient, accountSubjectId: string,
): Promise<readonly AccountLifecycleNoticeRow[]> {
  const result = await client.platformSelect({
    table: ACCOUNT_LIFECYCLE_NOTICE_TABLE,
    conditions: [{ column: "account_subject_id", value: accountSubjectId }],
  });
  return result.rows.map(toRow);
}

/**
 * Marks one of the subject's own notices read. There is no `read_at IS NULL`
 * predicate here because the closed condition grammar has no null operator;
 * the PK-2 trigger is what makes `read_at` set-once, so a second call raises
 * rather than silently re-stamping.
 */
export async function markAccountLifecycleNoticeRead(
  client: PlatformStatementClient, accountSubjectId: string, noticeId: string, at: string,
): Promise<number> {
  const result = await client.platformUpdate({
    table: ACCOUNT_LIFECYCLE_NOTICE_TABLE,
    set: { read_at: at },
    conditions: [
      { column: "notice_id", value: noticeId },
      { column: "account_subject_id", value: accountSubjectId },
    ],
  });
  return result.rowCount ?? 0;
}

export function accountLifecycleNoticeStatements(client: PlatformStatementClient) {
  return {
    insertNotice: (values: Readonly<Record<string, unknown>>) => insertAccountLifecycleNotice(client, values),
    listNotices: (accountSubjectId: string) => listAccountLifecycleNotices(client, accountSubjectId),
    markNoticeRead: (accountSubjectId: string, noticeId: string, at: string) =>
      markAccountLifecycleNoticeRead(client, accountSubjectId, noticeId, at),
  };
}
