import { PageUnavailable } from "../../ui/resource";

export const metadata = { title: "Page unavailable" };

// UI-P07 (gap G12, OQ-UI-18, REV-UIP07-2/3): NOT automatic unmatched-URL handling -- Next never renders a
// route group's own not-found.tsx for an arbitrary unmatched path (that always resolves to the root
// `../not-found.tsx` instead, the `/_not-found` build entry). This file exists for an explicit `notFound()`
// call thrown from within this group's own subtree -- a future page that detects an invalid nested segment
// (a stale budget sub-tab bookmark, say) and calls `notFound()` itself lands here, not at the root. Renders
// the exact same sentence `(app)/error.tsx` renders for a permission-shaped denial (CBD-306-AC05,
// CBD-243-AC07): whichever brought a caller here, nothing may look different from a route that exists and
// is not this session's to open.
export default function NotFound() {
  return <PageUnavailable />;
}
