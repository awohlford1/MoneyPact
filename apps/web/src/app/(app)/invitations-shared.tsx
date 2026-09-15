"use client";
// PK-8: what the invitation, members, transfer and notices views share -- the client, a cancellable read, the
// space navigation and the return marker the two provider hops (sign-in, step-up) need. Client state and
// browser storage require client components.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
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

/**
 * The provider hops end on `/budgets` (the API's closed destination map has no entry for the ceremony or transfer pages,
 * finding PK8-F02), so a page that starts one leaves this marker and the budgets page follows it once. The key is
 * outside the session-keyed prefixes on purpose: a sign-in that starts a new session clears those, and this marker
 * must survive exactly that.
 */
export const RETURN_KEY = "cobudget.invitation.return";
export interface ReturnMarker { path: string; resume?: "confirm" }
export function leaveReturnMarker(marker: ReturnMarker): void {
  try { sessionStorage.setItem(RETURN_KEY, JSON.stringify(marker)); } catch { /* No storage: the person navigates back by hand. */ }
}
export function takeReturnMarker(): ReturnMarker | undefined {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return undefined;
    sessionStorage.removeItem(RETURN_KEY);
    const parsed = JSON.parse(raw) as Partial<ReturnMarker>;
    // Only a same-origin path is ever followed.
    if (typeof parsed.path !== "string" || !parsed.path.startsWith("/") || parsed.path.startsWith("//")) return undefined;
    return { path: parsed.path, ...(parsed.resume === "confirm" ? { resume: "confirm" as const } : {}) };
  } catch { return undefined; }
}
/** Mounted on the budgets page: follows a return marker left by the ceremony or transfer page. */
export function ResumeAfterCeremony() {
  const router = useRouter();
  useEffect(() => {
    const marker = takeReturnMarker();
    if (marker) router.replace(marker.resume ? `${marker.path}?resume=${marker.resume}` : marker.path);
  }, [router]);
  return null;
}
