import { PageUnavailable } from "../../ui/resource";

export const metadata = { title: "Page unavailable" };

// UI-P07: without this, an unmatched route inside the public group (e.g. `/mission/no-such-page`) fell
// through to Next's own unbranded default 404 -- no MoneyPact shell, no design tokens. The public group
// has no permission-shaped resource to leak (its pages are the fixed landing/mission/invitation set), so
// this exists for brand consistency only; it renders the same shared `PageUnavailable` sentence as
// `(app)/not-found.tsx` rather than inventing public-page copy of its own.
export default function NotFound() {
  return <PageUnavailable />;
}
