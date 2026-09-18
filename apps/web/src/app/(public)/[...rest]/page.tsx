import { notFound } from "next/navigation";

/**
 * UI-P07 (gap G12, OQ-UI-18): without this, a genuinely unmatched top-level URL -- a typo, a stale link,
 * anything no route group defines -- fell through every group entirely to Next's own bare default 404
 * (no MoneyPact shell, no design tokens; verified empirically before this file existed). A route group's
 * own `not-found.tsx` only renders for an explicit `notFound()` call from within its subtree or a mismatch
 * inside an already-matched segment, never for an arbitrary unrelated path -- so this catch-all is what
 * makes `../not-found.tsx` the page a real visitor actually reaches. It lives in the public group, not
 * `(app)`, because a URL that matches nothing carries no session assumption; showing the authenticated
 * shell for it would be the wrong default, and no session should be checked just to render "not here".
 *
 * A static or dynamic route always wins over this catch-all for its own exact path (Next's own routing
 * precedence, not this file's) -- `/budgets/{id}` and every other real route this app defines is
 * unaffected.
 */
export default function GlobalNotFoundProbe(): never {
  notFound();
}
