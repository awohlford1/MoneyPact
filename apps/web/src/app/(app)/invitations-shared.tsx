"use client";
// PK-8: what the invitation, members, transfer and notices views share -- the client, a cancellable read, and the
// space navigation. Client state requires client components.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { createInvitationsClient, InvitationApiError } from "../../api/invitations";
import type { InvitationsClient } from "../../api/invitations";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { apiBase } from "@/api/runtime-mode";

/** One client per mounted view; the CSRF value it captures lives only in that closure. */
export function useInvitationsClient(): InvitationsClient {
  return useMemo(() => createInvitationsClient(apiBase), []);
}

/** A read that is cancelled on unmount or identity change and discarded when a newer read has started (the journey's pattern). */
export function useRead<T>(identity: string, load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ identity: string; value?: T; error?: unknown }>();
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    const request = ++sequence.current;
    load(abort.signal).then(value => {
      if (!abort.signal.aborted && request === sequence.current) setResult({ identity, value });
    }, error => {
      if (!abort.signal.aborted && request === sequence.current) setResult({ identity, error });
    });
    return () => { abort.abort(); };
  }, [identity, load, revision]);
  const refresh = useCallback(() => { sequence.current++; setResult(undefined); setRevision(value => value + 1); }, []);
  return { ...(result?.identity === identity ? result : {}), refresh };
}

/** The sentence a failed read or write shows. Denials are uniform on purpose, so the copy names the classes without guessing which. */
export function describeFailure(error: unknown, fallback = "This could not be completed. You can try again."): string {
  if (error instanceof InvitationApiError) {
    if (error.denied) return "Your current session cannot do this here.";
    if (error.status === 404) return "This no longer exists, or it is not yours to open.";
    if (error.status === 409) return "This is no longer current. Refresh and read the state again.";
    if (error.status === 401) return "Sign in again to continue.";
  }
  return fallback;
}

export function ReadFailure({ error, retry }: { error: unknown; retry(): void }) {
  const denied = error instanceof InvitationApiError && error.denied;
  return <Alert tone="danger" title={denied ? "Access unavailable" : "Unable to load"}>
    <p>{describeFailure(error, "We could not load this. You can try again.")}</p>
    {!denied && <Button variant="secondary" onClick={retry}>Try again</Button>}
  </Alert>;
}

export function formatInstant(value: string | null | undefined): string {
  if (!value) return "not yet";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** The links from a budget to its member, invitation and transfer pages, and to the person's notices. */
export function SpaceNavigation({ id, current }: { id: string; current?: "members" | "invitations" | "transfer" }) {
  const link = (href: string, label: string, key: typeof current) =>
    <li><NextLink href={href} aria-current={current === key ? "page" : undefined} className="text-interactive underline">{label}</NextLink></li>;
  const space = `/budgets/${encodeURIComponent(id)}`;
  return <nav aria-label="Members and invitations"><ul className="flex flex-wrap gap-4">
    <li><NextLink href={space} className="text-interactive underline">Budget dashboard</NextLink></li>
    {link(`${space}/members`, "Members", "members")}
    {link(`${space}/invitations`, "Invitations", "invitations")}
    {link(`${space}/transfer`, "Primary ownership", "transfer")}
    <li><NextLink href="/notices" className="text-interactive underline">Notices</NextLink></li>
  </ul></nav>;
}

// PK-8 / CBD-190 identity amendments proposal §3.5, SEC-PK8-R2: the invitation ceremony page and the Primary-transfer
// page each begin their provider hop with a server-validated `postResultDestinationId` (`invitation_ceremony`,
// `budget_transfer`) instead of the always-`budgets` value the API previously required; `#successNavigation`
// (`apps/api/src/identity/ceremony.ts`) now returns the caller directly to the page it started from. The
// sessionStorage return marker this file used to keep (`RETURN_KEY`, `leaveReturnMarker`, `takeReturnMarker`,
// `ResumeAfterCeremony`) is retired: nothing here stores or reads a client-held navigation target any more.
