"use client";
// The [id] layout's own navigation (CBD-35): one destination registry every route under
// budgets/[id]/layout.tsx renders from, so a tab is added by the packet that builds its route and never before.
import { usePathname } from "next/navigation";
import NextLink from "next/link";

interface Destination {
  key: string;
  label: string;
  href(id: string): string;
  /** Whether this destination counts as current for a given pathname. Defaults to an exact match or a nested
   * route beneath it (REV-UIP01-1), so a subtree -- a category detail, an account, a transfer -- marks its
   * parent tab current with no per-packet change here. When more than one destination's `matches` is true for
   * a pathname, the one with the longest `href` wins, so a nested route never marks a shallower ancestor
   * (e.g. Dashboard) current over the more specific tab it actually belongs to (e.g. Category plan). */
  matches?(pathname: string, href: string): boolean;
}

function defaultMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// DESTINATION REGISTRY -- append-only, entries are {key, label, href(id), matches?(pathname, href)}. Add new
// destinations before MEMBERS_DESTINATION and INVITATIONS_DESTINATION, which stay last, so every future
// packet's append lands in the right place without moving array elements.
const DASHBOARD_DESTINATION: Destination = { key: "dashboard", label: "Dashboard", href: id => `/budgets/${encodeURIComponent(id)}` };
const PLAN_DESTINATION: Destination = { key: "plan", label: "Category plan", href: id => `/budgets/${encodeURIComponent(id)}/plan` };
// UI-P04 (CBD-358): category and period reports.
const REPORTS_DESTINATION: Destination = { key: "reports", label: "Reports", href: id => `/budgets/${encodeURIComponent(id)}/reports` };
const MEMBERS_DESTINATION: Destination = { key: "members", label: "Members", href: id => `/budgets/${encodeURIComponent(id)}/members` };
const INVITATIONS_DESTINATION: Destination = { key: "invitations", label: "Invitations", href: id => `/budgets/${encodeURIComponent(id)}/invitations` };
const DESTINATION_REGISTRY: readonly Destination[] = [
  DASHBOARD_DESTINATION,
  PLAN_DESTINATION,
  REPORTS_DESTINATION,
  MEMBERS_DESTINATION,
  INVITATIONS_DESTINATION,
];

/** `<nav aria-label="Budget sections">` with `aria-current="page"` on the active destination. `current` names the
 * destination's key explicitly when the caller already knows it; otherwise the active tab is whichever matching
 * destination has the longest `href` (see `Destination.matches`), so a nested route resolves to the tab it
 * actually belongs to rather than to every shallower ancestor that also matches. */
export function BudgetTabs({ id, current }: { id: string; current?: string }) {
  const pathname = usePathname();
  const activeKey = current ?? (() => {
    let best: { key: string; href: string } | undefined;
    for (const destination of DESTINATION_REGISTRY) {
      const href = destination.href(id);
      const isMatch = destination.matches ? destination.matches(pathname, href) : defaultMatches(pathname, href);
      if (isMatch && (!best || href.length > best.href.length)) best = { key: destination.key, href };
    }
    return best?.key;
  })();
  return <nav aria-label="Budget sections"><ul className="flex flex-wrap gap-4">
    {DESTINATION_REGISTRY.map(destination => {
      const href = destination.href(id);
      return <li key={destination.key}>
        <NextLink href={href} aria-current={activeKey === destination.key ? "page" : undefined} className="text-interactive underline">{destination.label}</NextLink>
      </li>;
    })}
  </ul></nav>;
}
