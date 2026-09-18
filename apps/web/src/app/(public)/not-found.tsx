import { PageUnavailable } from "../../ui/resource";

export const metadata = { title: "Page unavailable" };

// UI-P07 (REV-UIP07-2/3): NOT automatic unmatched-route handling -- a merely unmatched URL, even one that
// shares a prefix with an existing public page (e.g. `/mission/no-such-page`), resolves to the root
// `../../not-found.tsx` instead (the `/_not-found` build entry), never to this file. This exists for an
// explicit `notFound()` call from within the public group's own subtree, the same reasoning
// `(app)/not-found.tsx` documents; none of today's public pages make that call. It renders the same shared
// `PageUnavailable` sentence as `(app)/not-found.tsx` rather than inventing public-page copy of its own,
// since the public group has no permission-shaped resource to leak either way (its pages are the fixed
// landing/mission/invitation set).
export default function NotFound() {
  return <PageUnavailable />;
}
