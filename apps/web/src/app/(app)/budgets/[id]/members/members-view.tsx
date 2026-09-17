"use client";
// PK-8 members list on `1.view_members` (CBD-234 design sections 5.1 and 9): display identity, role and joined-at,
// and nothing else -- never a contact, personal state or other-space data. Cancellable reads require client state.
import { useCallback } from "react";
import { roleLabel } from "../../../../../api/invitations";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { ReadFailure, SpaceNavigation, formatInstant, useInvitationsClient, useRead } from "../../../invitations-shared";

export function MembersView({ id }: { id: string }) {
  const { session } = useSession();
  const api = useInvitationsClient();
  const load = useCallback((signal: AbortSignal) => api.listMembers(id, signal), [api, id]);
  const list = useRead(`${session.sessionRef}:${id}`, load);
  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Members</h1>
    <SpaceNavigation id={id} current="members" />
    <p>Everyone who belongs to this budget space, by display name and role. A person without a display name yet is shown as a MoneyPact member.</p>
    {list.error ? <ReadFailure error={list.error} retry={list.refresh} /> : !list.value ? <Alert loading>Loading members…</Alert>
      : <ul className="space-y-4">{list.value.map(member => <li key={member.membershipId} data-testid="member-row" className="rounded-lg border border-border p-4">
        {/* SEC-F06-OBS1: the name is a text node inside <bdi>, so a bidi character in it cannot reorder the row. */}
        <h2 className="break-words text-xl font-semibold"><bdi>{member.displayName}</bdi></h2>
        {/* The four-labelled-values pattern of the progress rows (CBD-211): every value under its own name. */}
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="font-semibold">Role</dt><dd>{roleLabel(member.role)}</dd></div>
          <div><dt className="font-semibold">Joined</dt><dd>{formatInstant(member.joinedAt)}</dd></div>
          <div><dt className="font-semibold">Membership identity</dt><dd className="break-all">{member.membershipId}</dd></div>
          <div><dt className="font-semibold">Display name</dt><dd className="break-words"><bdi>{member.displayName}</bdi></dd></div>
        </dl>
      </li>)}</ul>}
  </section>;
}
