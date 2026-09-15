"use client";
// PK-8 (CBD-234 design section 13): the in-app list of `account_lifecycle_notice` rows, each `MSG-73-*` code as a
// sentence. The API on `main` serves no such route yet (finding PK8-F01): a 404 is shown as "not available yet",
// never as an empty list. Cancellable reads require client state.
import { useCallback } from "react";
import NextLink from "next/link";
import { sentenceFor } from "../../../api/invitations";
import { useSession } from "../../../session/SessionProvider";
import { Alert } from "../../../components/Alert";
import { ReadFailure, formatInstant, useInvitationsClient, useRead } from "../invitations-shared";

export function NoticesView() {
  const { session } = useSession();
  const api = useInvitationsClient();
  const load = useCallback((signal: AbortSignal) => api.listNotices(signal), [api]);
  const list = useRead(session.sessionRef, load);
  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Notices</h1>
    <p>What happened around your memberships: invitations you accepted, people who joined, and primary-ownership transfers you are part of.</p>
    {list.error ? <ReadFailure error={list.error} retry={list.refresh} /> : !list.value ? <Alert loading>Loading notices…</Alert>
      : list.value === "unavailable" ? <Alert title="Notices are not available yet">The notices list is not served by this API yet. Your memberships and invitations are unaffected.</Alert>
      : list.value.length === 0 ? <Alert>No notices yet.</Alert>
      : <ul className="space-y-3">{list.value.map(notice => <li key={notice.noticeId} data-testid="notice-row" className="space-y-1 rounded-lg border border-border p-4">
        <p>{sentenceFor(notice.messageCode)}</p>
        <p className="text-on-surface-muted">{formatInstant(notice.createdAt)} · {notice.messageCode}{notice.budgetSpaceId && <> · <NextLink className="text-interactive underline" href={`/budgets/${encodeURIComponent(notice.budgetSpaceId)}`}>Open the budget space</NextLink></>}</p>
      </li>)}</ul>}
  </section>;
}
