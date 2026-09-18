import { PageUnavailable } from "../../ui/resource";

export const metadata = { title: "Page unavailable" };

// UI-P07 (gap G12, OQ-UI-18): Next's own not-found boundary for an unmatched route anywhere inside this
// group -- an unknown budget sub-route (`/budgets/{id}/no-such-tab`), a stale bookmark, a typo. Renders
// the exact same sentence `(app)/error.tsx` renders for a permission-shaped denial (CBD-306-AC05,
// CBD-243-AC07): this route genuinely does not exist, but nothing here may look different from a route
// that exists and is not this session's to open.
export default function NotFound() {
  return <PageUnavailable />;
}
