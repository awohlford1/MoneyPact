"use client";
// PK-8 Primary-transfer pages (CBD-234 design sections 10.2, 10.4; CBD-73 section 12; PR 368's PK-8 handoff):
// propose to a member, the recipient's accept or decline, the Primary Owner's confirm -- which first runs the
// step-up ceremony (POST /v1/identity/step-up/begin bound to 29.transfer_primary_ownership and this space, then
// the provider callback) and then confirms the live transferId read from the view -- withdraw, and the status view.
//
// The rules the Security readings placed here, each visible below: the step-up is begun immediately before the
// confirm and the confirm names the transfer id read from the view at that moment, never a remembered one; a
// `freshAssurance: "consumed"` answer with `next: "step_up_required"` is shown as "run the identity check again";
// the uniform 403 on confirm is shown as "not the live transfer, not the Primary Owner, or the identity check is not
// fresh or was made for something else"; a confirm is never resent under a new grant expecting a replay; no
// reference, ledger or digest field is ever placed in a request; and transfer ids are shown only to the two parties
// (anyone else is answered `transfer_not_found`, which this page shows as "no such transfer for you").
//
// The recipient's and the outgoing disclosures are the approved texts under docs/consent-disclosures/. The view
// carries their kind and version but not their text (finding PK8-F03), so the approved v1 files are bundled here
// and each is shown only when its kind and version equal the ones the transfer was proposed under.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import recipientDisclosure from "../../../../../../../../docs/consent-disclosures/primary-transfer-recipient.v1.json" with { type: "json" };
import outgoingDisclosure from "../../../../../../../../docs/consent-disclosures/primary-transfer-outgoing.v1.json" with { type: "json" };
import { InvitationApiError, TRANSFER_STATE_LABELS, roleLabel, sentenceFor } from "../../../../../api/invitations";
import type { ConfirmTransferOutcome, WireMember } from "../../../../../api/invitations";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Checkbox } from "../../../../../components/Choice";
import { Select } from "../../../../../components/Select";
import { ReadFailure, SpaceNavigation, describeFailure, formatInstant, leaveReturnMarker, useInvitationsClient, useRead } from "../../../invitations-shared";

const LIVE: readonly string[] = ["proposed", "recipient_accepted", "primary_confirmed", "ready"];
interface DisclosureFile { kind: string; version: number; heading: string; items: readonly { id: string; text: string }[]; acknowledgement: string }
const RECIPIENT: DisclosureFile = recipientDisclosure;
const OUTGOING: DisclosureFile = outgoingDisclosure;

/** The Primary Owner proposes the transfer to one active member of the space (TR-73-40). */
export function ProposeTransferView({ id }: { id: string }) {
  const { session } = useSession();
  const api = useInvitationsClient();
  const router = useRouter();
  const load = useCallback(async (signal: AbortSignal) => ({ members: await api.listMembers(id, signal), own: await api.ownMembership(id, signal) }), [api, id]);
  const read = useRead(`${session.sessionRef}:${id}`, load);
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ownRole = read.value?.members.find(member => member.membershipId === read.value?.own)?.role;
  const candidates = read.value?.members.filter(member => member.membershipId !== read.value?.own) ?? [];
  async function propose() {
    setError("");
    if (!recipient) { setError("Choose the member who would become Primary Owner."); return; }
    setBusy(true);
    try {
      const answer = await api.proposeTransfer(id, recipient);
      router.push(`/budgets/${encodeURIComponent(id)}/transfer/${encodeURIComponent(answer.transfer.transferId)}`);
    } catch (failure) {
      if (failure instanceof InvitationApiError && failure.denied) setError("Only the Primary Owner can propose a transfer of primary ownership.");
      else if (failure instanceof InvitationApiError && failure.code === "transfer_already_live") setError("A transfer is already in progress for this budget space. Open it from the notice, or withdraw it first.");
      else if (failure instanceof InvitationApiError && failure.status === 409) setError(`${sentenceFor(String(failure.body.messageCode ?? ""))} Choose an active member other than yourself.`);
      else setError(describeFailure(failure, "We could not propose this transfer. You can try again."));
    } finally { setBusy(false); }
  }
  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Primary ownership</h1>
    <SpaceNavigation id={id} current="transfer" />
    <p>Every budget space has exactly one Primary Owner. Handing that role to another member is a two-sided step: the member accepts what it means, and the Primary Owner confirms after a fresh identity check. Nothing changes until both have happened.</p>
    {read.error ? <ReadFailure error={read.error} retry={read.refresh} /> : !read.value ? <Alert loading>Loading members…</Alert>
      : ownRole !== "primary_owner" ? <Alert title="Only the Primary Owner can propose a transfer">Your role in this budget space is {roleLabel(ownRole ?? "")}. If a transfer names you as the recipient, open it from your notices.</Alert>
      : <form aria-labelledby="propose-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void propose(); }}>
        <h2 id="propose-heading" className="text-2xl font-semibold">Propose a transfer</h2>
        <Select id="transfer-recipient" label="Member who would become Primary Owner" value={recipient} onChange={event => setRecipient(event.target.value)} error={error || undefined}>
          <option value="">Choose a member</option>
          {candidates.map(member => <option key={member.membershipId} value={member.membershipId}>{member.displayName} · {roleLabel(member.role)}</option>)}
        </Select>
        {candidates.length === 0 && <p>Nobody else belongs to this budget space yet. Invite a person first.</p>}
        <Button type="submit" loading={busy} disabled={candidates.length === 0}>Propose transfer</Button>
      </form>}
  </section>;
}

export function TransferView({ id, transferId, resume }: { id: string; transferId: string; resume: boolean }) {
  const { session } = useSession();
  const api = useInvitationsClient();
  const load = useCallback(async (signal: AbortSignal) => {
    const transfer = await api.viewTransfer(id, transferId, signal);
    const [members, own] = await Promise.all([api.listMembers(id, signal), api.ownMembership(id, signal)]);
    return { transfer, members, own };
  }, [api, id, transferId]);
  const read = useRead(`${session.sessionRef}:${id}:${transferId}`, load);
  const [notice, setNotice] = useState<{ tone: "neutral" | "danger"; title?: string; text: string } | undefined>(() => resume
    ? { tone: "neutral", title: "Identity check complete", text: "Read the consequences again, then confirm the transfer. The check is valid for a few minutes and is used by exactly one confirmation." }
    : undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [stepUpDone, setStepUpDone] = useState(resume);
  const value = read.value;
  const transfer = value?.transfer;
  const party = transfer && value ? (value.own === transfer.proposerMembershipId ? "proposer" : value.own === transfer.recipientMembershipId ? "recipient" : "none") : "none";
  const live = Boolean(transfer && LIVE.includes(transfer.state));
  const nameOf = (membershipId: string, members: readonly WireMember[]) => members.find(member => member.membershipId === membershipId)?.displayName ?? "A MoneyPact member";

  const act = async (name: string, work: () => Promise<{ tone?: "neutral" | "danger"; title?: string; text: string }>) => {
    setBusy(name); setNotice(undefined);
    try { setNotice({ tone: "neutral", ...(await work()) }); read.refresh(); }
    catch (failure) {
      if (failure instanceof InvitationApiError && failure.code === "transfer_not_found") setNotice({ tone: "danger", text: "There is no such transfer for you." });
      else if (failure instanceof InvitationApiError && failure.status === 409) setNotice({ tone: "danger", text: `${sentenceFor(String(failure.body.messageCode ?? "MSG-73-046"))} Refresh to read the current state.` });
      else setNotice({ tone: "danger", text: describeFailure(failure) });
    } finally { setBusy(undefined); }
  };
  async function stepUp() {
    setBusy("step-up"); setNotice(undefined);
    try {
      leaveReturnMarker({ path: `/budgets/${encodeURIComponent(id)}/transfer/${encodeURIComponent(transferId)}`, resume: "confirm" });
      window.location.assign(await api.beginStepUp(id));
    } catch (failure) { setBusy(undefined); setNotice({ tone: "danger", text: describeFailure(failure, "We could not start the identity check. You can try again.") }); }
  }
  async function confirm() {
    setBusy("confirm"); setNotice(undefined);
    try {
      // The live transfer id, read from the view immediately before the confirm: a stale or remembered id costs a step-up.
      const current = await api.viewTransfer(id, transferId);
      // R-01: a confirm that reaches the module consumes the grant whatever it answers (PR 368 finding 2), so a transfer
      // the read shows as no longer live is not confirmed at all; the grant stays unspent for the next attempt.
      if (!LIVE.includes(current.state)) {
        setNotice({ tone: "danger", title: "Not confirmed", text: `${sentenceFor(current.state === "withdrawn" ? "MSG-73-044" : current.state === "declined" ? "MSG-73-043" : current.state === "expired" ? "MSG-73-045" : current.state === "committed" ? "MSG-73-042" : "MSG-73-027")} Your identity check was not used.` });
        read.refresh();
        return;
      }
      const outcome: ConfirmTransferOutcome = await api.confirmTransfer(id, current.transferId);
      setStepUpDone(false);
      if (outcome.outcome === "committed") setNotice({ tone: "neutral", title: "Transfer committed", text: "The recipient is now the Primary Owner of this budget space and you are a Co-owner. Any Co-owner invitation you had sent was cancelled." });
      else if (outcome.outcome === "primary_confirmed" || outcome.outcome === "ready") setNotice({ tone: "neutral", title: "Your confirmation is recorded", text: "The transfer commits once the recipient accepts. Your identity check was used by this confirmation." });
      else if (outcome.outcome === "step_up_again") setNotice({ tone: "danger", title: "Run the identity check again", text: `${sentenceFor(outcome.messageCode)} That attempt used your identity check, so run it again before trying again.` });
      else if (outcome.outcome === "denied") setNotice({ tone: "danger", title: "Not confirmed", text: "This is not the live transfer, you are not its Primary Owner, or your identity check is not fresh or was made for something else. Refresh, then run the identity check again." });
      else if (outcome.outcome === "refused") setNotice({ tone: "danger", text: `${describeFailure(new InvitationApiError(outcome.status, outcome.error))} Your identity check was not used.` });
      read.refresh();
    } catch (failure) { setNotice({ tone: "danger", text: describeFailure(failure) }); }
    finally { setBusy(undefined); }
  }

  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Primary-ownership transfer</h1>
    <SpaceNavigation id={id} current="transfer" />
    {read.error ? (read.error instanceof InvitationApiError && read.error.code === "transfer_not_found"
      ? <Alert tone="danger" title="No such transfer for you">Either this transfer does not exist or you are not one of its two parties.</Alert>
      : <ReadFailure error={read.error} retry={read.refresh} />)
      : !value || !transfer ? <Alert loading>Loading the transfer…</Alert> : <>
      {notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
      <dl className="grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-2">
        <div><dt className="font-semibold">State</dt><dd data-testid="transfer-state">{TRANSFER_STATE_LABELS[transfer.state] ?? transfer.state}</dd></div>
        <div><dt className="font-semibold">Transfer identity</dt><dd className="break-all">{transfer.transferId}</dd></div>
        <div><dt className="font-semibold">Proposed by</dt><dd>{nameOf(transfer.proposerMembershipId, value.members)}{party === "proposer" ? " (you)" : ""}</dd></div>
        <div><dt className="font-semibold">Proposed to</dt><dd>{nameOf(transfer.recipientMembershipId, value.members)}{party === "recipient" ? " (you)" : ""}</dd></div>
        <div><dt className="font-semibold">Recipient accepted</dt><dd>{formatInstant(transfer.recipientAcceptedAt)}</dd></div>
        <div><dt className="font-semibold">Primary Owner confirmed</dt><dd>{formatInstant(transfer.primaryConfirmedAt)}</dd></div>
        <div><dt className="font-semibold">{transfer.committedAt ? "Committed" : "Expires"}</dt><dd>{formatInstant(transfer.committedAt ?? transfer.expiresAt)}</dd></div>
        {/* The bootstrap reports `fresh` only for the request's own action and space (PK-4), so a page cannot read the grant; it reports the step it took. */}
        {party === "proposer" && <div><dt className="font-semibold">Identity check</dt><dd>{stepUpDone ? "completed for this transfer; used by exactly one confirmation" : "required before confirming"}</dd></div>}
      </dl>
      <Button variant="secondary" onClick={read.refresh}>Refresh transfer</Button>
      {live && party === "recipient" && (transfer.state === "proposed" || transfer.state === "primary_confirmed") && <DisclosureSurface file={RECIPIENT} kind={transfer.recipientDisclosureKind} version={transfer.recipientDisclosureVersion} acknowledged={acknowledged} onAcknowledged={setAcknowledged} idPrefix="recipient">
        <p>Accepting or declining is your explicit choice. Nothing is chosen for you.</p>
        <div className="flex flex-wrap gap-3">
          <Button loading={busy === "accept"} disabled={!acknowledged || Boolean(busy)} onClick={() => void act("accept", async () => { const answer = await api.acceptTransfer(id, transferId); return answer.outcome === "committed" ? { title: "Transfer committed", text: "You are now the Primary Owner of this budget space." } : { title: "Acceptance recorded", text: sentenceFor(answer.messageCode) + " The transfer commits once the Primary Owner confirms after a fresh identity check." }; })}>Accept primary ownership</Button>
          <Button variant="danger" loading={busy === "decline"} disabled={Boolean(busy)} onClick={() => void act("decline", async () => { await api.declineTransfer(id, transferId); return { title: "Transfer declined", text: "Roles are unchanged. The Primary Owner learns only that the transfer ended." }; })}>Decline</Button>
        </div>
      </DisclosureSurface>}
      {live && party === "recipient" && transfer.state === "recipient_accepted" && <Alert>You accepted. The transfer commits once the Primary Owner confirms after a fresh identity check.</Alert>}
      {live && party === "proposer" && <>
        {(transfer.state === "proposed" || transfer.state === "recipient_accepted") && <DisclosureSurface file={OUTGOING} kind={transfer.outgoingDisclosureKind} version={transfer.outgoingDisclosureVersion} acknowledged={acknowledged} onAcknowledged={setAcknowledged} idPrefix="outgoing">
          <p>Confirming asks for a fresh identity check first. The check is bound to this action and this budget space, and one check is used by exactly one confirmation.</p>
          <div className="flex flex-wrap gap-3">
            {!stepUpDone && <Button loading={busy === "step-up"} disabled={!acknowledged || Boolean(busy)} onClick={() => void stepUp()}>Continue to the identity check</Button>}
            {stepUpDone && <Button loading={busy === "confirm"} disabled={!acknowledged || Boolean(busy)} onClick={() => void confirm()}>Confirm the transfer</Button>}
            {stepUpDone && <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void stepUp()}>Run the identity check again</Button>}
          </div>
        </DisclosureSurface>}
        {(transfer.state === "primary_confirmed" || transfer.state === "ready") && <Alert>Your confirmation is recorded. The transfer commits once the recipient accepts.</Alert>}
        <Button variant="danger" loading={busy === "withdraw"} disabled={Boolean(busy)} onClick={() => void act("withdraw", async () => { await api.withdrawTransfer(id, transferId); return { title: "Transfer withdrawn", text: "Roles are unchanged." }; })}>Withdraw the transfer</Button>
      </>}
      {!live && <Alert>{sentenceFor(transfer.state === "committed" ? "MSG-73-042" : transfer.state === "declined" ? "MSG-73-043" : transfer.state === "withdrawn" ? "MSG-73-044" : transfer.state === "expired" ? "MSG-73-045" : "MSG-73-027")}</Alert>}
    </>}
  </section>;
}

/** The approved disclosure for one leg, shown only when its kind and version are the ones this transfer was proposed under. */
function DisclosureSurface({ file, kind, version, acknowledged, onAcknowledged, idPrefix, children }: { file: DisclosureFile; kind: string; version: number; acknowledged: boolean; onAcknowledged(value: boolean): void; idPrefix: string; children: React.ReactNode }) {
  if (file.kind !== kind || file.version !== version) {
    return <Alert tone="danger" title="The disclosure for this transfer is not available here">This transfer was proposed under disclosure {kind} version {version}, which this page does not carry. Nothing can be accepted or confirmed from here until it does.</Alert>;
  }
  return <section aria-labelledby={`${idPrefix}-disclosure-heading`} className="space-y-4 rounded-lg border border-border p-4">
    <h2 id={`${idPrefix}-disclosure-heading`} className="text-2xl font-semibold">{file.heading}</h2>
    <ul className="list-disc space-y-2 pl-6">{file.items.map(item => <li key={item.id}>{item.text}</li>)}</ul>
    <Checkbox id={`${idPrefix}-acknowledged`} checked={acknowledged} onChange={event => onAcknowledged(event.target.checked)} label={file.acknowledgement} />
    {children}
  </section>;
}
