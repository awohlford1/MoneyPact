import { notFound } from "next/navigation";

/**
 * UI-P07 test-only diagnostic. Next only renders a route group's own `not-found.tsx` for an explicit
 * `notFound()` call from within its subtree or a mismatch inside an already-matched dynamic segment; a
 * genuinely unrelated URL falls straight to the true global default (proven empirically: neither
 * `(app)/not-found.tsx` nor `(public)/not-found.tsx` rendered for an arbitrary unmatched path with no
 * matching route anywhere in the tree). Nothing in today's app calls `notFound()` -- every existing
 * 404-shaped read is caught and rendered as component state instead (see `../boundary/page.tsx`'s own
 * comment) -- so this optional catch-all is the only way to reach `../../not-found.tsx` through a real
 * navigation in the browser suite rather than only inspecting its source. It never shadows
 * `../boundary/page.tsx`: Next resolves that static sibling first for its own exact path.
 */
export default function DiagnosticNotFoundProbe(): never {
  notFound();
}
