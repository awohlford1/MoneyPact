"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../api/client";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { classifyFailure, PageUnavailable } from "../../ui/resource";

/**
 * UI-P07 (gap G12, OQ-UI-18): the `(app)` group's error boundary (Next's `error.tsx`) for a render-phase
 * error thrown anywhere beneath this layout, so a future surface has one shared place to land instead of
 * inventing its own. Reuses `classifyFailure`/`DeniedState`'s vocabulary from `../../ui/resource` (CBD-35)
 * rather than restating it:
 *
 *  - 401 (session loss, not a page failure at all): nothing here is worth retrying, so this redirects to
 *    `/sign-in` outright and shows no destination text beyond what `/sign-in` itself already approves.
 *  - 403 (a permission-shaped denial) renders the exact same `PageUnavailable` sentence as a literal 404
 *    -- both this component's own terminal branch and `../not-found.tsx` -- so an unauthorized caller
 *    cannot tell "does not exist" from "not yours to open" (CBD-306-AC05, CBD-243-AC07).
 *  - 429 (the uniform throttled response, RL-92-*) is not a broken page and does not share a label with
 *    one; it gets its own honest, distinct sentence.
 *  - Everything else falls back to `classifyFailure`'s existing recoverable/terminal split, exactly as
 *    every resource-level `Failure` already renders it: terminal gets `PageUnavailable`, recoverable gets
 *    a "Try again" that calls Next's own `reset`.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  const router = useRouter();
  const status = error instanceof ApiError ? error.status : undefined;

  useEffect(() => {
    if (status === 401) router.replace("/sign-in");
  }, [status, router]);

  if (status === 401) return <Alert loading>Redirecting to sign in…</Alert>;

  if (status === 429) return <Alert tone="danger" title="Too many requests">
    <p>This page is receiving too many requests right now. Try again in a moment.</p>
    <Button variant="secondary" onClick={reset}>Try again</Button>
  </Alert>;

  // A permission-shaped denial (403) is deliberately folded into the same branch as a literal 404
  // (`classifyFailure`'s "terminal"): both render `PageUnavailable`, never a distinct sentence.
  if (status === 403 || classifyFailure(error) === "terminal") return <PageUnavailable />;

  return <Alert tone="danger" title="Unable to load this page">
    <p>We could not load this page. You can try again.</p>
    <Button variant="secondary" onClick={reset}>Try again</Button>
  </Alert>;
}
