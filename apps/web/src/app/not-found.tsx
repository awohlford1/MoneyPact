import { PageUnavailable } from "../ui/resource";

export const metadata = { title: "Page unavailable" };

/**
 * UI-P07 (gap G12, OQ-UI-18, REV-UIP07-2/3): Next's actual mechanism for one branded 404 covering every URL
 * no route group defines -- confirmed against the build's own route discovery and app-loader: this file is
 * what `next build` resolves the `/_not-found` entry to. A route group's own `not-found.tsx`
 * (`(app)/not-found.tsx`) never fires for an arbitrary unmatched URL, only for an explicit `notFound()` call
 * from within that group's own subtree -- so this root file, not a per-group one, is what a real visitor
 * with a typo'd or stale link actually reaches. It sits outside every group, so no group layout wraps it
 * (only the plain `app/layout.tsx` does); it renders its own `<main>` landmark rather than borrowing either
 * group's shell, since neither is truly appropriate for a URL that matches nothing.
 */
export default function NotFound() {
  return <main className="mx-auto w-[min(100%,72rem)] px-6 py-12"><PageUnavailable /></main>;
}
