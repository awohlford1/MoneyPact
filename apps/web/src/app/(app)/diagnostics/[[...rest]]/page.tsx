import { notFound } from "next/navigation";

export const metadata = { robots: { index: false, follow: false } };

/**
 * UI-P07 test-only diagnostic. Next only renders a route group's own `not-found.tsx` for an explicit
 * `notFound()` call from within its subtree, never for a merely unmatched URL -- that always resolves to
 * the root `../../not-found.tsx` instead (proven empirically, see that file's own comment and REV-UIP07-2/3).
 * Nothing in today's app calls `notFound()` -- every existing 404-shaped read is caught and rendered as
 * component state instead (see `../boundary/page.tsx`'s own comment) -- so this optional catch-all is the
 * only way to reach `../../not-found.tsx` (this group's own) through a real navigation in the browser suite
 * rather than only inspecting its source. It never shadows `../boundary/page.tsx`: Next resolves that
 * static sibling first for its own exact path.
 */
export default function DiagnosticNotFoundProbe(): never {
  notFound();
}
