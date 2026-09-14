"use client";
// The API ceremony begins with a browser navigation; no provider code is exchanged here.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createHttpClient } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { apiBase } from "@/api/runtime-mode";
export function SignIn({ returned = false }: { returned?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // CBD-190 section 7: an application-owned result page places focus on the result heading.
  useEffect(() => { if (returned) heading.current?.focus(); }, [returned]);
  useEffect(() => {
    const abort = new AbortController();
    void createHttpClient(apiBase).me(abort.signal).then(session => {
      if (session && !abort.signal.aborted) router.replace("/budgets");
    }).catch(() => { /* An unavailable bootstrap leaves sign-in available. */ });
    return () => abort.abort();
  }, [router]);
  async function begin() {
    setBusy(true); setError(false);
    try { window.location.assign(await createHttpClient(apiBase).begin()); }
    catch { setBusy(false); setError(true); }
  }
  return <section className="mx-auto max-w-md space-y-6">
    <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold">Sign in to MoneyPact</h1>
    <p>Continue to your budgets and shared plans.</p>
    {returned && <Alert>Sign-in did not complete. You can try again.</Alert>}
    {error && <Alert tone="danger">We could not start sign-in. Please try again.</Alert>}
    <Button onClick={() => void begin()} disabled={busy}>Continue to sign in</Button>
  </section>;
}
