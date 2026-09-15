"use client";
// PK-8 owner pages (CBD-234 design section 5.1; CBD-73 sections 4.5 and 5.1): invite a person, the invitation list
// with resend, replace and cancel, and the confirm or reject of a requested acceptance (TR-73-39). Form state,
// idempotency keys and status announcements require client state.
import { useCallback, useState } from "react";
import { InvitationApiError, INVITATION_STATE_LABELS, roleLabel } from "../../../../../api/invitations";
import type { InvitableRole, WireInvitation } from "../../../../../api/invitations";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Input } from "../../../../../components/Input";
import { Select } from "../../../../../components/Select";
import { ReadFailure, SpaceNavigation, describeFailure, formatInstant, useInvitationsClient, useRead } from "../../../invitations-shared";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const INVITE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  destination_invalid: "Enter the email address to invite.",
  proposed_role_unsupported: "Choose Collaborator or Co-owner.",
  permission_mismatch: "A pending invitation to this address was sent with a different role. Cancel it first, or send the same role.",
  budget_space_not_live: "This budget space is not live, so nobody can be invited to it.",
  idempotency_key_reused: "This invitation was already sent. Refresh the list.",
});

export function InvitationsView({ id }: { id: string }) {
  const { session } = useSession();
  const api = useInvitationsClient();
  const load = useCallback((signal: AbortSignal) => api.listInvitations(id, signal), [api, id]);
  const list = useRead(`${session.sessionRef}:${id}`, load);
  const [notice, setNotice] = useState<{ tone: "neutral" | "danger"; text: string }>();
  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Invitations</h1>
    <SpaceNavigation id={id} current="invitations" />
    <InviteForm id={id} sent={invitation => { setNotice({ tone: "neutral", text: `Invitation sent to ${invitation.destinationMasked} as ${roleLabel(invitation.proposedRole)}.` }); list.refresh(); }} />
    {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    <section aria-labelledby="invitation-list-heading" className="space-y-4">
      <h2 id="invitation-list-heading" className="text-2xl font-semibold">Sent invitations</h2>
      <p>An accepted invitation waits here until you confirm it. Confirming shares this budget space with the person; rejecting ends only that acceptance, and the person learns nothing about why.</p>
      {list.error ? <ReadFailure error={list.error} retry={list.refresh} /> : !list.value ? <Alert loading>Loading invitations…</Alert> : list.value.length === 0 ? <Alert>No invitations yet.</Alert>
        : <ul className="space-y-4">{list.value.map(invitation => <InvitationRow key={`${invitation.invitationId}:${invitation.state}`} id={id} invitation={invitation} changed={(text, tone) => { setNotice({ tone: tone ?? "neutral", text }); list.refresh(); }} />)}</ul>}
    </section>
  </section>;
}

function InviteForm({ id, sent }: { id: string; sent(invitation: WireInvitation): void }) {
  const api = useInvitationsClient();
  const [destination, setDestination] = useState("");
  const [role, setRole] = useState<InvitableRole>("collaborator");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // One idempotency key per attempt at one invitation: a retry of the same form replays, a changed form is a new key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  async function submit() {
    setError("");
    if (!EMAIL.test(destination.trim())) { setError(INVITE_MESSAGES.destination_invalid!); return; }
    setBusy(true);
    try {
      const invitation = await api.createInvitation(id, { destination, proposedRole: role }, idempotencyKey);
      setDestination(""); setIdempotencyKey(crypto.randomUUID()); sent(invitation);
    } catch (failure) {
      if (failure instanceof InvitationApiError && failure.denied) setError(role === "co_owner" ? "Only the Primary Owner can invite a Co-owner." : "Your current session cannot invite people to this budget space.");
      else if (failure instanceof InvitationApiError && INVITE_MESSAGES[failure.code]) setError(INVITE_MESSAGES[failure.code]!);
      else setError(describeFailure(failure, "We could not send this invitation. You can try again."));
    } finally { setBusy(false); }
  }
  return <form noValidate aria-labelledby="invite-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2 id="invite-heading" className="text-2xl font-semibold">Invite a person</h2>
    <p>The invitation goes by email. The person proves they control that address, signs in or creates their MoneyPact account, reads what the role means and chooses. Nothing is shared until you confirm their acceptance.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Input id="invite-destination" label="Email address" type="email" autoComplete="off" value={destination} onChange={event => { setDestination(event.target.value); setIdempotencyKey(crypto.randomUUID()); }} error={error || undefined} />
      <Select id="invite-role" label="Role" value={role} onChange={event => { setRole(event.target.value as InvitableRole); setIdempotencyKey(crypto.randomUUID()); }}>
        <option value="collaborator">Collaborator</option>
        <option value="co_owner">Co-owner</option>
      </Select>
    </div>
    <p className="text-on-surface-muted">{role === "co_owner" ? "A Co-owner shares the day-to-day running of this budget space with the Primary Owner and cannot remove the Primary Owner or delete the space." : "A Collaborator plans and records the shared budget as an equal contributor and cannot manage members, permissions, or anyone else's bank connections."}</p>
    <Button type="submit" loading={busy}>Send invitation</Button>
  </form>;
}

function InvitationRow({ id, invitation, changed }: { id: string; invitation: WireInvitation; changed(text: string, tone?: "neutral" | "danger"): void }) {
  const api = useInvitationsClient();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const pending = invitation.state === "pending";
  const awaitingConfirmation = invitation.state === "awaiting_confirmation";
  const act = async (name: string, work: () => Promise<string>) => {
    setBusy(name); setError("");
    try { changed(await work()); }
    catch (failure) {
      if (failure instanceof InvitationApiError && failure.code === "invitation_not_current") setError(name === "confirm" || name === "reject" ? "No acceptance is waiting for this invitation." : "This invitation is no longer current. Refresh the list.");
      else setError(describeFailure(failure));
    } finally { setBusy(undefined); }
  };
  const label = `${invitation.destinationMasked} (${roleLabel(invitation.proposedRole)})`;
  return <li className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="break-words font-semibold">{invitation.destinationMasked}</h3>
    <dl className="grid gap-2 sm:grid-cols-2">
      <div><dt className="font-semibold">Proposed role</dt><dd>{roleLabel(invitation.proposedRole)}</dd></div>
      <div><dt className="font-semibold">State</dt><dd>{INVITATION_STATE_LABELS[invitation.state] ?? invitation.state}</dd></div>
      <div><dt className="font-semibold">Sent</dt><dd>{formatInstant(invitation.issuedAt)}</dd></div>
      <div><dt className="font-semibold">{pending || awaitingConfirmation ? "Expires" : "Inactive since"}</dt><dd>{formatInstant(invitation.inactiveAt)}</dd></div>
    </dl>
    {pending && <div className="flex flex-wrap gap-3">
      <Button variant="secondary" loading={busy === "resend"} disabled={Boolean(busy)} onClick={() => void act("resend", async () => { await api.replaceInvitation(id, invitation.invitationId, "resend"); return `Invitation to ${label} sent again. The earlier link no longer works.`; })}>Resend to {invitation.destinationMasked}</Button>
      <Button variant="secondary" loading={busy === "replace"} disabled={Boolean(busy)} onClick={() => void act("replace", async () => { await api.replaceInvitation(id, invitation.invitationId, "replace"); return `Invitation to ${label} replaced with a new one.`; })}>Replace invitation to {invitation.destinationMasked}</Button>
      <Button variant="danger" loading={busy === "cancel"} disabled={Boolean(busy)} onClick={() => void act("cancel", async () => { await api.cancelInvitation(id, invitation.invitationId); return `Invitation to ${label} cancelled.`; })}>Cancel invitation to {invitation.destinationMasked}</Button>
    </div>}
    {awaitingConfirmation && <div className="flex flex-wrap gap-3">
      <Button loading={busy === "confirm"} disabled={Boolean(busy)} onClick={() => void act("confirm", async () => { const receipt = await api.confirmAcceptance(id, invitation.invitationId, crypto.randomUUID()); return `Acceptance confirmed: the person joined as ${roleLabel(receipt.role)}.`; })}>Confirm acceptance from {invitation.destinationMasked}</Button>
      <Button variant="danger" loading={busy === "reject"} disabled={Boolean(busy)} onClick={() => void act("reject", async () => { await api.rejectAcceptance(id, invitation.invitationId); return `Acceptance from ${label} rejected. Nothing was shared.`; })}>Reject acceptance from {invitation.destinationMasked}</Button>
    </div>}
    {error && <Alert tone="danger">{error}</Alert>}
  </li>;
}
