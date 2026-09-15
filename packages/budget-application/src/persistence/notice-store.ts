/**
 * The CBD-246 seam for `account_lifecycle_notice` (`DR-73-11`).
 *
 * Rows are written inside the transaction that caused them -- the `AE-73-30`
 * enqueue -- and there is no external delivery in the prototype: the row is
 * the notice, and no delivery is ever an authorization or a commit dependency
 * (CBD-280-AC06). Nothing here retries, queues, or defers.
 *
 * The read is the subject's own and only the subject's. A notice is personal
 * state (CBD-8-AC08): it is never listed by budget space, and `MSG-73-052` in
 * particular tells a declined acceptor nothing of who decided or why, which
 * is why the row carries a message code and no copy at all.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import {
  insertAccountLifecycleNotice, listAccountLifecycleNotices, markAccountLifecycleNoticeRead,
} from "../../../data-access/src/account-lifecycle-notice.ts";
import type { AccountLifecycleNoticeRow } from "../../../data-access/src/account-lifecycle-notice.ts";
import { InvitationError, NOTICE_MESSAGE_CODES } from "../invitations/records.ts";

export type { AccountLifecycleNoticeRow };

export async function writeLifecycleNotice(client: DataAccessClient, values: Readonly<Record<string, unknown>>): Promise<void> {
  if (!(NOTICE_MESSAGE_CODES as readonly string[]).includes(String(values.message_code))) {
    throw new InvitationError("constraint_violation", "notice.messageCode");
  }
  await insertAccountLifecycleNotice(client, values);
}

export function noticeStatements(client: DataAccessClient) {
  return {
    insertNotice: (values: Readonly<Record<string, unknown>>) => writeLifecycleNotice(client, values),
  };
}

/** The subject's own notice list, and the set-once read stamp. Never scoped by budget space. */
export function noticeReads(client: DataAccessClient) {
  return {
    listOwnNotices: (accountSubjectId: string) => listAccountLifecycleNotices(client, accountSubjectId),
    markOwnNoticeRead: (accountSubjectId: string, noticeId: string, at: string) =>
      markAccountLifecycleNoticeRead(client, accountSubjectId, noticeId, at),
  };
}
