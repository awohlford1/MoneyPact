"use client";
// PK-8 public ceremony pages (CBD-234 design sections 5.1, 5.2, 5.4 and 6; CBD-73 sections 5, 7 and 8.1): resolve
// the link, prove the invited channel, decline, hand off to sign-in or account creation and return, attach, read the
// disclosure and choose. Everything here is client state: the ceremony is located by the path id plus the
// `__Host-mp_invitation_ceremony` cookie the API set through the same-origin proxy, which script never reads.
//
// The rules the Security readings placed here, each visible below. The trio is sent same-origin with no CSRF
// header, so the browser adds Origin and Sec-Fetch-Site as it does for the identity begin route; attach and accept
// carry the CSRF header from the session bootstrap. The choice is presented with no default: nothing is selected
// until the person selects it. Exhausting the six-digit challenge is terminal for this link -- the page tells the
// person to ask the inviter for a new invitation and never offers to resolve the link again (SEC-PK6-F2). Every
// other uniform 404 on a ceremony route is shown as "open your invitation link again", because a newer resolve, an
// account switch or expiry invalidated this ceremony and only a fresh resolve can start another.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { InvitationApiError, createInvitationsClient, roleLabel, sentenceFor } from "../../../api/invitations";
import type { InvitationsClient, WireDisclosureView } from "../../../api/invitations";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Checkbox, Radio } from "../../../components/Choice";
import { Input } from "../../../components/Input";
import { apiBase } from "@/api/runtime-mode";

/** What this browser tab remembers about one ceremony between steps and across the sign-in hop (never the secret, which is the cookie's). */
interface CeremonyMemory { proved?: boolean; attached?: boolean; exhausted?: boolean; expiresAt?: string }
const memoryKey = (ceremonyId: string) => `cobudget.invitation.ceremony.${ceremonyId}`;
function readMemory(ceremonyId: string): CeremonyMemory {
  try { return JSON.parse(sessionStorage.getItem(memoryKey(ceremonyId)) ?? "{}") as CeremonyMemory; } catch { return {}; }
}
function writeMemory(ceremonyId: string, patch: CeremonyMemory): CeremonyMemory {
  const next = { ...readMemory(ceremonyId), ...patch };
  try { sessionStorage.setItem(memoryKey(ceremonyId), JSON.stringify(next)); } catch { /* Without storage each step is re-derived from the API's answers. */ }
  return next;
}

function useClient(): InvitationsClient {
  return useMemo(() => createInvitationsClient(apiBase), []);
}

/** `/invitation`: the link carries the code in its fragment (`#code=...`), which never reaches a server log; a person may also paste it. */
export function ResolveView() {
  const api = useClient();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "resolving" | "unusable" | "failed">("idle");
  const heading = useRef<HTMLHeadingElement>(null);
  const resolve = useCallback(async (presented: string) => {
    setState("resolving");
    try {
      const entry = await api.resolve(presented);
      if ("outcome" in entry) { setState("unusable"); return; }
      writeMemory(entry.ceremonyId, { expiresAt: entry.ceremonyExpiresAt });
      router.replace(`/invitation/ceremony/${encodeURIComponent(entry.ceremonyId)}`);
    } catch { setState("failed"); }
  }, [api, router]);
  useEffect(() => {
    // SEC-PK8-F2: a link built wrongly with the code in the query (`?code=`) is not resolved -- the code is fragment-carried
    // so it never reaches a request line or a log -- but the query is stripped from the address bar and history at once,
    // so the bearer does not persist there or get re-sent on a reload; the person pastes the code instead.
    if (new URLSearchParams(window.location.search).has("code")) history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
    const linked = fragment.get("code");
    if (!linked) return;
    // Deferred out of the effect body (as SessionProvider defers its bootstrap): the resolve is a request, not a render-time state change.
    // The fragment is cleared only when the resolve actually starts, so a re-run of this effect still finds the code.
    let active = true;
    queueMicrotask(() => { if (!active) return; history.replaceState(null, "", window.location.pathname); void resolve(linked); });
    return () => { active = false; };
  }, [resolve]);
  useEffect(() => { if (state === "unusable" || state === "failed") heading.current?.focus(); }, [state]);
  return <section className="mx-auto max-w-lg space-y-6">
    <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold">Your invitation</h1>
    {state === "resolving" && <Alert loading>Opening your invitation…</Alert>}
    {state === "unusable" && <Alert tone="danger" title="This invitation link cannot be used">{sentenceFor("MSG-73-003")}</Alert>}
    {state === "failed" && <Alert tone="danger">We could not open the invitation right now. You can try again.</Alert>}
    {state !== "resolving" && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void resolve(code); }}>
      <p>Paste the invitation code from the message you received, or open the link in it.</p>
      <Input id="invitation-code" label="Invitation code" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} />
      <Button type="submit" disabled={!code.trim()}>Open invitation</Button>
    </form>}
  </section>;
}

type Step =
  | { kind: "loading" }
  | { kind: "verify"; attemptsRemaining?: number; wrong?: boolean }
  | { kind: "exhausted" }
  | { kind: "resolve_again" }
  | { kind: "sign_in"; error?: string }
  | { kind: "attaching" }
  | { kind: "disclose"; view: WireDisclosureView; error?: string }
  | { kind: "accepted" }
  | { kind: "declined" }
  | { kind: "foreign" }
  | { kind: "failed" };

export function CeremonyView({ ceremonyId }: { ceremonyId: string }) {
  const api = useClient();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [channelCode, setChannelCode] = useState("");
  const [choice, setChoice] = useState<"accept" | "decline" | "">("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  /**
   * Continues from the remembered state: attach if a session exists, then read the disclosure. R-03
   * (PROTO-INVITATIONS-PK8-REVIEW-001 finding R-03; PK9-F02): `memory.proved` is this tab's own record of having
   * entered the code, written only by `verify()` below -- it is not the only thing this function trusts. `writeMemory`
   * also records `expiresAt` the moment this tab itself resolves the link (`ResolveView.resolve`), so a tab that has
   * that key has been through the code-entry step of this flow already and is shown it again exactly as before; a
   * tab with no record of this ceremony at all -- a second tab, a lost sessionStorage, or a direct link to the
   * ceremony URL -- cannot tell locally whether the channel was already proved elsewhere, so it asks the API rather
   * than the person: a session lets it try `attach` (an attach on an unproved ceremony answers the uniform 404 and
   * writes nothing, design 5.2), which both confirms the proof and links the ceremony to that session in one call;
   * with no session to attach with, it is shown the same sign-in hand-off the page offers right after a proof,
   * because that is this tab's only way to reach a session and get the API's real answer. Either way the code entry
   * is shown only when the API itself says the proof is missing, never merely because this tab forgot.
   */
  const advance = useCallback(async (signal?: AbortSignal) => {
    const memory = readMemory(ceremonyId);
    if (memory.exhausted) { setStep({ kind: "exhausted" }); return; }
    const knownHere = memory.expiresAt !== undefined;
    if (!memory.proved && knownHere) { setStep({ kind: "verify" }); return; }
    let session: Awaited<ReturnType<InvitationsClient["session"]>> = null;
    try { session = await api.session(signal); } catch { setStep({ kind: "failed" }); return; }
    if (!session) {
      // Whether memory.proved is true (the ordinary post-proof hand-off) or unset (no local record, no way to
      // attach without a session): the same sign-in step either way. Once the person is back with a session, this
      // runs again and `attach` gives the API's real answer.
      setStep({ kind: "sign_in" }); return;
    }
    setStep({ kind: "attaching" });
    try {
      if (!memory.attached) {
        const attached = await api.attach(ceremonyId);
        if (attached === "unusable") {
          // The API's own word that the proof is missing: only now does the code entry appear for a tab that never verified.
          setStep({ kind: memory.proved ? "resolve_again" : "verify" });
          return;
        }
        writeMemory(ceremonyId, { proved: true, attached: true });
      }
      const view = await api.readCeremony(ceremonyId, signal);
      setStep({ kind: "disclose", view });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof InvitationApiError && error.uniform) setStep({ kind: "resolve_again" });
      else if (error instanceof InvitationApiError && error.denied) setStep({ kind: "foreign" });
      else setStep({ kind: "failed" });
    }
  }, [api, ceremonyId]);
  useEffect(() => {
    const abort = new AbortController();
    queueMicrotask(() => { if (!abort.signal.aborted) void advance(abort.signal); });
    return () => abort.abort();
  }, [advance]);
  useEffect(() => { if (!["loading", "attaching"].includes(step.kind)) heading.current?.focus(); }, [step.kind]);

  async function verify() {
    setBusy(true);
    try {
      const outcome = await api.verifyChannel(ceremonyId, channelCode);
      if (outcome.outcome === "proved") { writeMemory(ceremonyId, { proved: true }); setChannelCode(""); await advance(); }
      else if (outcome.outcome === "retry") setStep({ kind: "verify", attemptsRemaining: outcome.attemptsRemaining, wrong: true });
      else if (outcome.outcome === "exhausted") { writeMemory(ceremonyId, { exhausted: true }); setStep({ kind: "exhausted" }); }
      else setStep({ kind: "resolve_again" });
    } catch { setStep({ kind: "failed" }); }
    finally { setBusy(false); }
  }
  async function signIn() {
    setBusy(true);
    // CBD-190 identity amendments proposal §3.5: `beginSignIn` now names `invitation_ceremony` as the
    // destination and the API's own post-result navigation returns the browser to `/invitation` -- no
    // client-held marker survives the provider hop, so a link holder without their code any more re-presents
    // it (the fragment link, or a pasted code) the same way any first visit does.
    try { window.location.assign(await api.beginSignIn()); }
    catch { setBusy(false); setStep({ kind: "sign_in", error: "We could not start sign-in. You can try again." }); }
  }
  async function decline() {
    setBusy(true);
    try { await api.decline(ceremonyId); setStep({ kind: "declined" }); }
    catch { setStep({ kind: "failed" }); }
    finally { setBusy(false); }
  }
  async function record(view: WireDisclosureView) {
    if (choice === "decline") { await decline(); return; }
    if (choice !== "accept" || !acknowledged) return;
    setBusy(true);
    try {
      const result = await api.accept(ceremonyId, { kind: view.disclosure.kind, version: view.disclosure.version });
      if ("outcome" in result) { setStep({ kind: "resolve_again" }); return; }
      setStep({ kind: "accepted" });
    } catch (error) {
      if (error instanceof InvitationApiError && error.code === "stale_disclosure") setStep({ kind: "disclose", view, error: "The disclosure changed while you were reading it. Read the current one below, then choose again." });
      else if (error instanceof InvitationApiError && error.denied) setStep({ kind: "foreign" });
      else setStep({ kind: "disclose", view, error: "Your choice could not be recorded. You can try again." });
    } finally { setBusy(false); }
  }
  const title: Record<Step["kind"], string> = {
    loading: "Your invitation", verify: "Prove you received this invitation", exhausted: "This invitation link can no longer be used", resolve_again: "Open your invitation link again",
    sign_in: "Sign in or create your MoneyPact account", attaching: "Your invitation", disclose: "Before you accept", accepted: "Your acceptance is recorded", declined: "This invitation is finished", foreign: "Continue with the account you started with", failed: "Something went wrong",
  };
  return <section className="mx-auto max-w-2xl space-y-6">
    <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold">{title[step.kind]}</h1>
    {(step.kind === "loading" || step.kind === "attaching") && <Alert loading>{step.kind === "attaching" ? "Linking your account to this invitation…" : "Checking this invitation…"}</Alert>}
    {step.kind === "verify" && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void verify(); }}>
      <p>{sentenceFor("MSG-73-011")} Nothing about the invitation is shown until the code matches.</p>
      {step.wrong && <Alert tone="danger">That code did not match. {step.attemptsRemaining === 1 ? "One attempt remains." : `${step.attemptsRemaining} attempts remain.`} After the last one this link stops working.</Alert>}
      <Input id="channel-code" label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={channelCode} onChange={event => setChannelCode(event.target.value.replace(/\D/gu, ""))} />
      <Button type="submit" loading={busy} disabled={channelCode.length !== 6}>Check code</Button>
    </form>}
    {step.kind === "exhausted" && <Alert tone="danger" title="Too many incorrect codes">The code was entered incorrectly too many times, so this invitation link no longer works. Ask the person who invited you to send a new invitation.</Alert>}
    {step.kind === "resolve_again" && <Alert tone="danger" title="This step is no longer available">{sentenceFor("MSG-73-003")} If you still have the invitation message, open its link again to start over. <NextLink className="underline" href="/invitation">Open your invitation link again</NextLink></Alert>}
    {step.kind === "foreign" && <Alert tone="danger" title="A different account is signed in">This invitation was started with another account. Sign in with that account and open the invitation link again.</Alert>}
    {step.kind === "failed" && <Alert tone="danger">We could not continue right now. <button type="button" className="underline" onClick={() => void advance()}>Try again</button></Alert>}
    {step.kind === "sign_in" && <div className="space-y-4">
      <p>You proved you control the invited address. To see what the invitation offers and to choose, sign in to MoneyPact or create your account. Nothing about the invitation creates or names an account for you; you come back here afterwards.</p>
      {step.error && <Alert tone="danger">{step.error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button loading={busy} onClick={() => void signIn()}>Sign in or create your MoneyPact account</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void decline()}>Decline this invitation</Button>
      </div>
    </div>}
    {step.kind === "disclose" && <DisclosureStep view={step.view} error={step.error} choice={choice} onChoice={setChoice} acknowledged={acknowledged} onAcknowledged={setAcknowledged} busy={busy} onRecord={() => void record(step.view)} />}
    {step.kind === "accepted" && <Alert title="Waiting for the inviter">{sentenceFor("MSG-73-051")} <NextLink className="underline" href="/budgets">Go to your budgets</NextLink></Alert>}
    {step.kind === "declined" && <Alert>Your decline ended only this invitation. Nothing was shared and no account was created or changed.</Alert>}
  </section>;
}

function DisclosureStep({ view, error, choice, onChoice, acknowledged, onAcknowledged, busy, onRecord }: { view: WireDisclosureView; error?: string; choice: "accept" | "decline" | ""; onChoice(value: "accept" | "decline"): void; acknowledged: boolean; onAcknowledged(value: boolean): void; busy: boolean; onRecord(): void }) {
  const ready = choice === "decline" || (choice === "accept" && acknowledged);
  return <form className="space-y-6" onSubmit={event => { event.preventDefault(); onRecord(); }}>
    <p data-testid="disclosure-opening"><strong>{view.inviterDisplayName}</strong> invited you to join <strong>{view.budgetSpaceName}</strong> as a <strong>{roleLabel(view.proposedRole)}</strong>. Read what that means before you choose. This offer ends {view.expiresAt.replace("T", " ").slice(0, 16)} UTC.</p>
    {error && <Alert tone="danger">{error}</Alert>}
    <section aria-labelledby="disclosure-heading" className="space-y-4 rounded-lg border border-border p-4">
      <h2 id="disclosure-heading" className="text-2xl font-semibold">{view.disclosure.text.heading}</h2>
      <ul className="list-disc space-y-2 pl-6">{view.disclosure.text.items.map(item => <li key={item.id}>{item.text}</li>)}</ul>
      <p data-testid="two-way-notice">{sentenceFor(view.twoWayNoticeCode)}</p>
      <p data-testid="confirmation-notice">{sentenceFor(view.confirmationNoticeCode)}</p>
    </section>
    <fieldset className="space-y-2">
      <legend className="font-semibold">Your choice</legend>
      <p className="text-on-surface-muted">{sentenceFor("MSG-73-017")}</p>
      {/* The API states the choice as { accept: false, decline: false }: neither option is selected until the person selects it, and a view that pre-selected one would contradict it. */}
      <Radio id="choice-accept" name="choice" label={`Accept and join as ${roleLabel(view.proposedRole)}`} checked={choice === "accept"} onChange={() => onChoice("accept")} />
      <Radio id="choice-decline" name="choice" label="Decline this invitation" checked={choice === "decline"} onChange={() => onChoice("decline")} />
    </fieldset>
    {choice === "accept" && <Checkbox id="acknowledged-disclosure" checked={acknowledged} onChange={event => onAcknowledged(event.target.checked)} label={view.disclosure.text.acknowledgement} />}
    <Button type="submit" loading={busy} disabled={!ready}>{choice === "decline" ? "Decline this invitation" : "Record my acceptance"}</Button>
  </form>;
}
