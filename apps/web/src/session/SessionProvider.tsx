"use client";
// Browser session lifecycle, cancellation and routing require client effects.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createHttpClient } from "../api/client";
import type { ApiClient, Session } from "../api/client";
import { fromWebStorage, handleSessionEnding, reconcileOnReconnect } from "./session-context";
import type { ClientSessionContext } from "./session-context";
import { Alert } from "../components/Alert";
import { apiBase } from "@/api/runtime-mode";

interface SessionValue { api: ApiClient; session: Session; logout(): Promise<void> }
const Context = createContext<SessionValue | null>(null);
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Authenticated session required");
  return value;
}

export function SessionProvider({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const [api] = useState(() => client ?? createHttpClient(apiBase));
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState(false);
  const current = useRef<Session | null>(null);
  const sequence = useRef(0);
  const notifications = useRef<BroadcastChannel | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const clear = useCallback(() => {
    api.clear();
    current.current = null;
    for (const storage of [sessionStorage, localStorage]) {
      handleSessionEnding("access_loss", fromWebStorage(storage), {
        stopSubscriptions() {}, clearQueuedMutations() {},
      });
    }
    setSession(null);
  }, [api]);
  const bootstrap = useCallback(async () => {
    const request = ++sequence.current;
    // Remove protected children immediately; their effects cancel on unmount.
    setSession(null);
    setError(false);
    try {
      const resolved = await api.me();
      if (request !== sequence.current) return;
      const handlers = { stopSubscriptions() {}, clearQueuedMutations() {} };
      let previous: ClientSessionContext | undefined = current.current ?? undefined;
      if (!previous) {
        try {
          const stored = JSON.parse(sessionStorage.getItem("cobudget.session.context") ?? "null");
          if (typeof stored?.sessionRef === "string" && typeof stored?.sessionVersion === "number") previous = stored;
        } catch { /* An unreadable context fails closed below. */ }
      }
      for (const storage of [sessionStorage, localStorage]) {
        await reconcileOnReconnect(async () => resolved ?? undefined, previous, fromWebStorage(storage), handlers);
      }
      if (request !== sequence.current) return;
      current.current = resolved;
      if (resolved) sessionStorage.setItem("cobudget.session.context", JSON.stringify({ sessionRef: resolved.sessionRef, sessionVersion: resolved.sessionVersion }));
      setSession(resolved);
      if (!resolved) { clear(); router.replace("/sign-in"); }
    } catch {
      if (request !== sequence.current) return;
      clear();
      setError(true);
    }
  }, [api, clear, router]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void bootstrap(); });
    const recheck = () => { void bootstrap(); };
    const visibility = () => { if (document.visibilityState === "visible") recheck(); };
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("cobudget-session-events");
    notifications.current = channel ?? null;
    if (channel) channel.onmessage = event => {
      if (event.data === "ended") { ++sequence.current; clear(); router.replace("/sign-in"); }
    };
    window.addEventListener("pageshow", recheck);
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      // This is a request counter, not a DOM ref: invalidate all pending requests.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", visibility);
      channel?.close();
      notifications.current = null;
    };
  }, [bootstrap, clear, router]);
  useEffect(() => { document.getElementById("app-main")?.focus(); }, [pathname]);
  async function logout() {
    ++sequence.current;
    setSession(null);
    try {
      await api.logout(); clear();
      notifications.current?.postMessage("ended");
      router.replace("/");
    }
    catch { clear(); setError(true); }
  }
  if (error) return <Alert tone="danger">We could not check your session. <button onClick={() => void bootstrap()} className="underline">Try again</button></Alert>;
  if (!session) return <Alert loading>Checking your session…</Alert>;
  return <Context.Provider value={{ api, session, logout }}>{children}</Context.Provider>;
}
