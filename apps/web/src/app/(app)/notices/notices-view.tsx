"use client";
// PK-8 (CBD-234 design section 13): the in-app list of `account_lifecycle_notice` rows, each `MSG-73-*` code as a
// sentence, from the subject-self notices routes (PK8-F01): the person's own rows, newest first, with the set-once
// read stamp. A notice that names a Primary-ownership transfer links to the space's transfer page, which opens the
// live transfer for its two parties (PK8-F04). Cancellable reads require client state.
import { useCallback, useState } from "react";
import NextLink from "next/link";
import { TRANSFER_MESSAGE_CODES, sentenceFor } from "../../../api/invitations";
import { useSession } from "../../../session/SessionProvider";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { ReadFailure, describeFailure, formatInstant, useInvitationsClient, useRead } from "../invitations-shared";

export function NoticesView() {
  const { session } = useSession();
  const api = useInvitationsClient();
  const load = useCallback((signal: AbortSignal) => api.listNotices(signal), [api]);
  const list = useRead(session.sessionRef, load);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  async function markRead(noticeId: string) {
    setBusy(noticeId); setError("");
    try { await api.markNoticeRead(noticeId); list.refresh(); }
    catch (failure) { setError(describeFailure(failure, "We could not mark this notice read. You can try again.")); }
    finally { setBusy(undefined); }
  }
  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Notices</h1>
    <p>What happened around your memberships: invitations you accepted, people who joined, and primary-ownership transfers you are part of.</p>
    {error && <Alert tone="danger">{error}</Alert>}
    {list.error ? <ReadFailure error={list.error} retry={list.refresh} /> : !list.value ? <Alert loading>Loading notices…</Alert>
      : list.value.length === 0 ? <Alert>No notices yet.</Alert>
      : <ul className="space-y-3">{list.value.map(notice => {
        const space = notice.budgetSpaceId ? `/budgets/${encodeURIComponent(notice.budgetSpaceId)}` : undefined;
        const transfer = space && TRANSFER_MESSAGE_CODES.has(notice.messageCode);
        return <li key={notice.noticeId} data-testid="notice-row" data-read={notice.readAt ? "read" : "unread"} className="space-y-2 rounded-lg border border-border p-4">
          <p className={notice.readAt ? "text-on-surface-muted" : "font-semibold"}>{sentenceFor(notice.messageCode)}</p>
          <p className="text-on-surface-muted">{formatInstant(notice.createdAt)} · {notice.messageCode} · {notice.readAt ? `read ${formatInstant(notice.readAt)}` : "unread"}
            {space && <> · <NextLink className="text-interactive underline" href={transfer ? `${space}/transfer` : space}>{transfer ? "Open the transfer" : "Open the budget space"}</NextLink></>}</p>
          {!notice.readAt && <Button variant="secondary" loading={busy === notice.noticeId} disabled={Boolean(busy)} onClick={() => void markRead(notice.noticeId)}>Mark as read</Button>}
        </li>;
      })}</ul>}
  </section>;
}
